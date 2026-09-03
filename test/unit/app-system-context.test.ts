import { describe, expect, it } from 'vitest'

import { AppSystemContextPort } from '../../platform/app-system-context.js'

describe('AppSystemContextPort', () => {
  it('maps Android host data to stable protocol context and normalizes screen orientation', async () => {
    const port = new AppSystemContextPort({
      getDeviceInfo: () => ({ platform: 'android', platformVersion: '14', screenWidth: 1920, screenHeight: 1080, brand: 'Google', model: 'Pixel', deviceType: 'PHONE' }),
      getSystemInfoSync: () => ({}),
      getAppBaseInfo: () => ({ packageName: 'com.example', appName: 'Example', version: '2.0', appLanguage: 'zh_hans_cn' }),
    }, '0.1.0', 'fallback')
    await expect(port.load()).resolves.toMatchObject({
      platform: 'Android', domain: 'com.example', screenWidth: 1080, screenHeight: 1920, language: 'zh-Hans-CN', appVersion: '2.0', networkState: 'UNKNOWN',
    })
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
})
