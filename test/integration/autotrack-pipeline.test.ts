import { describe, expect, it } from 'vitest'

import { transformAutoTrackSfc } from '../../autotrack/vite.js'
import type { AppSystemContext, StorageArea, StoragePort, StorageRead, StorageWrite } from '../../core/ports.js'
import { dispatchAutoTrack, installAutoTrackDispatcher } from '../../runtime/autotrack-dispatch.js'
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

describe('Vue autotrack static pipeline', () => {
  it('connects a rewritten SFC probe to the plugin-gated runtime queue using only a JSON snapshot', async () => {
    const source = '<template><input data-growing-track @change="save" /></template><script setup>const save = () => undefined</script>'
    const transformed = transformAutoTrackSfc(source, '@sdk/runtime')
    expect(transformed.code).toContain('dispatchAutoTrack as __gioAutoTrack')
    expect(transformed.code).toContain('__gioAutoTrack({schemaVersion:1,kind:`change`,xpath:`/input[1]`,trackValue:true},$event);save($event)')
    expect(transformed.code).toContain('from "@sdk/runtime"\nconst save')

    const tracker = new TrackerRuntime({
      storage: new MemoryStorage(), systemContext: { load: async () => system }, clock: { now: () => 100 },
      timezone: { getOffsetMinutes: () => -480 }, deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1',
      orientation: () => 'PORTRAIT',
    })
    installAutoTrackDispatcher(tracker)
    expect(tracker.registerPlugins({ name: 'gioEventAutoTracking' })).toBe(true)
    expect(tracker.init({ accountId: 'account', dataSourceId: 'source' })).toBe(true)
    tracker.onAppShow({ path: '/home', query: '' })
    tracker.onPageLoad({ instanceId: 'home#1', route: 'pages/home/index', query: '', referralPage: null })
    tracker.onPageShow('home#1', null)
    await tracker.whenReady()

    const nativeEvent = { currentTarget: { type: 'text', dataset: { growingTrack: true } }, detail: { value: 'accepted' } }
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'change', xpath: '/input[1]' }, nativeEvent)).toBe(true)
    expect(tracker.queuedEvents().at(-1)).toMatchObject({
      eventType: 'VIEW_CHANGE', path: 'pages/home/index', xpath: '/input[1]', textValue: 'accepted',
    })
  })
})
