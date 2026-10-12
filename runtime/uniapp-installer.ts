import { createAppLifecycleBridge, type AppLifecycleTarget } from './app-bridge.js'
import { createPageLifecycleBridge, type PageLifecycleTarget } from './page-bridge.js'

type LifecycleTarget = AppLifecycleTarget & PageLifecycleTarget
type PageBridge = ReturnType<typeof createPageLifecycleBridge>
type VueInstance = Record<string, unknown>

export type UniAppVueApp = Readonly<{
  mixin: (options: Readonly<Record<string, unknown>>) => void
}>

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function routeOf(instance: VueInstance): string | null {
  const page = record(instance.$page)
  const route = page?.route ?? instance.__route__
  if (typeof route !== 'string') return null
  const normalized = route.replace(/^\/+/, '')
  return normalized === '' ? null : normalized
}

function isPage(instance: VueInstance): boolean {
  return instance.$mpType === 'page' && routeOf(instance) !== null
}

function isolatedLifecycleHook<Args extends unknown[]>(hook: (this: VueInstance, ...args: Args) => void) {
  return function(this: VueInstance, ...args: Args): void {
    try { hook.apply(this, args) } catch { /* SDK forwarding must never interrupt business lifecycle hooks. */ }
  }
}

function pageTitle(instance: VueInstance): string | null {
  try {
    if (typeof instance.gioPageTitle === 'string') return instance.gioPageTitle
    const page = record(instance.$page)
    const routes = (globalThis as Record<string, unknown>).__uniRoutes
    const route = Array.isArray(routes) ? routes.find((item) => {
      const path = record(item)?.path
      return typeof path === 'string' && path.replace(/^\/+/, '') === routeOf(instance)
    }) : null
    const meta = record(page?.meta) ?? record(record(route)?.meta)
    const title = record(meta?.navigationBar)?.titleText ?? meta?.navigationBarTitleText ?? page?.navigationBarTitleText
    return typeof title === 'string' ? title : null
  } catch { return null }
}

/**
 * Installs one global Vue mixin. It keeps host Vue/Page objects in a WeakMap and sends the core
 * only the route, query and title snapshots created by the existing bridges.
 */
export function installUniAppLifecycle(app: UniAppVueApp, target: LifecycleTarget): void {
  const appBridge = createAppLifecycleBridge(target)
  const pages = new WeakMap<object, PageBridge>()
  let nextPageId = 1
  let currentPage: VueInstance | null = null
  const titles = new WeakMap<object, string>()

  const pageBridge = (instance: VueInstance): PageBridge | null => {
    if (!isPage(instance)) return null
    const existing = pages.get(instance)
    if (existing !== undefined) return existing
    const route = routeOf(instance)
    if (route === null) return null
    const bridge = createPageLifecycleBridge(target, `${route}-${nextPageId++}`)
    pages.set(instance, bridge)
    return bridge
  }

  app.mixin({
    onLaunch: isolatedLifecycleHook(function(this: VueInstance, options: unknown) {
      if (!isPage(this)) appBridge.onLaunch(options)
    }),
    onShow: isolatedLifecycleHook(function(this: VueInstance, options: unknown) {
      const bridge = pageBridge(this)
      if (bridge !== null) {
        currentPage = this
        bridge.onShow(typeof this.gioPageTitle === 'string' ? this.gioPageTitle : titles.get(this) ?? pageTitle(this))
      }
      else appBridge.onShow(options)
    }),
    onHide: isolatedLifecycleHook(function(this: VueInstance) {
      try {
        const bridge = pageBridge(this)
        if (bridge !== null) bridge.onHide()
        else appBridge.onHide()
      } finally { if (currentPage === this) currentPage = null }
    }),
    onLoad: isolatedLifecycleHook(function(this: VueInstance, query: unknown) {
      const bridge = pageBridge(this)
      const route = routeOf(this)
      if (bridge !== null && route !== null) { currentPage = this; bridge.onLoad(route, query) }
    }),
    onUnload: isolatedLifecycleHook(function(this: VueInstance) {
      try { pageBridge(this)?.onUnload() }
      finally {
        pages.delete(this)
        titles.delete(this)
        if (currentPage === this) currentPage = null
      }
    }),
    onTabItemTap: isolatedLifecycleHook(function(this: VueInstance, options: unknown) {
      pageBridge(this)?.onTabItemTap(options)
    }),
  })

  try {
    const host = record((globalThis as Record<string, unknown>).uni)
    if (typeof host?.addInterceptor === 'function') {
      host.addInterceptor('setNavigationBarTitle', {
        invoke(options: unknown) {
          try {
            const args = record(options)
            const page = currentPage
            if (args === null || page === null || typeof args.title !== 'string') return
            const title = args.title
            const success = args.success
            args.success = function(this: unknown, ...values: unknown[]) {
              try {
                if (pages.has(page)) {
                  titles.set(page, title)
                  pages.get(page)?.onTitleChanged(typeof page.gioPageTitle === 'string' ? page.gioPageTitle : title)
                }
              } catch { /* 采集状态更新不得影响业务回调。 */ }
              if (typeof success === 'function') return success.apply(this, values)
            }
          } catch { /* 不可写的宿主参数保持原样。 */ }
        },
      })
    }
  } catch { /* 标题增强不可用时，基础生命周期仍正常安装。 */ }
}
