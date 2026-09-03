import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { transformAutoTrackSfc } from '../../autotrack/vite.js'
import type { AppRuntimeHost } from '../../platform/app-runtime.js'
import type { ProtocolEvent } from '../../core/protocol.js'
import type { TrackerRuntime } from '../../runtime/tracker.js'

type LifecycleHooks = Readonly<{
  onLaunch: (this: Record<string, unknown>, options: unknown) => void
  onShow: (this: Record<string, unknown>, options: unknown) => void
  onHide: (this: Record<string, unknown>) => void
  onLoad: (this: Record<string, unknown>, query: unknown) => void
  onUnload: (this: Record<string, unknown>) => void
}>

function demoFile(path: string): string {
  return readFileSync(resolve(import.meta.dirname, '..', '..', 'demo', path), 'utf8')
}

function demoHost(received: ProtocolEvent[]): AppRuntimeHost {
  const storage = new Map<string, unknown>()
  return {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: (key) => { storage.delete(key) },
    getDeviceInfo: () => ({ platform: 'android', brand: 'Google', model: 'Pixel' }),
    getSystemInfoSync: () => ({ screenWidth: 1080, screenHeight: 1920, language: 'zh-CN' }),
    getAppBaseInfo: () => ({ appName: 'Demo', appVersion: '1.0.0', appId: 'io.demo.growing' }),
    getNetworkType: (options) => { options.success({ networkType: 'wifi' }) },
    request: (options) => {
      received.push(...JSON.parse(options.data) as ProtocolEvent[])
      options.success({ statusCode: 204 })
    },
  }
}

