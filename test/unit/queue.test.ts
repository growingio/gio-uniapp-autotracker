import { describe, expect, it } from 'vitest'

import { EventQueue } from '../../core/queue.js'
import type { ProtocolEvent } from '../../core/protocol.js'

function event(number: number, value = ''): ProtocolEvent {
  return { eventType: 'CUSTOM', eventSequenceId: number, eventName: `event_${number}`, value } as ProtocolEvent
}

describe('EventQueue', () => {
  it('keeps JSON-only event snapshots in FIFO order and supports retry metadata', () => {
    const queue = new EventQueue()
    expect(queue.enqueue(event(1))).toStrictEqual({ ok: true, requestId: 'q1' })
    expect(queue.enqueue(event(2))).toStrictEqual({ ok: true, requestId: 'q2' })
    expect(queue.nextBatch().map((entry) => entry.requestId)).toStrictEqual(['q1', 'q2'])

    queue.incrementRetries(['q1'])
    expect(queue.snapshot()[0]).toMatchObject({ requestId: 'q1', retryCount: 1 })
    queue.remove(['q1'])
    expect(queue.snapshot().map((entry) => entry.requestId)).toStrictEqual(['q2'])
  })

  it('drops bad JSON and events that cannot occupy even a one-event HTTP batch', () => {
    const queue = new EventQueue({ maxItems: 2, maxPersistedBytes: 1_000, maxEventBytes: 30, maxBatchEvents: 2, maxBatchBytes: 30 })
    const cyclic: Record<string, unknown> = { eventType: 'CUSTOM' }
    cyclic.self = cyclic
    expect(queue.enqueue(cyclic as ProtocolEvent)).toStrictEqual({ ok: false, code: 'event_not_serializable' })
    expect(queue.enqueue(event(1, 'x'.repeat(100)))).toStrictEqual({ ok: false, code: 'event_too_large' })
  })

  it('preserves existing items when count or persistent-envelope capacity is exhausted', () => {
    const byCount = new EventQueue({ maxItems: 1, maxPersistedBytes: 1_000, maxEventBytes: 500, maxBatchEvents: 50, maxBatchBytes: 500 })
    expect(byCount.enqueue(event(1))).toMatchObject({ ok: true })
    expect(byCount.enqueue(event(2))).toStrictEqual({ ok: false, code: 'queue_full' })
    expect(byCount.snapshot()).toHaveLength(1)

    const byBytes = new EventQueue({ maxItems: 5, maxPersistedBytes: 100, maxEventBytes: 500, maxBatchEvents: 50, maxBatchBytes: 500 })
    expect(byBytes.enqueue(event(1, 'x'.repeat(200)))).toStrictEqual({ ok: false, code: 'queue_full' })
    expect(byBytes.snapshot()).toStrictEqual([])
  })

  it('forms batches by the actual JSON-array byte limit, not event count alone', () => {
    const queue = new EventQueue({ maxItems: 5, maxPersistedBytes: 2_000, maxEventBytes: 500, maxBatchEvents: 5, maxBatchBytes: 120 })
    queue.enqueue(event(1, 'x'.repeat(20)))
    queue.enqueue(event(2, 'x'.repeat(20)))
    queue.enqueue(event(3, 'x'.repeat(20)))
    expect(queue.nextBatch().map((entry) => entry.event.eventSequenceId)).toStrictEqual([1])
  })
})
