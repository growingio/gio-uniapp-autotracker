import { describe, expect, it } from 'vitest'

import { createAppTracker } from '../../platform/app-runtime.js'
import { dispatchAutoTrack } from '../../runtime/autotrack-dispatch.js'

describe('createAppTracker', () => {
  it('assembles App ports and reads appVersion fallback only after init config is available', async () => {
    const requests: string[] = []
    const tracker = createAppTracker({
      getStorageSync: () => undefined, setStorageSync: () => undefined, removeStorageSync: () => undefined,
      getDeviceInfo: () => ({ platform: 'android', platformVersion: '14', screenWidth: 1080, screenHeight: 1920, brand: 'Google', model: 'Pixel', deviceType: 'PHONE' }),
      getSystemInfoSync: () => ({ deviceOrientation: 'portrait', windowWidth: 390, windowHeight: 844 }),
      getAppBaseInfo: () => ({ packageName: 'com.example.app', appName: 'Example', version: '' }),
      getNetworkType: (options) => { options.success({ networkType: 'wifi' }) },
      request: (options) => { requests.push(options.url); options.success({ statusCode: 204 }) },
    }, { sdkVersion: '0.1.0', deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1' })

    expect(tracker.init({ accountId: 'account', dataSourceId: 'source', appVersion: 'fallback' })).toBe(true)
    tracker.onAppShow({ path: '/home', query: '' })
    await tracker.whenReady()
    expect(requests).toHaveLength(1)
    expect(tracker.queuedEvents()).toStrictEqual([])
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/x' })).toBe(false)
  })

  it('waits for the initial network read before composing the first VISIT', async () => {
    const payloads: string[] = []
    const tracker = createAppTracker({
      getStorageSync: () => undefined, setStorageSync: () => undefined, removeStorageSync: () => undefined,
      getDeviceInfo: () => ({ platform: 'harmonyos', deviceBrand: 'huawei', deviceModel: 'BRA-AL00' }),
      getSystemInfoSync: () => ({ deviceOrientation: 'portrait', windowWidth: 390, windowHeight: 844 }),
      getAppBaseInfo: () => ({ bundleName: 'com.example.harmony' }),
      getNetworkType: (options) => { options.success({ networkType: 'wifi' }) },
      request: (options) => { payloads.push(options.data); options.success({ statusCode: 204 }) },
    }, { sdkVersion: '0.1.0', deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1' })

    expect(tracker.init({ accountId: 'account', dataSourceId: 'source' })).toBe(true)
    tracker.onAppShow({ path: '/home', query: '' })
    await tracker.whenReady()
    expect(JSON.parse(payloads[0] ?? '')[0]).toMatchObject({
      eventType: 'VISIT', networkState: 'WIFI', deviceBrand: 'huawei', deviceModel: 'BRA-AL00',
    })
  })
})
