import { describe, expect, it } from 'vitest'

import { dispatchWithFinalizer, type TimerPort } from '../../core/transport-finalizer.js'
import type { TransportPort, TransportRequest, TransportResult } from '../../core/ports.js'

const request: TransportRequest = { url: 'https://collector.example', method: 'POST', headers: {}, body: '[]', timeoutMs: 5_000 }

function fakeTimer(): { timer: TimerPort; fire: () => void; cleared: () => boolean } {
  let callback: (() => void) | null = null
  let wasCleared = false
  return {
    timer: {
      setTimeout: (next) => { callback = next; return 1 },
      clearTimeout: () => { wasCleared = true },
    },
    fire: () => callback?.(),
    cleared: () => wasCleared,
  }
}

describe('dispatchWithFinalizer', () => {
  it('completes synchronous success once and clears its deadline', () => {
    const fake = fakeTimer()
    const results: TransportResult[] = []
    const transport: TransportPort = { dispatch: (_request, done) => { done({ kind: 'success', status: 204 }) } }
    dispatchWithFinalizer(transport, fake.timer, request, (result) => results.push(result))
    fake.fire()

    expect(results).toStrictEqual([{ kind: 'success', status: 204 }])
    expect(fake.cleared()).toBe(true)
  })

  it('times out once, aborts the host request, and ignores a late callback', () => {
    const fake = fakeTimer()
    const results: TransportResult[] = []
    let callback: ((result: TransportResult) => void) | undefined
    let aborted = 0
    const transport: TransportPort = {
      dispatch: (_request, done) => {
        callback = done
        return { abort: () => { aborted += 1 } }
      },
    }
    dispatchWithFinalizer(transport, fake.timer, request, (result) => results.push(result))
    fake.fire()
    callback?.({ kind: 'success', status: 200 })

    expect(aborted).toBe(1)
    expect(results).toStrictEqual([{ kind: 'timeout' }])
  })

  it('normalizes synchronous transport throws and supports best-effort cancellation', () => {
    const fake = fakeTimer()
    const results: TransportResult[] = []
    const transport: TransportPort = { dispatch: () => { throw new Error('offline') } }
    const finalized = dispatchWithFinalizer(transport, fake.timer, request, (result) => results.push(result))
    finalized.cancel()
    expect(results).toStrictEqual([{ kind: 'network', message: 'offline' }])
  })
})
