import { describe, expect, it } from 'vitest'

import { normalizeInitOptions } from '../../core/config.js'
import { EventComposer } from '../../core/event-composer.js'
import { EventSequence } from '../../core/event-sequence.js'
import { LocationState } from '../../core/location-state.js'
import { PageStore } from '../../core/page-store.js'
import type { AppSystemContext } from '../../core/ports.js'
import { EventQueue } from '../../core/queue.js'
import { SessionManager } from '../../core/session.js'
import { AppLifecycle } from '../../runtime/app-lifecycle.js'

const normalized = normalizeInitOptions({ accountId: 'account', dataSourceId: 'source' })
if (normalized.ok === false) throw new Error('fixture_config_invalid')
const config = normalized.config

const system: AppSystemContext = {
  platform: 'iOS', platformVersion: '18', domain: 'com.example.app', appState: 'FOREGROUND', appName: 'Example',
  networkState: 'WIFI', screenWidth: 390, screenHeight: 844, deviceBrand: 'Apple', deviceModel: 'iPhone',
  deviceType: 'PHONE', appVersion: '1.0.0', language: 'en-US', sdkVersion: '0.1.0',
}

function createLifecycle(initialCollection = true) {
  let now = 0
  let collect = initialCollection
  let persisted = 0
  let flushed = 0
  const sessions = new SessionManager(config.sessionPolicy, (() => {
    let index = 0
    return () => `session-${++index}`
  })())
  const queue = new EventQueue()
  const pages = new PageStore()
  const lifecycle = new AppLifecycle({
    sessions,
    composer: new EventComposer(
      config, system, () => ({ deviceId: 'device-1', userId: null, userKey: null }), sessions,
      new EventSequence(), queue, { now: () => now }, { getOffsetMinutes: () => 0 }, new LocationState(),
    ),
    clock: { now: () => now },
    canCollect: () => collect,
    currentPage: () => pages.current(),
    persistSession: () => { persisted += 1 },
    forceFlush: () => { flushed += 1 },
  })
  return {
    lifecycle, queue, sessions, pages,
    setNow: (value: number) => { now = value },
    setCollection: (value: boolean) => { collect = value },
    calls: () => ({ persisted, flushed }),
  }
}

describe('AppLifecycle', () => {
  it('records launch without a duplicate VISIT, then sends the onShow entry', () => {
    const { lifecycle, queue } = createLifecycle()
    lifecycle.onLaunch({ path: '/launch', query: 'from=launch' })
    expect(queue.snapshot()).toHaveLength(0)

    expect(lifecycle.onShow({ path: '/home', query: 'tab=feed' })).toMatchObject({
      session: { startedNew: true, reason: 'initial' }, visitQueued: true,
    })
    expect(queue.snapshot()[0]?.event).toMatchObject({ eventType: 'VISIT', path: '/home', query: 'tab=feed' })
    expect(lifecycle.entry()).toStrictEqual({
      launch: { path: '/launch', query: 'from=launch' }, current: { path: '/home', query: 'tab=feed' },
    })
  })

  it('continues a hot session without VISIT, while onHide queues APP_CLOSED then persists and flushes', () => {
    const { lifecycle, queue, pages, setNow, calls } = createLifecycle()
    lifecycle.onShow({ path: '/home', query: '' })
    pages.onLoad({ instanceId: 'home#1', route: 'pages/home/index', query: 'tab=feed', referralPage: null })
    pages.onShow('home#1', 1, null)
    setNow(10)
    expect(lifecycle.onHide()).toMatchObject({ appClosedQueued: true, session: { lastCloseTime: 10 } })
    setNow(30_010)
    expect(lifecycle.onShow({ path: '/home', query: '' })).toMatchObject({
      session: { startedNew: false }, visitQueued: false,
    })
    expect(queue.snapshot().map((entry) => entry.event.eventType)).toStrictEqual(['VISIT', 'APP_CLOSED'])
    expect(queue.snapshot()[1]?.event).toMatchObject({ appState: 'BACKGROUND', path: 'pages/home/index', query: 'tab=feed' })
    expect(calls()).toStrictEqual({ persisted: 3, flushed: 1 })
  })

  it('starts a new session and VISIT strictly after the 30 second default timeout', () => {
    const { lifecycle, queue, setNow } = createLifecycle()
    lifecycle.onShow({ path: '/home', query: '' })
    lifecycle.onHide()
    setNow(30_001)

    expect(lifecycle.onShow({ path: '/return', query: 'source=push' })).toMatchObject({
      session: { startedNew: true, reason: 'timeout', snapshot: { sessionId: 'session-2' } }, visitQueued: true,
    })
    expect(queue.snapshot().filter((entry) => entry.event.eventType === 'VISIT')).toHaveLength(2)
  })

  it('keeps state while collection is disabled and explicitly renews before replaying VISIT after consent', () => {
    const { lifecycle, queue, sessions, setCollection, calls } = createLifecycle(false)
    expect(lifecycle.onShow({ path: '/privacy', query: '' })).toMatchObject({ visitQueued: false })
    expect(sessions.current()).toMatchObject({ sessionId: 'session-1' })
    setCollection(true)
    expect(lifecycle.onCollectionResumed()).toMatchObject({
      session: { startedNew: true, reason: 'collection_resumed', snapshot: { sessionId: 'session-2' } }, visitQueued: true,
    })
    expect(queue.snapshot().map((entry) => entry.event.eventType)).toStrictEqual(['VISIT'])
    expect(calls()).toStrictEqual({ persisted: 2, flushed: 0 })
  })
})
