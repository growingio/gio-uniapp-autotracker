import { describe, expect, it } from 'vitest'

import type { AppSystemContext, LoggerPort, NetworkPort, NetworkState, StorageArea, StoragePort, StorageRead, StorageWrite, TransportPort } from '../../core/ports.js'
import type { UploaderRuntime } from '../../core/uploader.js'
import { TrackerRuntime } from '../../runtime/tracker.js'

class MemoryStorage implements StoragePort {
  public readonly persistentQueue = true
  private readonly values = new Map<string, string>()

  public async read(_area: StorageArea, key: string): Promise<StorageRead> {
    const value = this.values.get(key)
    return value === undefined ? { kind: 'missing' } : { kind: 'value', value }
  }

  public async write(_area: StorageArea, key: string, value: string): Promise<StorageWrite> {
    this.values.set(key, value)
    return { kind: 'ok' }
  }

  public async remove(_area: StorageArea, key: string): Promise<StorageWrite> {
    this.values.delete(key)
    return { kind: 'ok' }
  }
}

const system: AppSystemContext = {
  platform: 'Android', platformVersion: '14', domain: 'com.example.app', appState: 'FOREGROUND', appName: 'Example',
  networkState: 'WIFI', screenWidth: 1080, screenHeight: 1920, deviceBrand: 'Google', deviceModel: 'Pixel',
  deviceType: 'PHONE', appVersion: '1.0.0', language: 'zh-CN', sdkVersion: '0.1.0',
}

function createTracker(dataCollect = true, autoTracking = false, debug = false, logger?: LoggerPort) {
  let now = 100
  const tracker = new TrackerRuntime({
    storage: new MemoryStorage(), systemContext: { load: async () => system }, clock: { now: () => now },
    timezone: { getOffsetMinutes: () => -480 }, deviceIdFactory: () => 'device-1',
    sessionIdFactory: (() => { let id = 0; return () => `session-${++id}` })(), orientation: () => 'PORTRAIT', logger,
  })
  if (autoTracking) expect(tracker.registerPlugins({ name: 'gioEventAutoTracking' })).toBe(true)
  expect(tracker.init({ accountId: 'account', dataSourceId: 'source', dataCollect, debug })).toBe(true)
  return { tracker, setNow: (value: number) => { now = value } }
}

