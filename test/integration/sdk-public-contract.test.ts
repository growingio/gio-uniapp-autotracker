import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProtocolEvent } from '../../src/core/dataStore/protocol.js'
import type { AppRuntimeHost } from '../../src/platform/index.js'
import type { TrackerRuntime } from '../../src/core/growingIO.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.stubGlobal('gdp', undefined)
  for (const method of ['info', 'warn', 'error', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

/** 创建指定平台的受控 SDK，供公开命令到协议报文的契约验证。 */
async function sdk(platform = 'android') {
  const values = new Map<string, string>()
  const received: ProtocolEvent[] = []
  const host: AppRuntimeHost = {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => { values.set(key, value) },
    removeStorageSync: key => { values.delete(key) },
    getDeviceInfo: () => ({ platform }),
    getSystemInfoSync: () => ({ deviceOrientation: 'portrait' }),
    getAppBaseInfo: () => ({ appVersion: '1.0.0' }),
    getNetworkType: options => options.success({ networkType: 'wifi' }),
    request: options => { received.push(...JSON.parse(options.data)); options.success({ statusCode: 204 }) },
  }
  vi.stubGlobal('uni', host)
  const { gdp } = await import('../../index.js')
  const call = gdp as (command: unknown, ...args: unknown[]) => boolean
  const mixin = vi.fn()
  const app = { mixin }
  const start = async (options = {}) => {
    let tracker: TrackerRuntime | undefined
    expect(gdp('registerPlugins', [{ name: 'test-runtime', install: value => { tracker = value } }])).toBe(true)
    expect(gdp('init', 'account', 'source', { uniVue: app, ...options })).toBe(true)
    expect(tracker).toBeDefined()
    expect(await tracker!.whenReady()).toBe(true)
    return tracker!
  }
  return { gdp, call, host, app, received, values, start }
}

describe('SDK 公共命令与完整核心链路', () => {
  it.each([['android', 'Android'], ['ios', 'iOS'], ['harmonyos', 'HarmonyOS']])(
    '%s 宿主下覆盖同意采集、会话、页面、身份、属性、位置、无埋点及后台上传', async (hostPlatform, protocolPlatform) => {
      vi.stubGlobal('__GIO_AUTOTRACK_VERIFICATION__', true)
      const { gdp, received, start } = await sdk(hostPlatform)
      expect(gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])).toBe(true)
      const tracker = await start({ dataCollect: false, idMapping: true, debug: true })
      tracker.onAppLaunch({ path: '/entry', query: 'campaign=release' })
      tracker.onAppShow({ path: '/entry', query: 'campaign=release' })
      tracker.onPageLoad({ instanceId: 'home', route: 'pages/home', query: 'tab=1', referralPage: null })
      tracker.onPageShow('home', '首页')
      expect(gdp('track', 'before_consent')).toBe(false)
      expect(received).toEqual([])

      expect(gdp('setOptions', { dataCollect: true })).toBe(true)
      expect(received.map(event => event.eventType)).toEqual(['VISIT', 'PAGE'])
      expect(gdp('setUserId', 'user-a', 'account-key')).toBe(true)
      expect(gdp('setUserAttributes', { plan: 'pro', active: false })).toBe(true)
      expect(gdp('setLocation', 30.2, 120.1)).toBe(true)
      expect(gdp('track', 'purchase', { price: 0, paid: false, tags: ['a', 'b'] })).toBe(true)
      expect(received.at(-1)).toMatchObject({ platform: protocolPlatform, eventName: 'purchase', userId: 'user-a', userKey: 'account-key',
        latitude: 30.2, longitude: 120.1, attributes: { price: '0', paid: 'false', tags: 'a||b' } })
      expect(gdp('setUserId', 'user-b', 'account-key')).toBe(true)
      expect(received.at(-1)).toMatchObject({ eventType: 'VISIT', userId: 'user-b' })
      expect(gdp('clearUserId')).toBe(true)
      expect(gdp('clearLocation')).toBe(true)
      expect(gdp('track', 'anonymous')).toBe(true)
      for (const field of ['userId', 'userKey', 'latitude', 'longitude']) expect(received.at(-1)).not.toHaveProperty(field)

      const { dispatchAutoTrack } = await import('../../autotrack.js')
      expect(dispatchAutoTrack({ schemaVersion: 2, source: 'template', kind: 'click', eventName: 'buy' }, { currentTarget: { id: 'buy' } })).toBe(true)
      expect(received.at(-1)).toMatchObject({ eventType: 'VIEW_CLICK', xpath: 'buy#buy' })
      expect(dispatchAutoTrack({ schemaVersion: 2, source: 'template', kind: 'change', eventName: 'toggle', elementType: 'switch', trackValue: true },
        { currentTarget: { id: 'toggle' }, detail: { value: false } })).toBe(true)
      expect(received.at(-1)).toMatchObject({ eventType: 'VIEW_CHANGE', xpath: 'toggle#toggle', textValue: 'false' })
      expect(received.map(event => event.eventType)).toEqual(['VISIT', 'PAGE', 'LOGIN_USER_ATTRIBUTES', 'CUSTOM', 'VISIT', 'CUSTOM', 'VIEW_CLICK', 'VIEW_CHANGE'])
      expect(tracker.queuedEvents()).toEqual([])
      expect(tracker.onAppHide()).toBe(true)
      expect(received).toHaveLength(9)
      expect(received.at(-1)).toMatchObject({ eventType: 'APP_CLOSED', appState: 'BACKGROUND' })
      expect(received.at(-1)).not.toHaveProperty('eventSequenceId')
      const sequence = received.flatMap(event => event.eventSequenceId === undefined ? [] : [event.eventSequenceId])
      expect(sequence).toEqual(sequence.map((_, index) => index + 1))
      expect(tracker.queuedEvents()).toEqual([])
      expect(gdp('setOptions', { dataCollect: false })).toBe(true)
      const count = received.length
      expect(gdp('track', 'after_opt_out')).toBe(false)
      expect(dispatchAutoTrack({ schemaVersion: 2, source: 'template', kind: 'click', eventName: 'blocked' })).toBe(false)
      expect(received).toHaveLength(count)
    },
  )

  it('初始化前所有业务命令拒绝执行，不产生请求和存储副作用', async () => {
    const { call, received, values } = await sdk()
    for (const [command, ...args] of [
      ['track', 'event'], ['setUserId', 'user'], ['clearUserId'], ['setUserAttributes', { role: 'member' }],
      ['setOptions', { dataCollect: true }], ['setLocation', 0, 0], ['clearLocation'], ['unknown'],
    ]) expect(call(command, ...args)).toBe(false)
    expect(received).toEqual([])
    expect(values.size).toBe(0)
  })

  it('插件注册整批校验，失败批次不残留，也不消耗后续注册机会', async () => {
    const { gdp, call, start } = await sdk()
    const install = vi.fn()
    for (const invalid of [null, {}, [{ name: 'bad' }], [{ name: 'gioEventAutoTracking', options: { unexpected: true } }]]) {
      expect(call('registerPlugins', invalid)).toBe(false)
    }
    const plugin = { name: 'customer', install }
    expect(call('registerPlugins', [plugin, { name: 'invalid' }])).toBe(false)
    expect(gdp('registerPlugins', [plugin, plugin])).toBe(false)
    expect(gdp('registerPlugins', [plugin])).toBe(true)
    expect(gdp('registerPlugins', [plugin])).toBe(false)
    await start()
    expect(install).toHaveBeenCalledOnce()
    expect(gdp('registerPlugins', [{ name: 'too-late', install }])).toBe(false)
  })

  it('失败初始化保留声明顺序，插件异常不会中断后续安装，重复初始化不会再次安装', async () => {
    const { gdp, call, app, start } = await sdk()
    const order: string[] = []
    expect(gdp('registerPlugins', [
      { name: 'first', install: () => { order.push('first'); throw new Error('plugin failed') } },
      { name: 'second', install: () => { order.push('second') } },
    ])).toBe(true)
    expect(call('init', 123, 'source', { uniVue: app })).toBe(false)
    expect(call('init', 'account', 'source', { uniVue: {} })).toBe(false)
    expect(gdp('init', '', 'source', { uniVue: app })).toBe(false)
    expect(order).toEqual([])
    const tracker = await start()
    expect(order).toEqual(['first', 'second'])
    expect(app.mixin).toHaveBeenCalledOnce()
    expect(gdp('init', 'account', 'source', { uniVue: app })).toBe(false)
    expect(order).toEqual(['first', 'second'])
    tracker.onAppShow({ path: '/entry', query: '' })
    expect(gdp('setUserId', 'user', 'ignored-key')).toBe(true)
    expect(console.warn).toHaveBeenCalledWith('[GrowingIO]: custom plugin install failed (first)')
    expect(console.warn).toHaveBeenCalledWith('[GrowingIO]: userKey ignored because idMapping is disabled')
  })
})
