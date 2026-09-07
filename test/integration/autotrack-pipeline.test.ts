import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSystemContext, StoragePort } from '../../core/ports.js'
import { dispatchAutoTrack, installAutoTrackDispatcher } from '../../runtime/autotrack-dispatch.js'
import { createPageLifecycleBridge } from '../../runtime/page-bridge.js'
import { TrackerRuntime } from '../../runtime/tracker.js'
import { createMockCollector, type MockCollector } from '../support/mock-collector.js'
import { mountAutoTrackSfc, testAutoTrackProfile } from '../support/autotrack-fixture.js'
import type { AutoTrackCall } from '../../autotrack/contract.js'

const system: AppSystemContext = {
  platform: 'Android', platformVersion: '14', domain: 'com.example.app', appState: 'FOREGROUND', appName: 'Example',
  networkState: 'WIFI', screenWidth: 1080, screenHeight: 1920, deviceBrand: 'Google', deviceModel: 'Pixel',
  deviceType: 'PHONE', appVersion: '1.0.0', language: 'zh-CN', sdkVersion: '0.1.0',
}
function storage(): StoragePort {
  const entries = new Map<string, string>()
  return {
    persistentQueue: true,
    read: async (_, key) => entries.has(key) ? { kind: 'value', value: entries.get(key) as string } : { kind: 'missing' },
    write: async (_, key, value) => { entries.set(key, value); return { kind: 'ok' } },
    remove: async (_, key) => { entries.delete(key); return { kind: 'ok' } },
  }
}
function trackerDependencies() {
  return {
    storage: storage(), systemContext: { load: async () => system }, clock: { now: () => 100 },
    timezone: { getOffsetMinutes: () => -480 }, deviceIdFactory: () => 'device-1', sessionIdFactory: () => 'session-1',
    orientation: () => 'PORTRAIT' as const,
  }
}
async function show(tracker: TrackerRuntime) {
  tracker.registerPlugins({ name: 'gioEventAutoTracking' })
  tracker.init({ accountId: 'account', dataSourceId: 'source' })
  tracker.onAppShow({ path: '/home', query: '' })
  tracker.onPageLoad({ instanceId: 'home#1', route: 'pages/home/index', query: '', referralPage: null })
  tracker.onPageShow('home#1', null)
  await tracker.whenReady()
}
const collectors: MockCollector[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(collectors.splice(0).map((collector) => collector.close())) })

