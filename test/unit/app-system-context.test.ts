import { describe, expect, it } from 'vitest'

import { AppSystemContextPort } from '../../platform/app-system-context.js'

describe('AppSystemContextPort', () => {
  it('maps Android host data to stable protocol context and normalizes screen orientation', async () => {
    const port = new AppSystemContextPort({
      getDeviceInfo: () => ({ platform: 'android', platformVersion: '14', screenWidth: 360, screenHeight: 640, brand: 'Google', model: 'Pixel', deviceType: 'PHONE' }),
      getSystemInfoSync: () => ({}),
      getAppBaseInfo: () => ({ packageName: 'com.example', appName: 'Example', version: '2.0', appLanguage: 'zh_hans_cn' }),
    }, '0.1.0', 'fallback')
    await expect(port.load()).resolves.toMatchObject({
      platform: 'Android', domain: 'com.example', screenWidth: 360, screenHeight: 640, deviceType: 'PHONE', language: 'zh-Hans-CN', appVersion: '2.0', networkState: 'UNKNOWN',
    })
  })

  it('classifies Android device type from the standard 600dp shortest-edge threshold', async () => {
    const port = new AppSystemContextPort({
      getDeviceInfo: () => ({ platform: 'android', deviceType: 'unknown', screenWidth: 800, screenHeight: 1280 }),
      getSystemInfoSync: () => ({ deviceType: 'phone' }),
      getAppBaseInfo: () => ({ packageName: 'com.example' }),
    }, '0.1.0', null)
    await expect(port.load()).resolves.toMatchObject({ platform: 'Android', deviceType: 'PAD' })
  })

  it('uses documented fallbacks for optional fields and rejects non-App platforms', async () => {
    const fallback = new AppSystemContextPort({
      getDeviceInfo: () => ({ platform: 'ios' }),
      getSystemInfoSync: () => ({ screenWidth: 0, screenHeight: 10 }),
      getAppBaseInfo: () => ({ bundleId: '', language: 'not a language' }),
    }, '0.1.0', 'fallback')
    await expect(fallback.load()).resolves.toMatchObject({
      platform: 'iOS', platformVersion: 'UNKNOWN', domain: '', screenWidth: 0, screenHeight: 0, deviceBrand: 'UNKNOWN', appVersion: 'fallback', language: 'und',
    })
    const unsupported = new AppSystemContextPort({ getDeviceInfo: () => ({ platform: 'devtools' }), getSystemInfoSync: () => ({}), getAppBaseInfo: () => ({}) }, '0.1.0', null)
    await expect(unsupported.load()).rejects.toThrow('unsupported_platform')
  })

  it('reads HarmonyOS device field names emitted by uni.getDeviceInfo', async () => {
    const port = new AppSystemContextPort({
      getDeviceInfo: () => ({ platform: 'harmonyos', platformVersion: '6.1', deviceBrand: 'huawei', deviceModel: 'BRA-AL00', deviceType: 'PHONE' }),
      getSystemInfoSync: () => ({}),
      getAppBaseInfo: () => ({ bundleName: 'com.example.harmony' }),
    }, '0.1.0', null)
    await expect(port.load()).resolves.toMatchObject({
      platform: 'HarmonyOS', deviceBrand: 'huawei', deviceModel: 'BRA-AL00',
    })
  })
})
