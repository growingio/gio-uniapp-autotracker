import { describe, expect, it } from 'vitest'

import { normalizeInitOptions } from '../../core/config.js'
import { EventComposer } from '../../core/event-composer.js'
import { EventSequence } from '../../core/event-sequence.js'
import type { Identity } from '../../core/identity.js'
import { LocationState } from '../../core/location-state.js'
import type { AppSystemContext } from '../../core/ports.js'
import { EventQueue } from '../../core/queue.js'
import { SessionManager } from '../../core/session.js'

function fixtureConfig() {
  const normalized = normalizeInitOptions({ accountId: 'account', dataSourceId: 'source', appChannel: 'release' })
  if (normalized.ok === false) throw new Error('fixture_config_invalid')
  return normalized.config
}

const config = fixtureConfig()

const system: AppSystemContext = {
  platform: 'Android', platformVersion: '14', domain: 'com.example.app', appState: 'FOREGROUND', appName: 'Example',
  networkState: 'WIFI', screenWidth: 1080, screenHeight: 1920, deviceBrand: 'Google', deviceModel: 'Pixel',
  deviceType: 'PHONE', appVersion: '1.0.0', language: 'zh-CN', sdkVersion: '0.1.0',
}

function createComposer(overrides: Partial<{ clock: () => number; identity: () => Identity; timezone: () => number; network: () => AppSystemContext['networkState'] }> = {}) {
  const sessions = new SessionManager(config.sessionPolicy, () => 'session-1')
  sessions.resume(1)
  const queue = new EventQueue()
  const sequence = new EventSequence()
  const location = new LocationState()
  const composer = new EventComposer(
    config,
    system,
    overrides.identity ?? (() => ({ deviceId: 'device-1', userId: 'user-1', userKey: 'key-1' })),
    sessions,
    sequence,
    queue,
    { now: overrides.clock ?? (() => 1234) },
    { getOffsetMinutes: overrides.timezone ?? (() => -480) },
    location,
    overrides.network,
  )
  return { composer, queue, sequence, location }
}

describe('EventComposer', () => {
  it('系统时钟抛错时拒绝事件，不入队也不消耗序列号', () => {
    const { composer, queue, sequence } = createComposer({ clock: () => { throw new Error('clock failed') } })
    expect(composer.compose({ eventType: 'VISIT' })).toEqual({ ok: false, code: 'invalid_timestamp' })
    expect(queue.snapshot()).toEqual([])
    expect(sequence.current()).toEqual({ eventSequenceId: 0 })
  })

  it.each([() => NaN, () => { throw new Error('timezone failed') }])('时区读取异常时使用 0，网络读取异常时保留系统快照', (timezone) => {
    const { composer } = createComposer({ timezone, network: () => { throw new Error('network failed') } })
    expect(composer.compose({ eventType: 'VISIT' })).toMatchObject({ ok: true, event: { timezoneOffset: '0', networkState: 'WIFI' } })
  })
  it('builds and queues VISIT with trusted common context and a shared sequence', () => {
    const { composer, queue, sequence, location } = createComposer()
    location.set(30.2, 120.1)

    const result = composer.compose({ eventType: 'VISIT', fields: { deviceId: 'untrusted', path: '/home', query: 'tab=all' } })

    expect(result).toMatchObject({ ok: true, requestId: 'q1' })
    if (!result.ok) return
    expect(result.event).toMatchObject({
      eventType: 'VISIT', eventSequenceId: 1, deviceId: 'device-1', sessionId: 'session-1',
      dataSourceId: 'source', appChannel: 'release', timezoneOffset: '-480', latitude: 30.2, longitude: 120.1,
    })
    expect(queue.snapshot()).toHaveLength(1)
    expect(sequence.current()).toStrictEqual({ eventSequenceId: 1 })
  })

  it('does not advance the sequence for rejected custom input', () => {
    const { composer, sequence } = createComposer()

    expect(composer.compose({ eventType: 'CUSTOM', fields: { eventName: 'not valid', attributes: {} } }))
      .toStrictEqual({ ok: false, code: 'invalid_custom_event_name' })
    expect(sequence.current()).toStrictEqual({ eventSequenceId: 0 })
    expect(composer.compose({ eventType: 'CUSTOM', fields: { eventName: 'valid_name', attributes: {} } }))
      .toMatchObject({ ok: true, event: { eventSequenceId: 1 } })
  })

  it('does not attach a sequence to APP_CLOSED and accepts a background state override', () => {
    const { composer, sequence } = createComposer()

    const result = composer.compose({ eventType: 'APP_CLOSED', appState: 'BACKGROUND' })

    expect(result).toMatchObject({ ok: true, event: { eventType: 'APP_CLOSED', appState: 'BACKGROUND' } })
    if (!result.ok) return
    expect(result.event).not.toHaveProperty('eventSequenceId')
    expect(sequence.current()).toStrictEqual({ eventSequenceId: 0 })
  })

  it('rejects a missing session or an invalid clock before queueing', () => {
    const { composer, queue } = createComposer({ clock: () => Number.NaN })
    expect(composer.compose({ eventType: 'VISIT' })).toStrictEqual({ ok: false, code: 'invalid_timestamp' })
    expect(queue.snapshot()).toHaveLength(0)
  })
})
