import { buildAppEvent, type ProtocolEvent } from './dataStore/protocol.js'

export const MAX_QUEUE_ITEMS = 200
export const MAX_QUEUE_PERSISTED_BYTES = 2 * 1024 * 1024
export const MAX_EVENT_BYTES = 512 * 1024
export const MAX_BATCH_EVENTS = 50
export const MAX_BATCH_BYTES = 512 * 1024

export type QueueLimits = Readonly<{
  maxItems: number
  maxPersistedBytes: number
  maxEventBytes: number
  maxBatchEvents: number
  maxBatchBytes: number
}>

export type QueueEntry = Readonly<{
  requestId: string
  event: ProtocolEvent
  retryCount: number
}>

export type EnqueueResult =
  | Readonly<{ ok: true; requestId: string }>
  | Readonly<{ ok: false; code: 'event_not_serializable' | 'event_too_large' | 'queue_full' }>

const DEFAULT_LIMITS: QueueLimits = {
  maxItems: MAX_QUEUE_ITEMS,
  maxPersistedBytes: MAX_QUEUE_PERSISTED_BYTES,
  maxEventBytes: MAX_EVENT_BYTES,
  maxBatchEvents: MAX_BATCH_EVENTS,
  maxBatchBytes: MAX_BATCH_BYTES,
}

/** 计算序列化事件的 UTF-8 占用，供单事件、批次和持久化限额判断。 */
function utf8ByteLength(value: string): number {
  let size = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit <= 0x7f) size += 1
    else if (unit <= 0x7ff) size += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4
        index += 1
      } else size += 3
    } else size += 3
  }
  return size
}

/** 安全序列化协议事件，无法生成 JSON 字符串时返回 null。 */
function serializedEvent(event: ProtocolEvent): string | null {
  try {
    const result = JSON.stringify(event)
    return typeof result === 'string' ? result : null
  } catch {
    return null
  }
}

/** 从 JSON 文本创建独立事件副本，拒绝非对象形态。 */
function cloneEvent(serialized: string): ProtocolEvent | null {
  try {
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as ProtocolEvent
  } catch {
    return null
  }
}

/** 队列状态与宿主无关，快照编码及有序宿主写入由存储模块负责。 */
export class EventQueue {
  private readonly entries: QueueEntry[] = []
  private readonly claimed = new Set<string>()
  private nextRequestNumber = 1

  /** 注入队列条数、事件字节和上传批次等内部限制。 */
  public constructor(private readonly limits: QueueLimits = DEFAULT_LIMITS) {}

  /** 依次校验事件和队列容量，成功后以独立 JSON 副本入队并分配请求标识。 */
  public enqueue(event: ProtocolEvent): EnqueueResult {
    const serialized = serializedEvent(event)
    if (serialized === null) return { ok: false, code: 'event_not_serializable' }
    const byteLength = utf8ByteLength(serialized)
    if (byteLength > this.limits.maxEventBytes || byteLength + 2 > this.limits.maxBatchBytes) {
      return { ok: false, code: 'event_too_large' }
    }
    if (this.entries.length >= this.limits.maxItems) return { ok: false, code: 'queue_full' }
    const normalized = cloneEvent(serialized)
    if (normalized === null) return { ok: false, code: 'event_not_serializable' }

    const requestId = this.allocateRequestId()
    const candidate = [...this.entries, { requestId, event: normalized, retryCount: 0 }]
    if (utf8ByteLength(JSON.stringify({ version: 1, entries: candidate })) > this.limits.maxPersistedBytes) {
      return { ok: false, code: 'queue_full' }
    }
    this.entries.push({ requestId, event: normalized, retryCount: 0 })
    return { ok: true, requestId }
  }

  /** 选取最早的合法 JSON 数组批次，不从队列删除记录。 */
  public nextBatch(): readonly QueueEntry[] {
    return this.selectBatch(false)
  }

  /** 领取批次并登记占用，避免多个并发上传槽位重复发送同一事件。 */
  public claimNextBatch(): readonly QueueEntry[] {
    const batch = this.selectBatch(true)
    for (const entry of batch) this.claimed.add(entry.requestId)
    return batch
  }

  /** 释放指定请求的上传占用，允许后续调度重新选择。 */
  public release(requestIds: readonly string[]): void {
    for (const requestId of requestIds) this.claimed.delete(requestId)
  }

