import type { AutoTrackCall, NormalizedAutoTrackCall } from '../autotrack/contract.js'
import { normalizeAutoTrackCall, record } from './autotrack-normalize.js'

export interface AutoTrackTarget {
  autoTrack(call: AutoTrackCall, nativeEvent?: unknown): boolean
}
let target: AutoTrackTarget | null = null

/** 每个 tracker 各自持有去重状态；原始事件和目标仅作为 WeakMap 弱键，不进入队列或日志。 */
export class AutoTrackDispatcher {
  private seen = new WeakMap<object, Set<string>>()
  private targets = new WeakMap<object, number>()
  private nextTargetId = 1
  private previous: Readonly<{ key: string; timeStamp: number }> | null = null
  private pageKey: string | null = null

  public reset(): void {
    this.seen = new WeakMap()
    this.targets = new WeakMap()
    this.nextTargetId = 1
    this.previous = null
    this.pageKey = null
  }

  public dispatch(call: AutoTrackCall, nativeEvent: unknown, pageKey: string | null, emit: (call: NormalizedAutoTrackCall) => boolean): boolean {
    try {
      if (this.pageKey !== pageKey) { this.reset(); this.pageKey = pageKey }
      if (pageKey === null) return false
      const normalized = normalizeAutoTrackCall(call, nativeEvent)
      if (normalized === null) return false
      const event = record(nativeEvent)
      // Equal wire xpaths do not identify equal elements when the bound id is empty.
      // Keep only a weak target identity; it never becomes a protocol field.
      const primary = record(event?.currentTarget) ?? record(event?.target)
      const rawId = primary?.id
      const hasId = (typeof rawId === 'string' || typeof rawId === 'number') && String(rawId) !== ''
      const identityTarget = primary ?? event
      let targetId: number | null = null
      if (!hasId && identityTarget !== null) {
        targetId = this.targets.get(identityTarget) ?? this.nextTargetId++
        this.targets.set(identityTarget, targetId)
      }
      const key = JSON.stringify([normalized.kind, normalized.xpath, normalized.textValue,
        normalized.kind === 'click' ? normalized.index : null, normalized.kind === 'click' ? normalized.hyperlink : null, targetId])
      if (event !== null && this.seen.get(event)?.has(key)) return false
      const timeStamp = event?.timeStamp
      const timedKey = JSON.stringify([pageKey, typeof event?.type === 'string' ? event.type : '', key])
      const timed = typeof timeStamp === 'number' && Number.isFinite(timeStamp) && timeStamp > 0
      if (timed && this.previous?.key === timedKey && Math.abs(timeStamp - this.previous.timeStamp) < 10) return false
      if (!emit(normalized)) return false
      if (event !== null) {
        const keys = this.seen.get(event) ?? new Set<string>()
        keys.add(key)
        this.seen.set(event, keys)
      }
      if (timed) this.previous = { key: timedKey, timeStamp }
      return true
    } catch {
      return false
    }
  }
}

export function installAutoTrackDispatcher(next: AutoTrackTarget): void { target = next }
export function dispatchAutoTrack(call: AutoTrackCall, nativeEvent?: unknown): boolean {
  try { return target?.autoTrack(call, nativeEvent) ?? false } catch { return false }
}
