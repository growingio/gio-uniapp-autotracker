import { describe, expect, it } from 'vitest'

import { normalizeInitOptions } from '../../core/config.js'
import { EventComposer } from '../../core/event-composer.js'
import { EventDispatcher } from '../../runtime/event-dispatcher.js'
import { EventSequence } from '../../core/event-sequence.js'
import { LocationState } from '../../core/location-state.js'
import { PageStore } from '../../core/page-store.js'
import type { AppSystemContext } from '../../core/ports.js'
import { EventQueue } from '../../core/queue.js'
import { SessionManager } from '../../core/session.js'

const normalized = normalizeInitOptions({ accountId: 'account', dataSourceId: 'source' })
if (normalized.ok === false) throw new Error('fixture_config_invalid')
const config = normalized.config
const system: AppSystemContext = {
  platform: 'HarmonyOS', platformVersion: '5', domain: 'com.example.app', appState: 'FOREGROUND', appName: 'Example',
  networkState: 'WIFI', screenWidth: 1080, screenHeight: 1920, deviceBrand: 'Example', deviceModel: 'Example One',
  deviceType: 'PHONE', appVersion: '1.0.0', language: 'zh-CN', sdkVersion: '0.1.0',
}

function createDispatcher() {
  const sessions = new SessionManager(config.sessionPolicy, () => 'session-1')
  sessions.resume(0)
  const queue = new EventQueue()
  const sequence = new EventSequence()
  const pages = new PageStore()
  pages.onLoad({ instanceId: 'detail#1', route: 'pages/detail/index', query: 'id=42', referralPage: null })
  pages.onShow('detail#1', 99, 'Detail')
  const dispatcher = new EventDispatcher(
    new EventComposer(
      config, system, () => ({ deviceId: 'device-1', userId: 'user-1', userKey: null }), sessions,
      sequence, queue, { now: () => 100 }, { getOffsetMinutes: () => -480 }, new LocationState(),
    ),
    () => pages.current(),
  )
  return { dispatcher, queue, sequence }
}

describe('EventDispatcher', () => {
  it('normalizes custom attributes and carries only the allowed current page context', () => {
    const { dispatcher, queue } = createDispatcher()
    expect(dispatcher.track({ eventName: 'product_view', properties: { count: 0, enabled: false, tags: ['a', 'b'], nested: { no: true } } })).toBe(true)

    expect(queue.snapshot()[0]?.event).toStrictEqual(expect.objectContaining({
      eventType: 'CUSTOM', eventName: 'product_view', eventSequenceId: 1,
      path: 'pages/detail/index', query: 'id=42', pageShowTimestamp: 99,
      attributes: { count: '0', enabled: 'false', tags: 'a||b' },
    }))
    expect(queue.snapshot()[0]?.event).not.toHaveProperty('title')
    expect(queue.snapshot()[0]?.event).not.toHaveProperty('referralPage')
  })

  it('refuses an invalid name without advancing the shared event sequence', () => {
    const { dispatcher, sequence } = createDispatcher()
    expect(dispatcher.track({ eventName: 'invalid name', properties: {} })).toBe(false)
    expect(sequence.current()).toStrictEqual({ eventSequenceId: 0 })
  })

  it('sends user attributes without a page or sequence dependency', () => {
    const { dispatcher, queue, sequence } = createDispatcher()
    expect(dispatcher.setUserAttributes({ plan: 'pro' })).toBe(true)

    expect(queue.snapshot()[0]?.event).toMatchObject({
      eventType: 'LOGIN_USER_ATTRIBUTES', userId: 'user-1', attributes: { plan: 'pro' },
    })
    expect(queue.snapshot()[0]?.event).not.toHaveProperty('eventSequenceId')
    expect(sequence.current()).toStrictEqual({ eventSequenceId: 0 })
  })

  it('builds VIEW events only from a constrained call and the current shown page', () => {
    const { dispatcher, queue } = createDispatcher()
    expect(dispatcher.autoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]', textValue: 'Buy', index: 0, hyperlink: '/buy' })).toBe(true)
    expect(dispatcher.autoTrack({ schemaVersion: 1, kind: 'change', xpath: '/input[1]', index: 3, hyperlink: '/ignored' })).toBe(true)

    expect(queue.snapshot().map((entry) => entry.event)).toMatchObject([
      { eventType: 'VIEW_CLICK', eventSequenceId: 1, path: 'pages/detail/index', pageShowTimestamp: 99, xpath: '/view[1]', index: 0, hyperlink: '/buy' },
      { eventType: 'VIEW_CHANGE', eventSequenceId: 2, xpath: '/input[1]' },
    ])
    expect(queue.snapshot()[1]?.event).not.toHaveProperty('index')
    expect(queue.snapshot()[1]?.event).not.toHaveProperty('hyperlink')
  })

  it('rejects ignored or sensitive probes and treats change values as opt-in', () => {
    const { dispatcher, queue } = createDispatcher()
    expect(dispatcher.autoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]', ignored: true })).toBe(false)
    expect(dispatcher.autoTrack({ schemaVersion: 1, kind: 'change', xpath: '/input[1]', sensitive: true, trackValue: true, textValue: 'secret' })).toBe(false)
    expect(dispatcher.autoTrack({ schemaVersion: 1, kind: 'change', xpath: '/input[2]', textValue: 'not opted in' })).toBe(true)
    expect(dispatcher.autoTrack({ schemaVersion: 1, kind: 'change', xpath: '/input[3]', trackValue: true, textValue: 'accepted' })).toBe(true)
    expect(queue.snapshot().map((entry) => entry.event)).toMatchObject([
      { eventType: 'VIEW_CHANGE', xpath: '/input[2]' },
      { eventType: 'VIEW_CHANGE', xpath: '/input[3]', textValue: 'accepted' },
    ])
    expect(queue.snapshot()[0]?.event).not.toHaveProperty('textValue')
  })
})
