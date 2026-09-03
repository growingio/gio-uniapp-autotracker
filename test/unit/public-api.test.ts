import { describe, expect, it, vi } from 'vitest'

import type { AppRuntimeHost } from '../../platform/app-runtime.js'

describe('public API', () => {
  it('keeps build-time Vite integration out of the App runtime entry', async () => {
    const runtimeApi = await import('../../index.js')
    expect(runtimeApi).not.toHaveProperty('gioUniappAutoTrack')
  })

  it('returns one App runtime for repeated createGioTracker calls', async () => {
    vi.resetModules()
    const { createGioTracker } = await import('../../index.js')
    const host: AppRuntimeHost = {
      getStorageSync: () => undefined, setStorageSync: () => undefined, removeStorageSync: () => undefined,
      getDeviceInfo: () => ({ platform: 'android' }), getSystemInfoSync: () => ({}), getAppBaseInfo: () => ({}),
      getNetworkType: (options) => { options.success({}) },
      request: () => undefined,
    }
    const options = { sdkVersion: '0.1.0', deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1' }

    expect(createGioTracker(host, options)).toBe(createGioTracker(host, options))
  })

  it('does not expose the multi-instance assembly helper from the public runtime entry', async () => {
    const runtimeApi = await import('../../index.js')
    expect(runtimeApi).not.toHaveProperty('createAppTracker')
  })
})
