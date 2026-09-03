import { buildAppEvent, type ProtocolEvent } from './protocol.js'

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

function serializedEvent(event: ProtocolEvent): string | null {
  try {
    const result = JSON.stringify(event)
    return typeof result === 'string' ? result : null
  } catch {
    return null
  }
}

function cloneEvent(serialized: string): ProtocolEvent | null {
  try {
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as ProtocolEvent
  } catch {
    return null
  }
}

/**
 * Queue state is host-independent. Stage 2's persistent adapter serializes the same snapshot
 * only after its StoragePort write succeeds.
 */
export class EventQueue {
  private readonly entries: QueueEntry[] = []
  private readonly claimed = new Set<string>()
  private nextRequestNumber = 1

  public constructor(private readonly limits: QueueLimits = DEFAULT_LIMITS) {}

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

    const requestId = `q${this.nextRequestNumber++}`
    const candidate = [...this.entries, { requestId, event: normalized, retryCount: 0 }]
    if (utf8ByteLength(JSON.stringify({ version: 1, entries: candidate })) > this.limits.maxPersistedBytes) {
      return { ok: false, code: 'queue_full' }
    }
    this.entries.push({ requestId, event: normalized, retryCount: 0 })
    return { ok: true, requestId }
  }

  /** Selects the oldest legal JSON-array batch without removing it from the queue. */
  public nextBatch(): readonly QueueEntry[] {
    return this.selectBatch(false)
  }

  /** Claims entries so a concurrent uploader slot cannot send the same event twice. */
  public claimNextBatch(): readonly QueueEntry[] {
    const batch = this.selectBatch(true)
    for (const entry of batch) this.claimed.add(entry.requestId)
    return batch
  }

  public release(requestIds: readonly string[]): void {
    for (const requestId of requestIds) this.claimed.delete(requestId)
  }

  private selectBatch(excludeClaimed: boolean): readonly QueueEntry[] {
    const batch: QueueEntry[] = []
    let body = '['
    for (const entry of this.entries) {
      if (excludeClaimed && this.claimed.has(entry.requestId)) continue
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

  public incrementRetries(requestIds: readonly string[]): void {
    const ids = new Set(requestIds)
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]!
      if (ids.has(entry.requestId)) this.entries[index] = { ...entry, retryCount: entry.retryCount + 1 }
    }
  }

  /** Restores only a fully valid persisted snapshot; callers keep the current queue on failure. */
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
    this.nextRequestNumber = largestRequestNumber + 1
    return true
  }

  public snapshot(): readonly QueueEntry[] {
    return this.entries.map((entry) => ({ ...entry, event: cloneEvent(JSON.stringify(entry.event)) ?? entry.event }))
  }

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
    const rebuilt = buildAppEvent(event.eventType, event)
    return rebuilt.ok && JSON.stringify(rebuilt.event) === serialized
  }
}
