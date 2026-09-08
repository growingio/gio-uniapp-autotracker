import { afterEach, describe, expect, it, vi } from 'vitest'

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
  afterEach(() => vi.unstubAllGlobals())
  it('owns App and Page lifecycle forwarding through one Vue global mixin', () => {
    let hooks!: HookSet
    const app: UniAppVueApp = {
      mixin: (options) => { hooks = options as HookSet },
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
    expect(hooks).toBeDefined()
    const installed = hooks

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
      ['autotrack', { schemaVersion: 2, source: 'tabbar', kind: 'click', xpath: '#onTabItemTap', index: 2, textValue: '订单' }],
      ['page-hide', 'pages/order/detail-1'],
      ['page-unload', 'pages/order/detail-1'],
      ['app-hide', null],
    ])
  })
})


function titleFixture() {
  let hooks!: HookSet
  let interceptor!: { invoke: (options: unknown) => void }
  vi.stubGlobal('uni', { addInterceptor: (name: string, value: typeof interceptor) => { expect(name).toBe('setNavigationBarTitle'); interceptor = value } })
  vi.stubGlobal('__uniRoutes', [{ path: '/pages/home', meta: { navigationBar: { titleText: '配置标题' } } }])
  const target = {
    onAppLaunch: () => true, onAppShow: () => true, onAppHide: () => true,
    onPageLoad: vi.fn(() => true), onPageShow: vi.fn(() => true), onPageHide: () => true, onPageUnload: () => true,
    onPageTitleChanged: vi.fn(() => true), autoTrack: vi.fn(() => true),
  }
  installUniAppLifecycle({ mixin: value => { hooks = value as HookSet } }, target)
  const page = { $mpType: 'page', $page: { route: 'pages/home' } } as Record<string, unknown>
  hooks.onLoad.call(page, {})
  return { hooks, interceptor, target, page }
}

describe('自动导航标题', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('缺少当前页面或标题参数时不包装回调，无效页面路由不创建页面桥', () => {
    const { hooks, interceptor, target, page } = titleFixture()
    for (const options of [null, [], {}, { title: 1 }]) expect(() => interceptor.invoke(options)).not.toThrow()
    hooks.onUnload.call(page)
    const options = { title: '无当前页' }
    interceptor.invoke(options)
    expect(options).not.toHaveProperty('success')
    for (const instance of [{ $mpType: 'page', $page: { route: '/' } }, { $mpType: 'page', __route__: 123 }]) {
      hooks.onLoad.call(instance, {})
      hooks.onTabItemTap.call(instance, {})
    }
    expect(target.onPageShow).not.toHaveBeenCalled()
    expect(target.onPageLoad).toHaveBeenCalledOnce()
    expect(target.autoTrack).not.toHaveBeenCalled()
    expect(target.onPageTitleChanged).not.toHaveBeenCalled()
  })

  it('配置标题、onLoad 中成功更新的动态标题、显式覆盖按优先级生效', () => {
    const { hooks, interceptor, target, page } = titleFixture()
    hooks.onShow.call(page, {})
    expect(target.onPageShow).toHaveBeenLastCalledWith('pages/home-1', '配置标题')
    const values: Record<string, unknown> = { title: '动态标题' }
    interceptor.invoke(values)
    ;(values.success as () => void)()
    expect(target.onPageTitleChanged).toHaveBeenLastCalledWith('pages/home-1', '动态标题')
    hooks.onHide.call(page)
    hooks.onShow.call(page, {})
    expect(target.onPageShow).toHaveBeenLastCalledWith('pages/home-1', '动态标题')
    page.gioPageTitle = '自定义标题'
    hooks.onShow.call(page, {})
    expect(target.onPageShow).toHaveBeenLastCalledWith('pages/home-1', '自定义标题')
  })

  it('业务成功回调的 this、参数、返回值和异常不受采集失败影响', () => {
    const { interceptor, target } = titleFixture()
    target.onPageTitleChanged.mockImplementation(() => { throw new Error('采集异常') })
    const receiver = {}
    const success = vi.fn(function(this: unknown, ...values: unknown[]) { return { receiver: this, values } })
    const options = { title: 'onLoad 标题', success }
    interceptor.invoke(options)
    expect(options.success.call(receiver, 1, 2)).toEqual({ receiver, values: [1, 2] })
    expect(success).toHaveBeenCalledTimes(1)
    const error = new Error('业务异常')
    const throwing = { title: '异常', success: () => { throw error } }
    interceptor.invoke(throwing)
    expect(() => throwing.success()).toThrow(error)
  })

  it('失败调用不更新标题，已卸载页面的迟到回调仍执行业务代码', () => {
    const { hooks, interceptor, target, page } = titleFixture()
    interceptor.invoke({ title: '失败', fail: () => undefined })
    expect(target.onPageTitleChanged).not.toHaveBeenCalled()
    const success = vi.fn()
    const options = { title: '迟到', success }
    interceptor.invoke(options)
    hooks.onUnload.call(page)
    options.success()
    expect(target.onPageTitleChanged).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledOnce()
    expect(() => interceptor.invoke(Object.freeze({ title: '冻结参数' }))).not.toThrow()
  })

  it('标题拦截器安装失败不能阻止基础生命周期安装', () => {
    const { target } = titleFixture()
    vi.stubGlobal('uni', { addInterceptor: () => { throw new Error('不支持') } })
    const mixin = vi.fn()
    expect(() => installUniAppLifecycle({ mixin }, target)).not.toThrow()
    expect(mixin).toHaveBeenCalledOnce()
  })
})
