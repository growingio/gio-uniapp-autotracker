import { describe, expect, it, vi } from 'vitest'

import { createAppTracker } from '../../platform/app-runtime.js'
import { dispatchAutoTrack } from '../../runtime/autotrack-dispatch.js'

describe('createAppTracker', () => {
  it('initializes and sends change events when the App engine has no Object.hasOwn', async () => {
    const payloads: string[] = []
    const tracker = createAppTracker({
      getStorageSync: () => undefined, setStorageSync: () => undefined, removeStorageSync: () => undefined,
      getDeviceInfo: () => ({ platform: 'android' }), getSystemInfoSync: () => ({}), getAppBaseInfo: () => ({}),
      getNetworkType: (options) => { options.success({ networkType: 'wifi' }) },
      request: (options) => { payloads.push(options.data); options.success({ statusCode: 204 }) },
    }, { sdkVersion: '0.1.0', deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1' })
    const originalHasOwn = Object.hasOwn
    let ready = false
    let acceptedChange = false
    let changedOptions = false
    try {
      // 使用真实 App 装配链路，模拟没有 ES2022 Object.hasOwn 的宿主。
      Object.hasOwn = undefined as unknown as typeof Object.hasOwn
      vi.stubGlobal('__GIO_AUTOTRACK_VERIFICATION__', true)
      tracker.registerPlugins({ name: 'gioEventAutoTracking' })
      tracker.init({ accountId: 'account', dataSourceId: 'source' })
      tracker.onAppShow({ path: '/home', query: '' })
      tracker.onPageLoad({ instanceId: 'home#1', route: 'pages/home/index', query: '', referralPage: null })
      tracker.onPageShow('home#1', null)
      ready = await tracker.whenReady()
      acceptedChange = dispatchAutoTrack({ schemaVersion: 2, source: 'template', kind: 'change', eventName: 'onSwitchChange', elementType: 'switch', trackValue: true }, {
        currentTarget: { id: 'subscription', dataset: {} }, detail: { value: false },
      })
      changedOptions = tracker.setOptions({ dataCollect: false })
    } finally {
      Object.hasOwn = originalHasOwn
      vi.unstubAllGlobals()
    }
    expect(ready).toBe(true)
    expect(tracker.failed()).toBe(false)
    expect(acceptedChange).toBe(true)
    expect(changedOptions).toBe(true)
    expect(payloads.flatMap((payload) => JSON.parse(payload))).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'VISIT' }),
      expect.objectContaining({ eventType: 'PAGE' }),
      expect.objectContaining({ eventType: 'VIEW_CHANGE', xpath: 'subscription#onSwitchChange', textValue: 'false' }),
    ]))
  })

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
    expect(dispatchAutoTrack({ schemaVersion: 2, source: 'template', kind: 'click', eventName: 'save' })).toBe(false)
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