describe('SFC to mock collector pipeline', () => {
  it('executes compiled listeners through the production dispatcher, protocol and HTTP transport', async () => {
    const received: Readonly<Record<string, unknown>>[] = []
    const collector = await createMockCollector({ onAcceptedEvents: (events) => received.push(...events) })
    collectors.push(collector)
    const requests: Promise<unknown>[] = []
    const tracker = new TrackerRuntime({
      ...trackerDependencies(), autoTrackProfile: testAutoTrackProfile,
      upload: {
        runtime: { now: () => 100, random: () => 0, setTimeout, clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
        transport: { dispatch: (request, done) => {
          requests.push(fetch(request.url, { method: request.method, headers: request.headers, body: request.body })
            .then((response) => done({ kind: 'success', status: response.status })).catch(() => done({ kind: 'network' })))
        } },
      },
    })
    installAutoTrackDispatcher(tracker)
    tracker.registerPlugins({ name: 'gioEventAutoTracking' })
    tracker.init({ accountId: 'account', dataSourceId: 'source', serverUrl: collector.baseUrl })
    tracker.onAppShow({ path: '/home', query: '' })
    tracker.onPageLoad({ instanceId: 'home#1', route: 'pages/home/index', query: '', referralPage: null })
    tracker.onPageShow('home#1', null)
    await tracker.whenReady()
    const business = vi.fn((e) => e)
    const fixture = mountAutoTrackSfc(`<script setup>
      import { business } from 'fixture'
      const options = [{ label: 'first' }, { label: 'second' }]; const cities = ['杭州', '上海'];
      const items = [{ id:'sku-1', title:'one' }, { id:'sku-2', title:'two' }]; const link = '/docs';
      </script><template><view>
      <template v-for="(item, i) in items" :key="item.id"><button :id="item.id" :data-title="item.title" :data-index="i + 1" @tap="business($event)"/></template>
      <button @click="business"/><input data-growing-track @blur="business"/><input type="password" data-growing-track @blur="business"/>
      <picker :range="options" range-key="label" data-growing-track @change="business"/>
      <picker-view data-growing-track @change="business"><picker-view-column><view v-for="city in cities">{{city}}</view></picker-view-column></picker-view>
      <switch data-growing-track @change="business"/><swiper data-title="banner" @change="business"/>
      <uni-link :href="link"/>
      </view></template>`, (probe, event) => dispatchAutoTrack(probe as AutoTrackCall, event), { fixture: { business } })
    try {
      const first = { type: 'tap', timeStamp: 100, currentTarget: { id: 'sku-1', dataset: { title: 'live one', index: '1' } } }
      expect(fixture.fire(0, 'onTap', first)).toBe(first)
      fixture.fire(0, 'onTap', first)
      fixture.fire(1, 'onTap', { type: 'tap', timeStamp: 101, currentTarget: { id: 'sku-2' } })
      fixture.fire(0, 'onClick', { currentTarget: {}, target: { id: 'child' } })
      fixture.fire(0, 'onBlur', { currentTarget: { id: 'input' }, detail: { value: 0 } })
      fixture.fire(1, 'onBlur', { detail: { value: 'must-not-leak' } })
      fixture.fire(0, 'onChange', { currentTarget: { id: 'picker' }, detail: { value: 1 } })
      fixture.fire(1, 'onChange', { currentTarget: { id: 'cities' }, detail: { value: [0] } })
      fixture.fire(2, 'onChange', { currentTarget: { id: 'switch' }, detail: { value: false } })
      fixture.fire(3, 'onChange', { currentTarget: { id: 'banner' }, detail: { current: 0, source: 'touch' } })
      fixture.fire(3, 'onChange', { currentTarget: { id: 'banner' }, detail: { current: 1, source: 'autoplay' } })
      fixture.fire(1, 'onClick', {})
      createPageLifecycleBridge(tracker, 'home#1').onTabItemTap({ index: 0, text: 'Home', pagePath: 'pages/home/index' })
      await expect.poll(() => received.filter((event) => event.eventType === 'VIEW_CLICK' || event.eventType === 'VIEW_CHANGE').length).toBe(10)
      const views = received.filter((event) => event.eventType === 'VIEW_CLICK' || event.eventType === 'VIEW_CHANGE')
      expect(views).toEqual(expect.arrayContaining([
        expect.objectContaining({ xpath: 'sku-1#business', textValue: 'live one', index: 1 }),
        expect.objectContaining({ xpath: 'sku-2#business', textValue: 'two', index: 2 }),
        expect.objectContaining({ xpath: '#business' }),
        expect.objectContaining({ xpath: 'input#business', textValue: '0' }),
        expect.objectContaining({ xpath: 'picker#business', textValue: 'second' }),
        expect.objectContaining({ xpath: 'cities#business', textValue: '杭州' }),
        expect.objectContaining({ xpath: 'switch#business', textValue: 'false' }),
        expect.objectContaining({ xpath: 'banner#business', textValue: 'banner' }),
        expect.objectContaining({ xpath: '#openURL', hyperlink: '/docs' }),
        expect.objectContaining({ xpath: '#onTabItemTap', index: 1, hyperlink: 'pages/home/index' }),
      ]))
      expect(JSON.stringify(received)).not.toMatch(/must-not-leak|\/view\[|\/input\[|\/tabBar\[/)
      expect(views.every((event) => !('eventName' in event) && !('schemaVersion' in event) && !('source' in event))).toBe(true)
      expect(views.filter((event) => event.eventType === 'VIEW_CHANGE').every((event) => !('index' in event) && !('hyperlink' in event))).toBe(true)
      expect(business).toHaveBeenCalledTimes(11)
      expect(collector.requests.every((request) => request.accepted)).toBe(true)
    } finally {
      fixture.unmount()
      await Promise.all(requests)
    }
  })
  it('enforces readiness, plugin, page, consent and schema gates without leaking private diagnostics', async () => {
    const logs: string[] = []
    const tracker = new TrackerRuntime({ ...trackerDependencies(), autoTrackProfile: testAutoTrackProfile,
      logger: { debug: (message) => logs.push(message), info: () => {}, success: () => {}, warn: () => {}, error: () => {} } })
    const probe = { schemaVersion: 2, source: 'template', kind: 'click', eventName: 'save' } as const
    expect(tracker.autoTrack(probe, {})).toBe(false)
    await show(tracker)
    expect(tracker.autoTrack({ schemaVersion: 1, kind: 'click', xpath: '/old' } as unknown as AutoTrackCall, {})).toBe(false)
    expect(tracker.autoTrack(probe, { currentTarget: { dataset: { growingIgnore: true } } })).toBe(false)
    tracker.setDataCollect(false)
    expect(tracker.autoTrack(probe, {})).toBe(false)
    tracker.setDataCollect(true)
    const native = { type: 'tap', timeStamp: 10 }
    expect(tracker.autoTrack(probe, native)).toBe(true)
    expect(tracker.autoTrack(probe, native)).toBe(false)
    tracker.onPageHide('home#1')
    expect(tracker.autoTrack(probe, {})).toBe(false)
    tracker.onPageShow('home#1', null)
    expect(tracker.autoTrack(probe, native)).toBe(true)
    expect(logs).toEqual([])
    const noPlugin = new TrackerRuntime({ ...trackerDependencies(), autoTrackProfile: testAutoTrackProfile })
    noPlugin.init({ accountId: 'account', dataSourceId: 'source' })
    await noPlugin.whenReady()
    expect(noPlugin.autoTrack(probe)).toBe(false)
  })
  it('allows a demo verification build without changing its production acceptance status', async () => {
    vi.stubGlobal('__GIO_AUTOTRACK_VERIFICATION__', true)
    const tracker = new TrackerRuntime(trackerDependencies())
    await show(tracker)
    expect(tracker.autoTrack({ schemaVersion: 2, source: 'template', kind: 'click', eventName: 'save' })).toBe(true)
    expect(tracker.queuedEvents().at(-1)).toMatchObject({ eventType: 'VIEW_CLICK', xpath: '#save' })
  })

  it.each(['Android', 'iOS', 'HarmonyOS'] as const)('keeps unverified %s capabilities disabled in the real runtime', async (platform) => {
    const tracker = new TrackerRuntime({ ...trackerDependencies(), systemContext: { load: async () => ({ ...system, platform }) } })
    await show(tracker)
    expect(tracker.autoTrack({ schemaVersion: 2, source: 'template', kind: 'click', eventName: 'save' })).toBe(false)
    expect(tracker.autoTrack({ schemaVersion: 2, source: 'template', kind: 'change', eventName: 'save', elementType: 'switch' })).toBe(false)
    expect(createPageLifecycleBridge(tracker, 'home#1').onTabItemTap({ index: 0 })).toBe(false)
    expect(tracker.queuedEvents().map((event) => event.eventType)).toEqual(['VISIT', 'PAGE'])
  })
})