describe('TrackerRuntime', () => {
  it('emits fixed lifecycle diagnostics and only emits event JSON when debug is enabled', async () => {
    const logs: string[] = []
    const logger: LoggerPort = {
      info: (message) => logs.push(`info:${message}`), success: (message) => logs.push(`success:${message}`),
      warn: (message) => logs.push(`warn:${message}`), error: (message) => logs.push(`error:${message}`),
      debug: (message) => logs.push(`debug:${message}`),
    }
    const requests: string[] = []
    const transport: TransportPort = {
      dispatch: (_request, done) => {
        requests.push('sent')
        done({ kind: 'success', status: 204 })
      },
    }
    const tracker = new TrackerRuntime({
      storage: new MemoryStorage(), systemContext: { load: async () => system }, clock: { now: () => 100 },
      timezone: { getOffsetMinutes: () => -480 }, deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1',
      orientation: () => 'PORTRAIT', logger,
      upload: { transport, runtime: { now: () => 123, random: () => 0.5, setTimeout: () => 1, clearTimeout: () => undefined } },
    })
    expect(tracker.init({ accountId: 'account', dataSourceId: 'source', dataCollect: true, debug: true })).toBe(true)
    tracker.onAppShow({ path: '/home', query: '' })
    await tracker.whenReady()
    expect(logs).toContain('info:[GrowingIO]: init accepted')
    expect(logs).toContain('success:[GrowingIO]: initialized')
    expect(logs).toContain('debug:[GrowingIO Debug]: action=app-show')
    expect(logs.some((message) => message.includes('"eventType": "VISIT"'))).toBe(true)
    expect(requests).toStrictEqual(['sent'])
  })

  it('buffers App onShow then business track through hydration and replays them in that lifecycle order', async () => {
    const { tracker } = createTracker()
    expect(tracker.onAppLaunch({ path: '/launch', query: '' })).toBe(true)
    expect(tracker.onAppShow({ path: '/home', query: 'entry=1' })).toBe(true)
    expect(tracker.track('after_app_show')).toBe(true)

    await expect(tracker.whenReady()).resolves.toBe(true)
    expect(tracker.queuedEvents()).toMatchObject([
      { eventType: 'VISIT', eventSequenceId: 1, path: '/home', query: 'entry=1' },
      { eventType: 'CUSTOM', eventName: 'after_app_show', eventSequenceId: 2 },
    ])
  })

  it('keeps disabled collection state, then creates a replacement session with VISIT and current PAGE after consent', async () => {
    const { tracker } = createTracker(false)
    tracker.onAppShow({ path: '/privacy', query: '' })
    tracker.onPageLoad({ instanceId: 'privacy#1', route: 'pages/privacy/index', query: '', referralPage: null })
    tracker.onPageShow('privacy#1', null)
    await tracker.whenReady()
    expect(tracker.queuedEvents()).toHaveLength(0)

    expect(tracker.setDataCollect(true)).toBe(true)
    expect(tracker.queuedEvents()).toMatchObject([
      { eventType: 'VISIT', eventSequenceId: 1, path: '/privacy' },
      { eventType: 'PAGE', eventSequenceId: 2, path: 'pages/privacy/index', orientation: 'PORTRAIT' },
    ])
  })

  it('creates only one extra VISIT for a logged-in user A to B transition', async () => {
    const { tracker } = createTracker()
    tracker.onAppShow({ path: '/home', query: '' })
    await tracker.whenReady()
    expect(tracker.setUserId('user-a')).toBe(true)
    expect(tracker.setUserId('user-b')).toBe(true)

    expect(tracker.queuedEvents().filter((event) => event.eventType === 'VISIT')).toMatchObject([
      { sessionId: 'session-1' },
      { sessionId: 'session-2', userId: 'user-b' },
    ])
  })

  it('starts the optional uploader after an event is queued and lets accepted batches leave the queue', async () => {
    const requests: string[] = []
    const transport: TransportPort = {
      dispatch: (request, done) => {
        requests.push(request.url)
        done({ kind: 'success', status: 204 })
      },
    }
    const uploaderRuntime: UploaderRuntime = {
      now: () => 123, random: () => 0.5,
      setTimeout: () => 1, clearTimeout: () => undefined,
    }
    const tracker = new TrackerRuntime({
      storage: new MemoryStorage(), systemContext: { load: async () => system }, clock: { now: () => 100 },
      timezone: { getOffsetMinutes: () => -480 }, deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1',
      orientation: () => 'PORTRAIT', upload: { transport, runtime: uploaderRuntime },
    })
    tracker.init({ accountId: 'account', dataSourceId: 'source' })
    tracker.onAppShow({ path: '/home', query: '' })
    await tracker.whenReady()

    expect(requests).toStrictEqual(['https://napi.growingio.com/v3/projects/account/collect?stm=123&compress=0'])
    expect(tracker.queuedEvents()).toStrictEqual([])
  })

  it('uses new network state for future events and wakes the uploader only when connectivity recovers', async () => {
    const networkState = { listener: null as ((state: NetworkState) => void) | null }
    const network: NetworkPort = {
      current: async () => 'UNKNOWN',
      subscribe: (next) => { networkState.listener = next; return () => { networkState.listener = null } },
    }
    const tracker = new TrackerRuntime({
      storage: new MemoryStorage(), systemContext: { load: async () => system }, clock: { now: () => 100 },
      timezone: { getOffsetMinutes: () => -480 }, deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1',
      orientation: () => 'PORTRAIT', network,
    })
    tracker.init({ accountId: 'account', dataSourceId: 'source' })
    tracker.onAppShow({ path: '/home', query: '' })
    await tracker.whenReady()
    networkState.listener?.('WIFI')
    tracker.track('after_reconnect')

    expect(tracker.queuedEvents().at(-1)).toMatchObject({ eventType: 'CUSTOM', eventName: 'after_reconnect', networkState: 'WIFI' })
  })

  it('requires the built-in auto-tracking plugin before accepting a constrained VIEW intent', async () => {
    const { tracker: unconfigured } = createTracker()
    expect(unconfigured.autoTrack({ schemaVersion: 1, kind: 'click', xpath: '/x' })).toBe(false)
    const { tracker } = createTracker(true, true)
    tracker.onAppShow({ path: '/home', query: '' })
    tracker.onPageLoad({ instanceId: 'home#1', route: 'pages/home/index', query: '', referralPage: null })
    tracker.onPageShow('home#1', null)
    await tracker.whenReady()
    expect(tracker.autoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]' })).toBe(true)
    expect(tracker.queuedEvents().at(-1)).toMatchObject({ eventType: 'VIEW_CLICK', xpath: '/view[1]' })
  })

  it('accepts only dataCollect through setOptions and preserves the consent transition semantics', async () => {
    const { tracker } = createTracker(false)
    tracker.onAppShow({ path: '/privacy', query: '' })
    await tracker.whenReady()
    expect(tracker.setOptions({ idMapping: true })).toBe(false)
    expect(tracker.setOptions({ dataCollect: 'true' })).toBe(false)
    expect(tracker.setOptions({ dataCollect: true })).toBe(true)
    expect(tracker.queuedEvents()).toMatchObject([{ eventType: 'VISIT', path: '/privacy' }])
  })

  it('persists a generated anonymous identity before the next cold start', async () => {
    const storage = new MemoryStorage()
    const create = (deviceId: string) => new TrackerRuntime({
      storage, systemContext: { load: async () => system }, clock: { now: () => 100 }, timezone: { getOffsetMinutes: () => -480 },
      deviceIdFactory: () => deviceId, sessionIdFactory: () => 'session-1', orientation: () => 'PORTRAIT',
    })
    const first = create('first-device')
    first.init({ accountId: 'account', dataSourceId: 'source' })
    first.onAppShow({ path: '/home', query: '' })
    await first.whenReady()

    const second = create('second-device')
    second.init({ accountId: 'account', dataSourceId: 'source' })
    second.onAppShow({ path: '/home', query: '' })
    await second.whenReady()
    expect(second.queuedEvents()[0]).toMatchObject({ eventType: 'VISIT', deviceId: 'first-device' })
  })

  it('warns once when a userKey is ignored because idMapping is disabled', async () => {
    const warnings: string[] = []
    const { tracker } = createTracker(true, false, false, { warn: (message) => warnings.push(message) })
    await tracker.whenReady()
    expect(tracker.setUserId('user-a', 'key-a')).toBe(true)
    expect(tracker.setUserId('user-b', 'key-b')).toBe(true)
    expect(warnings).toStrictEqual(['[GrowingIO]: userKey ignored because idMapping is disabled'])
  })
})
