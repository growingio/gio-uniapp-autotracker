import { describe, expect, it } from 'vitest'

import { TrackerEventGate } from '../../core/tracker-event-gate.js'
import { TrackerLifecycle } from '../../core/tracker-lifecycle.js'

const options = { accountId: 'account', dataSourceId: 'source' }

describe('TrackerEventGate', () => {
  it('rejects calls before init, buffers only while hydrating, then releases in order', () => {
    const lifecycle = new TrackerLifecycle()
    const gate = new TrackerEventGate(lifecycle)
    const emitted: string[] = []
    const emit = (intent: { kind: string }): boolean => { emitted.push(intent.kind); return true }

    expect(gate.submit({ kind: 'before-init', payload: {} }, emit)).toBe(false)
    lifecycle.init(options)
    expect(gate.submit({ kind: 'first', payload: {} }, emit)).toBe(true)
    expect(gate.submit({ kind: 'second', payload: {} }, emit)).toBe(true)
    expect(emitted).toStrictEqual([])
    expect(gate.release(emit)).toBe(true)
    expect(emitted).toStrictEqual(['first', 'second'])
    expect(gate.submit({ kind: 'ready', payload: {} }, emit)).toBe(true)
    expect(emitted).toStrictEqual(['first', 'second', 'ready'])
  })

  it('does not construct, buffer, or emit behavior events when dataCollect is false', () => {
    const lifecycle = new TrackerLifecycle()
    lifecycle.init({ ...options, dataCollect: false })
    const gate = new TrackerEventGate(lifecycle)
    const emit = (): boolean => { throw new Error('must not emit') }
    expect(gate.submit({ kind: 'track', payload: {} }, emit)).toBe(false)
    expect(gate.bufferedCount()).toBe(0)
    expect(gate.release(emit)).toBe(true)
  })

  it('does not let one buffered emitter failure block later intents', () => {
    const lifecycle = new TrackerLifecycle()
    lifecycle.init(options)
    const gate = new TrackerEventGate(lifecycle)
    gate.submit({ kind: 'bad', payload: {} }, () => true)
    gate.submit({ kind: 'good', payload: {} }, () => true)
    const emitted: string[] = []
    gate.release((intent) => {
      if (intent.kind === 'bad') throw new Error('bad event')
      emitted.push(intent.kind)
      return true
    })
    expect(emitted).toStrictEqual(['good'])
  })

  it('immediately blocks new behavior events after collection is disabled without clearing ready state', () => {
    const lifecycle = new TrackerLifecycle()
    lifecycle.init(options)
    const gate = new TrackerEventGate(lifecycle)
    gate.release(() => true)
    expect(lifecycle.setDataCollect(false)).toMatchObject({ ok: true, changed: true })
    expect(gate.submit({ kind: 'blocked', payload: {} }, () => true)).toBe(false)
    expect(lifecycle.status()).toBe('ready')
  })
})