  /** 在数量与字节限制内选取最早批次；并发上传时跳过已占用记录并隔离重试预算。 */
  private selectBatch(excludeClaimed: boolean): readonly QueueEntry[] {
    const batch: QueueEntry[] = []
    let body = '['
    for (const entry of this.entries) {
      if (excludeClaimed && this.claimed.has(entry.requestId)) continue
      // 冷启动后的混合队列按剩余重试次数分批，旧事件不能借用新事件的额度。
      if (excludeClaimed && batch.length > 0 && entry.retryCount !== batch[0]!.retryCount) break
      if (batch.length >= this.limits.maxBatchEvents) break
      const serialized = serializedEvent(entry.event)
      if (serialized === null) continue
      const candidate = `${body}${batch.length === 0 ? '' : ','}${serialized}]`
      if (utf8ByteLength(candidate) > this.limits.maxBatchBytes) break
      body = candidate.slice(0, -1)
      batch.push(entry)
    }
    return batch
  }

  /** 按请求标识移除事件，同时清理其上传占用。 */
  public remove(requestIds: readonly string[]): void {
    if (requestIds.length === 0) return
    const ids = new Set(requestIds)
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (ids.has(this.entries[index]!.requestId)) {
        this.claimed.delete(this.entries[index]!.requestId)
        this.entries.splice(index, 1)
      }
    }
  }

  /** 只增加指定事件的已用重试次数，供持久化与后续批次分组。 */
  public incrementRetries(requestIds: readonly string[]): void {
    const ids = new Set(requestIds)
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]!
      if (ids.has(entry.requestId)) this.entries[index] = { ...entry, retryCount: entry.retryCount + 1 }
    }
  }

  /** 仅恢复完整有效的持久快照；校验失败时保留现有队列。 */
  public restore(entries: readonly QueueEntry[]): boolean {
    if (entries.length > this.limits.maxItems || entries.some((entry) => !this.validEntry(entry))) return false
    const normalized = entries.map((entry) => ({
      requestId: entry.requestId,
      event: cloneEvent(JSON.stringify(entry.event))!,
      retryCount: entry.retryCount,
    }))
    if (new Set(normalized.map((entry) => entry.requestId)).size !== normalized.length
      || utf8ByteLength(JSON.stringify({ version: 1, entries: normalized })) > this.limits.maxPersistedBytes) return false
    this.entries.splice(0, this.entries.length, ...normalized)
    this.claimed.clear()
    const largestRequestNumber = normalized.reduce((largest, entry) => {
      const match = /^q(\d+)$/.exec(entry.requestId)
      return match === null ? largest : Math.max(largest, Number(match[1]))
    }, 0)
    this.nextRequestNumber = largestRequestNumber === Number.MAX_SAFE_INTEGER ? 1 : largestRequestNumber + 1
    return true
  }

  /** 生成不与当前队列冲突的标识，到达安全整数上限后循环寻找空位。 */
  private allocateRequestId(): string {
    let requestId: string
    do {
      requestId = `q${this.nextRequestNumber}`
      this.nextRequestNumber = this.nextRequestNumber === Number.MAX_SAFE_INTEGER ? 1 : this.nextRequestNumber + 1
    } while (this.entries.some((entry) => entry.requestId === requestId))
    return requestId
  }

  /** 返回事件内容也已复制的队列快照，避免外部修改内部记录。 */
  public snapshot(): readonly QueueEntry[] {
    return this.entries.map((entry) => ({ ...entry, event: cloneEvent(JSON.stringify(entry.event)) ?? entry.event }))
  }

  /** 校验缓存条目、请求标识、重试次数和完整协议，阻止损坏数据恢复。 */
  private validEntry(entry: unknown): entry is QueueEntry {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
    const candidate = entry as Readonly<Record<string, unknown>>
    if (typeof candidate.requestId !== 'string' || candidate.requestId.length === 0
      || typeof candidate.retryCount !== 'number' || !Number.isSafeInteger(candidate.retryCount) || candidate.retryCount < 0
      || typeof candidate.event !== 'object' || candidate.event === null || Array.isArray(candidate.event)) return false
    const requestNumber = /^q([1-9]\d*)$/.exec(candidate.requestId)?.[1]
    if (requestNumber === undefined || !Number.isSafeInteger(Number(requestNumber))) return false
    const serialized = serializedEvent(candidate.event as ProtocolEvent)
    if (serialized === null || utf8ByteLength(serialized) > this.limits.maxEventBytes || utf8ByteLength(`[${serialized}]`) > this.limits.maxBatchBytes) return false
    const event = candidate.event as ProtocolEvent
    if (typeof event.eventType !== 'string') return false
    const rebuilt = buildAppEvent(event.eventType, event, true)
    return rebuilt.ok && JSON.stringify(rebuilt.event) === serialized
  }
}