describe('demo scenarios', () => {
  it('keeps customer integration in main.ts and maps every showcase entry to a real feature page', () => {
    const main = demoFile('main.ts')
    expect(main).toContain("gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])")
    expect(main).toContain("gdp('init', 'demo-account', 'demo-source'")
    expect(main).toContain('uniVue: app')
    expect(main).not.toMatch(/deviceIdFactory|sessionIdFactory|createGioTracker|createAppLifecycleBridge|createPageLifecycleBridge/)

    expect(demoFile('main.ts')).toContain("import gdp from '@/uni_modules/gio-uniapp-autotracker/index.js'")

    const pages = JSON.parse(demoFile('pages.json')) as Readonly<{ pages: readonly { path: string }[]; tabBar: { list: readonly { pagePath: string }[] } }>
    const expected = ['index', 'custom-event', 'user', 'lifecycle', 'autotrack', 'route', 'datacollect']
    expect(pages.pages.map((page) => page.path)).toStrictEqual(expected.map((name) => `pages/${name}/${name}`))
    expect(pages.tabBar.list.map((page) => page.pagePath)).toStrictEqual([
      'pages/index/index', 'pages/custom-event/custom-event', 'pages/user/user', 'pages/autotrack/autotrack',
    ])

    const commandExpectations: Readonly<Record<string, readonly string[]>> = {
      'pages/index/index.vue': ["gdp('track', 'home_quick_track'"],
      'pages/custom-event/custom-event.vue': ["gdp('track', 'product_exposure'", "gdp('not_a_public_command')"],
      'pages/user/user.vue': ["gdp('setUserId'", "gdp('clearUserId')", "gdp('setUserAttributes'", "gdp('setLocation'", "gdp('clearLocation'"],
      'pages/lifecycle/lifecycle.vue': ["gdp('track', 'lifecycle_demo_action'", "gdp('registerPlugins'"],
      'pages/datacollect/datacollect.vue': ["gdp('setOptions'", "gdp('track', 'datacollect_test_event'"],
    }
    for (const [path, commands] of Object.entries(commandExpectations)) {
      const source = demoFile(path)
      for (const command of commands) expect(source).toContain(command)
      expect(source).not.toContain('$gio')
      expect(source).not.toMatch(/from\s+['"]@\/gio['"]|from\s+['"].*index\.js['"]/)
    }
    expect(demoFile('pages/custom-event/custom-event.vue')).not.toContain("gdp('setUserAttributes'")
    expect(demoFile('pages/index/index.vue')).toContain('当前能力边界')
  })

  it('compiles the actual autotrack showcase with the compiled dispatcher and preserves privacy gates', () => {
    const source = demoFile('pages/autotrack/autotrack.vue')
    const runtimeImport = '@/uni_modules/gio-uniapp-autotracker/autotrack.js'
    const transformed = transformAutoTrackSfc(source, runtimeImport)

    expect(transformed.changed).toBe(true)
    expect(transformed.code).toContain(`from "${runtimeImport}"`)
    expect(transformed.code).toContain('ignored:true')
    expect(transformed.code).toContain('sensitive:true')
    expect(transformed.code).toContain('trackValue:true')
    expect(transformed.code).toContain("onAction('普通点击')")
    expect(transformed.code).toContain('onInputComplete($event)')
  })

  it('runs the gdp-only lifecycle, consent, identity, custom-event, and autotrack journey', async () => {
    vi.resetModules()
    const originalUni = (globalThis as Record<string, unknown>).uni
    const originalGdp = (globalThis as Record<string, unknown>).gdp
    let hooks: LifecycleHooks | null = null
    let growingio: TrackerRuntime | null = null
    const app = { mixin: (next: Readonly<Record<string, unknown>>) => { hooks = next as LifecycleHooks } }
    const received: ProtocolEvent[] = []
    ;(globalThis as Record<string, unknown>).uni = demoHost(received)

    try {
      const { default: gdp } = await import('../../index.js')
      const { dispatchAutoTrack } = await import('../../autotrack.js')
      expect(gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])).toBe(true)
      expect(gdp('registerPlugins', [{ name: 'demo-test-plugin', install: (instance: TrackerRuntime) => { growingio = instance } }])).toBe(true)
      expect(gdp('init', 'demo-account', 'demo-source', { uniVue: app, dataCollect: false, idMapping: true })).toBe(true)
      expect(globalThis.gdp).toBe(gdp)
      expect(hooks).not.toBeNull()
      expect(growingio).not.toBeNull()
      expect(gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])).toBe(false)
      expect(gdp('init', 'demo-account', 'demo-source', { uniVue: app, dataCollect: false, idMapping: true })).toBe(false)

      const lifecycle = hooks as LifecycleHooks
      lifecycle.onLaunch.call({}, { path: 'pages/index/index', query: { campaign: 'demo' } })
      lifecycle.onShow.call({}, { path: 'pages/index/index', query: { campaign: 'demo' } })
      const page = { $mpType: 'page', $page: { route: 'pages/autotrack/autotrack' }, gioPageTitle: '无埋点 / VIEW_CLICK' }
      lifecycle.onLoad.call(page, { from: 'index', mode: 'scenario' })
      lifecycle.onShow.call(page, {})

      const untypedGdp = gdp as (command: unknown, ...args: readonly unknown[]) => boolean
      expect(gdp('track', 'blocked_before_consent')).toBe(false)
      expect(untypedGdp('setOptions', { dataCollect: 'true' })).toBe(false)
      expect(untypedGdp('setOptions', { dataCollect: true, debug: true })).toBe(false)
      expect(untypedGdp('setUserId', 12345)).toBe(false)
      expect(gdp('setLocation', 91, 120)).toBe(false)
      expect(gdp('track', '', { ignored: true })).toBe(false)
      expect(gdp('setOptions', { dataCollect: true })).toBe(true)
      const tracker = growingio as TrackerRuntime
      await tracker.whenReady()

      expect(gdp('track', 'demo_purchase', { sku: 'demo-sku-001', invalid: { nested: true } })).toBe(true)
      expect(gdp('setUserId', 'demo-user-001', 'email')).toBe(true)
      expect(gdp('setUserAttributes', { membership: 'demo', source: 'scenario' })).toBe(true)
      expect(gdp('track', 'demo_purchase_after_identity', { sku: 'demo-sku-002' })).toBe(true)
      expect(untypedGdp('track', 'demo_attribute_boundary', {
        kept: 'yes', labels: ['demo', true, 1], nested: { mustBeDiscarded: true }, nonFinite: Number.NaN,
      })).toBe(true)
      expect(gdp('setLocation', 30.2741, 120.1551)).toBe(true)
      expect(gdp('clearLocation')).toBe(true)
      expect(untypedGdp('not_a_public_command')).toBe(false)

      expect(dispatchAutoTrack(
        { schemaVersion: 1, kind: 'click', xpath: '/button[1]', index: 1 },
        { currentTarget: { type: 'button', dataset: { title: '普通无埋点按钮', index: '1', src: '/pages/autotrack/autotrack?case=plain' } } },
      )).toBe(true)
      expect(dispatchAutoTrack(
        { schemaVersion: 1, kind: 'click', xpath: '/button[2]', ignored: true },
        { currentTarget: { type: 'button', dataset: { title: '必须忽略的按钮' } } },
      )).toBe(false)
      expect(dispatchAutoTrack(
        { schemaVersion: 1, kind: 'change', xpath: '/input[2]', trackValue: true },
        { currentTarget: { type: 'password', dataset: { title: '密码', growingTrack: true } }, detail: { value: 'must-not-leak' } },
      )).toBe(false)
      lifecycle.onHide.call({})

      const events = received
      expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
        'VISIT', 'PAGE', 'CUSTOM', 'LOGIN_USER_ATTRIBUTES', 'VIEW_CLICK', 'APP_CLOSED',
      ]))
      expect(events.find((event) => event.eventType === 'PAGE')).toMatchObject({
        path: 'pages/autotrack/autotrack', query: 'from=index&mode=scenario', title: '无埋点 / VIEW_CLICK',
      })
      expect(events.find((event) => event.eventName === 'demo_purchase')).toMatchObject({
        attributes: { sku: 'demo-sku-001' },
      })
      expect(events.find((event) => event.eventName === 'demo_purchase_after_identity')).toMatchObject({
        attributes: { sku: 'demo-sku-002' }, userId: 'demo-user-001',
      })
      expect(events.find((event) => event.eventName === 'demo_attribute_boundary')).toMatchObject({
        attributes: { kept: 'yes', labels: 'demo||true||1' },
      })
      const click = events.find((event) => event.eventType === 'VIEW_CLICK')
      expect(click).toMatchObject({ xpath: '/button[1]', textValue: '普通无埋点按钮', index: 1 })
      expect(click).toMatchObject({ deviceId: expect.stringMatching(/^device-/), sessionId: expect.stringMatching(/^session-/) })
      expect(events.some((event) => Object.values(event).includes('must-not-leak'))).toBe(false)
    } finally {
      if (originalUni === undefined) delete (globalThis as Record<string, unknown>).uni
      else (globalThis as Record<string, unknown>).uni = originalUni
      if (originalGdp === undefined) delete (globalThis as Record<string, unknown>).gdp
      else (globalThis as Record<string, unknown>).gdp = originalGdp
    }
  })
})
