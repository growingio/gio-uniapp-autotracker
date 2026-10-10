import { buildCollectorRequest, isRetryableCollectorFailure, normalizeCollectorResult } from './collector.js'
import type { TransportPort, TransportResult } from './ports.js'
import type { ProtocolEvent } from './protocol.js'
import type { QueueEntry } from './queue.js'
import { EventQueue } from './queue.js'
import { dispatchWithFinalizer, type TimerPort } from './transport-finalizer.js'

export const MAX_CONCURRENT_UPLOADS = 3
const RETRY_DELAYS_MS = [800, 1_600] as const

export interface UploaderRuntime extends TimerPort {
  now(): number
  random(): number
}

export type UploaderDrop = Readonly<{
  requestIds: readonly string[]
  reason: 'non_retryable' | 'retry_exhausted' | 'request_build_failed'
  result?: TransportResult
}>

/** Coordinates queue claiming, bounded transport slots, and documented retry delays. */
export class Uploader {
  private active = 0
  private pendingRetries = 0
  private readonly readyRetries: Array<{ batch: readonly QueueEntry[]; attempt: number }> = []
  private flushing = false
  /** Accepted events waiting for an available transport slot. */
  private readonly readyRequests = new Set<string>()
  private readonly reservedRequests = new Set<string>()
  private readonly drainWaiters = new Set<() => void>()

  public constructor(
    private readonly queue: EventQueue,
    private readonly transport: TransportPort,
    private readonly runtime: UploaderRuntime,
    private readonly serverUrl: string,
    private readonly accountId: string,
    private readonly onDrop: (drop: UploaderDrop) => void = () => undefined,
    private readonly onQueueChanged: () => void = () => undefined,
    /** Receives the already-sanitized protocol events immediately before a transport dispatch. */
    private readonly onBeforeDispatch: (events: readonly ProtocolEvent[]) => void = () => undefined,
    private readonly canDispatch: () => boolean = () => true,
  ) {}

  /** App events are eligible immediately; only transport slots and retries can delay dispatch. */
  public schedule(): void {
    this.flush()
  }

  public flush(): void {
    for (const entry of this.queue.snapshot()) {
      if (!this.reservedRequests.has(entry.requestId)) this.readyRequests.add(entry.requestId)
    }
    this.drain()
  }

  private drain(): void {
    if (this.flushing) return
    this.flushing = true
    while (this.active < MAX_CONCURRENT_UPLOADS && this.canDispatch()) {
      const retry = this.readyRetries.shift()
      if (retry !== undefined) {
        this.dispatch(retry.batch, retry.attempt)
        continue
      }
      const claimed = this.queue.claimNextBatch()
      const batch = claimed.filter(entry => this.readyRequests.has(entry.requestId))
      this.queue.release(claimed.filter(entry => !this.readyRequests.has(entry.requestId)).map(entry => entry.requestId))
      if (batch.length === 0) break
      for (const entry of batch) {
        this.readyRequests.delete(entry.requestId)
        this.reservedRequests.add(entry.requestId)
      }
      const attempt = batch[0]!.retryCount
      if (attempt > RETRY_DELAYS_MS.length) {
        const requestIds = batch.map((entry) => entry.requestId)
        this.queue.remove(requestIds)
        this.releaseReserved(requestIds)
        this.onQueueChanged()
        this.onDrop({ requestIds, reason: 'retry_exhausted' })
        continue
      }
      this.dispatch(batch, attempt)
    }
    this.flushing = false
    this.notifyDrain()
  }

  public activeCount(): number {
    return this.active
  }

  /** onHide may wait briefly, but unfinished work remains in the persistent queue. */
  public forceFlush(maxWaitMs = 1_000): Promise<boolean> {
    this.flush()
    if (this.isDrained()) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const timeout = this.runtime.setTimeout(() => {
        if (settled) return
        settled = true
        this.drainWaiters.delete(onDrain)
        resolve(false)
      }, maxWaitMs)
      const onDrain = (): void => {
        if (settled || !this.isDrained()) return
        settled = true
        this.runtime.clearTimeout(timeout)
        this.drainWaiters.delete(onDrain)
        resolve(true)
      }
      this.drainWaiters.add(onDrain)
      onDrain()
    })
  }

  private dispatch(batch: readonly QueueEntry[], attempt: number): void {
    const requestResult = buildCollectorRequest(this.serverUrl, this.accountId, batch.map((entry) => entry.event), this.runtime.now())
    const requestIds = batch.map((entry) => entry.requestId)
    if (!requestResult.ok) {
      this.queue.remove(requestIds)
      this.releaseReserved(requestIds)
      this.onQueueChanged()
      this.onDrop({ requestIds, reason: 'request_build_failed' })
      this.notifyDrain()
      return
    }

    try {
      this.onBeforeDispatch(batch.map((entry) => entry.event))
    } catch {
      // Debug observers must never change collector delivery semantics.
    }
    this.active += 1
    dispatchWithFinalizer(this.transport, this.runtime, requestResult.request, (rawResult) => {
      const result = normalizeCollectorResult(rawResult)
      this.active -= 1
      if (result.kind === 'success') {
        this.queue.remove(requestIds)
        this.releaseReserved(requestIds)
        this.queue.release(requestIds)
        this.onQueueChanged()
      } else if ((result.kind === 'network' || result.kind === 'timeout') && !this.canDispatch()) {
        // 飞行中遇到明确断网也保留事件；恢复网络后继续，不额外消耗重试额度。
        this.readyRetries.push({ batch, attempt })
      } else if (isRetryableCollectorFailure(result) && attempt < RETRY_DELAYS_MS.length) {
        this.queue.incrementRetries(requestIds)
        this.onQueueChanged()
        this.pendingRetries += 1
        this.runtime.setTimeout(() => {
          this.pendingRetries -= 1
          this.readyRetries.push({ batch, attempt: attempt + 1 })
          this.drain()
        }, this.retryDelay(attempt))
      } else {
        this.queue.remove(requestIds)
        this.releaseReserved(requestIds)
        this.queue.release(requestIds)
        this.onQueueChanged()
        this.onDrop({
          requestIds,
          reason: isRetryableCollectorFailure(result) ? 'retry_exhausted' : 'non_retryable',
          result,
        })
      }
      this.drain()
      this.notifyDrain()
    })
  }

  private retryDelay(attempt: number): number {
    const random = Math.min(1, Math.max(0, this.runtime.random()))
    return Math.round(RETRY_DELAYS_MS[attempt]! * (0.8 + random * 0.4))
  }

  private releaseReserved(requestIds: readonly string[]): void {
    for (const requestId of requestIds) this.reservedRequests.delete(requestId)
  }

  private isDrained(): boolean {
    return this.active === 0 && this.pendingRetries === 0 && this.readyRetries.length === 0 && this.queue.snapshot().length === 0
  }

  private notifyDrain(): void {
    for (const waiter of this.drainWaiters) waiter()
  }
}
