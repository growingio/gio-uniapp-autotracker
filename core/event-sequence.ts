import type { AppEventType } from './protocol.js'

const SEQUENCED_EVENT_TYPES = new Set<AppEventType>([
  'VISIT',
  'PAGE',
  'CUSTOM',
  'VIEW_CLICK',
  'VIEW_CHANGE',
])

export type EventSequenceSnapshot = Readonly<{ eventSequenceId: number }>

/**
 * A single monotonically increasing counter shared by every sequenced event.
 * Persistence is intentionally left to the storage adapter in stage 2.
 */
export class EventSequence {
  private currentValue: number

  public constructor(initialValue: number | null | undefined = 0) {
    this.currentValue = typeof initialValue === 'number' && Number.isSafeInteger(initialValue) && initialValue >= 0 ? initialValue : 0
  }

  public current(): EventSequenceSnapshot {
    return { eventSequenceId: this.currentValue }
  }

  public next(eventType: AppEventType): number | null {
    const next = this.peek(eventType)
    if (next !== null) this.currentValue = next
    return next
  }

  /** Allows the composer to validate and enqueue before committing the sequence. */
  public peek(eventType: AppEventType): number | null {
    if (!SEQUENCED_EVENT_TYPES.has(eventType)) return null
    if (this.currentValue >= Number.MAX_SAFE_INTEGER) throw new Error('event_sequence_overflow')
    return this.currentValue + 1
  }
}
