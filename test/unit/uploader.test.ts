import { describe, expect, it } from 'vitest'

import { EventQueue } from '../../core/queue.js'
import type { TransportPort, TransportResult } from '../../core/ports.js'
import { Uploader, type UploaderRuntime } from '../../core/uploader.js'
import type { ProtocolEvent } from '../../core/protocol.js'

function event(sequence: number): ProtocolEvent {
  return { eventType: 'CUSTOM', eventName: `event_${sequence}`, eventSequenceId: sequence } as ProtocolEvent
}

function runtime(): { value: UploaderRuntime; fireDelay: (delay: number) => void; scheduledDelays: () => number[] } {
  const callbacks = new Map<number, { delay: number; callback: () => void }>()
  let nextHandle = 1
  return {
    value: {
      now: () => 123,
      random: () => 0.5,
      setTimeout: (callback, delay) => {
        const handle = nextHandle++
        callbacks.set(handle, { delay, callback })
        return handle
      },
      clearTimeout: (handle) => { callbacks.delete(handle as number) },
    },
    fireDelay: (delay) => {
      const matching = [...callbacks.entries()].filter(([, task]) => task.delay === delay)
      for (const [handle, task] of matching) {
        callbacks.delete(handle)
        task.callback()
      }
    },
    scheduledDelays: () => [...callbacks.values()].map((task) => task.delay),
  }
}

describe('Uploader', () => {
  it('uses at most three concurrent slots and releases a fourth only after completion', () => {
    const queue = new EventQueue({ maxItems: 5, maxPersistedBytes: 5_000, maxEventBytes: 500, maxBatchEvents: 1, maxBatchBytes: 500 })
    for (let index = 1; index <= 4; index += 1) queue.enqueue(event(index))
    const callbacks: Array<(result: TransportResult) => void> = []
    const transport: TransportPort = { dispatch: (_request, done) => { callbacks.push(done) } }
    const clocks = runtime()
    const uploader = new Uploader(queue, transport, clocks.value, 'https://collector.example', 'account')

    uploader.flush()
    expect(callbacks).toHaveLength(3)
    expect(uploader.activeCount()).toBe(3)
    callbacks[0]?.({ kind: 'success', status: 204 })
    expect(callbacks).toHaveLength(4)
    expect(uploader.activeCount()).toBe(3)
  })

  it('retries network failure twice with documented jitter-free midpoint delays', () => {
    const queue = new EventQueue()
    queue.enqueue(event(1))
    const callbacks: Array<(result: TransportResult) => void> = []
    const transport: TransportPort = { dispatch: (_request, done) => { callbacks.push(done) } }
    const clocks = runtime()
    const uploader = new Uploader(queue, transport, clocks.value, 'https://collector.example', 'account')

    uploader.flush()
    callbacks.shift()?.({ kind: 'network' })
    expect(clocks.scheduledDelays()).toContain(800)
    expect(queue.snapshot()[0]).toMatchObject({ retryCount: 1 })
    clocks.fireDelay(800)
    callbacks.shift()?.({ kind: 'timeout' })
    expect(clocks.scheduledDelays()).toContain(1_600)
    clocks.fireDelay(1_600)
    callbacks.shift()?.({ kind: 'success', status: 200 })
    expect(queue.snapshot()).toStrictEqual([])
  })

  it('drops 4xx once and never schedules a retry', () => {
    const queue = new EventQueue()
    queue.enqueue(event(1))
    const drops: unknown[] = []
    const transport: TransportPort = { dispatch: (_request, done) => { done({ kind: 'http', status: 400 }) } }
    const clocks = runtime()
    const uploader = new Uploader(queue, transport, clocks.value, 'https://collector.example', 'account', (drop) => drops.push(drop))

    uploader.flush()
    expect(queue.snapshot()).toStrictEqual([])
    expect(clocks.scheduledDelays()).toStrictEqual([])
    expect(drops).toStrictEqual([{ requestIds: ['q1'], reason: 'non_retryable', result: { kind: 'http', status: 400 } }])
  })

  it('exposes sanitized protocol events to an optional observer immediately before dispatch without queue metadata', () => {
    const queue = new EventQueue()
    queue.enqueue(event(1))
    const observations: Array<readonly ProtocolEvent[]> = []
    const order: string[] = []
    const transport: TransportPort = {
      dispatch: (_request, done) => {
        order.push('transport')
        done({ kind: 'success', status: 204 })
      },
    }
    const uploader = new Uploader(
      queue, transport, runtime().value, 'https://collector.example', 'account',
      undefined, undefined, (events) => { observations.push(events); order.push('observer') },
    )

    uploader.flush()
    expect(order).toStrictEqual(['observer', 'transport'])
    expect(observations).toStrictEqual([[{ eventType: 'CUSTOM', eventName: 'event_1', eventSequenceId: 1 }]])
  })

  it('forceFlush settles true once the active batch completes, or false at its one-second deadline', async () => {
    const queue = new EventQueue()
    queue.enqueue(event(1))
    const callbacks: Array<(result: TransportResult) => void> = []
    const clocks = runtime()
    const transport: TransportPort = { dispatch: (_request, done) => { callbacks.push(done) } }
    const uploader = new Uploader(queue, transport, clocks.value, 'https://collector.example', 'account')

    const flushed = uploader.forceFlush()
    callbacks[0]?.({ kind: 'success', status: 204 })
    await expect(flushed).resolves.toBe(true)

    queue.enqueue(event(2))
    const timedOut = uploader.forceFlush()
    clocks.fireDelay(1_000)
    await expect(timedOut).resolves.toBe(false)
  })
})
