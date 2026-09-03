import { describe, expect, it } from 'vitest'

import { installUniAppLifecycle, type UniAppVueApp } from '../../runtime/uniapp-installer.js'

type HookSet = Readonly<{
  onLaunch: (this: Record<string, unknown>, options: unknown) => void
  onShow: (this: Record<string, unknown>, options: unknown) => void
  onHide: (this: Record<string, unknown>) => void
  onLoad: (this: Record<string, unknown>, query: unknown) => void
  onUnload: (this: Record<string, unknown>) => void
  onTabItemTap: (this: Record<string, unknown>, options: unknown) => void
}>

describe('installUniAppLifecycle', () => {
  it('owns App and Page lifecycle forwarding through one Vue global mixin', () => {
    let hooks: HookSet | null = null
    const app: UniAppVueApp = {
      mixin: (options) => { hooks = options as HookSet },
      config: { globalProperties: {} },
    }
    const calls: Array<readonly [string, unknown]> = []
    const target = {
      onAppLaunch: (entry: unknown) => { calls.push(['app-launch', entry]); return true },
      onAppShow: (entry: unknown) => { calls.push(['app-show', entry]); return true },
      onAppHide: () => { calls.push(['app-hide', null]); return true },
      onPageLoad: (entry: unknown) => { calls.push(['page-load', entry]); return true },
      onPageShow: (id: string, title: string | null) => { calls.push(['page-show', { id, title }]); return true },
      onPageHide: (id: string) => { calls.push(['page-hide', id]); return true },
      onPageUnload: (id: string) => { calls.push(['page-unload', id]); return true },
      autoTrack: (entry: unknown) => { calls.push(['autotrack', entry]); return true },
    }

    installUniAppLifecycle(app, target)
    expect(hooks).not.toBeNull()
    const installed = hooks as HookSet

    installed.onLaunch.call({}, { path: 'pages/index/index', query: { source: 'launch' } })
    installed.onShow.call({}, { path: 'pages/index/index' })
    const page = { $mpType: 'page', $page: { route: '/pages/order/detail' }, gioPageTitle: '订单详情' }
    installed.onLoad.call(page, { orderId: 42 })
    installed.onShow.call(page, {})
    installed.onTabItemTap.call(page, { index: 1, text: '订单' })
    installed.onHide.call(page)
    installed.onUnload.call(page)
    installed.onHide.call({})

    expect(calls).toStrictEqual([
      ['app-launch', { path: 'pages/index/index', query: 'source=launch' }],
      ['app-show', { path: 'pages/index/index', query: null }],
      ['page-load', { instanceId: 'pages/order/detail-1', route: 'pages/order/detail', query: 'orderId=42', referralPage: null }],
      ['page-show', { id: 'pages/order/detail-1', title: '订单详情' }],
      ['autotrack', { schemaVersion: 1, kind: 'click', xpath: '/tabBar[2]', index: 1, textValue: '订单' }],
      ['page-hide', 'pages/order/detail-1'],
      ['page-unload', 'pages/order/detail-1'],
      ['app-hide', null],
    ])
  })
})
