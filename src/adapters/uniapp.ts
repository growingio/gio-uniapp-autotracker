import type { AppEntrySnapshot } from '../core/dataStore/app.js'
import type { PageLoadInput } from '../core/dataStore/page.js'
import type { AutoTrackCall } from '../plugins/gioEventAutoTracking/contract.js'

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

export interface AppLifecycleTarget {
  onAppLaunch(entry: AppEntrySnapshot): boolean
  onAppShow(entry: AppEntrySnapshot): boolean
  onAppHide(): boolean
}



function scalar(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** Query serialization is shared by App and Page bridges to avoid retaining host query objects. */
export function querySnapshot(value: unknown): string | null {
  if (typeof value === 'string') return value
  const query = record(value)
  if (query === null) return null
  try {
    return Object.keys(query).flatMap((key) => {
      try {
        const normalized = scalar(query[key])
        return normalized === null ? [] : [`${encodeURIComponent(key)}=${encodeURIComponent(normalized)}`]
      } catch {
        // One malformed host field must not erase the remaining route context.
        return []
      }
    }).join('&')
  } catch { return null }
}

/** Converts documented App lifecycle options into a JSON-only entry; unsupported query values are omitted. */
export function appEntrySnapshot(options: unknown): AppEntrySnapshot {
  const source = record(options)
  const path = typeof source?.path === 'string' && source.path.length > 0 ? source.path : null
  return { path, query: querySnapshot(source?.query) }
}

/** App.vue may delegate its three hooks here without importing host or Vue objects into core runtime. */
export function createAppLifecycleBridge(target: AppLifecycleTarget): Readonly<{
  onLaunch: (options: unknown) => boolean
  onShow: (options: unknown) => boolean
  onHide: () => boolean
}> {
  return {
    onLaunch: (options) => target.onAppLaunch(appEntrySnapshot(options)),
    onShow: (options) => target.onAppShow(appEntrySnapshot(options)),
    onHide: () => target.onAppHide(),
  }
}

export interface PageLifecycleTarget {
  onPageLoad(input: PageLoadInput): boolean
  onPageShow(instanceId: string, title: string | null): boolean
  onPageHide(instanceId: string): boolean
  onPageUnload(instanceId: string): boolean
  onPageTitleChanged?(instanceId: string, title: string): boolean
  autoTrack?(call: AutoTrackCall): boolean
}

function routeSnapshot(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}



function tabClickCall(value: unknown): AutoTrackCall | null {
  const source = record(value)
  const index = source?.index
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= 2147483646) return null
  const text = source?.text
  const pagePath = source?.pagePath
  if ((text != null && typeof text !== 'string') || (pagePath != null && typeof pagePath !== 'string')) return null
  return {
    schemaVersion: 2,
    source: 'tabbar',
    kind: 'click',
    xpath: '#onTabItemTap',
    index: index + 1,
    ...(typeof text === 'string' ? { textValue: text } : {}),
    ...(typeof pagePath === 'string' ? { hyperlink: pagePath } : {}),
  }
}

/** Binds one host page instance to its own immutable page key; callers never pass Vue/Page objects to tracker. */
export function createPageLifecycleBridge(target: PageLifecycleTarget, instanceId: string): Readonly<{
  onLoad: (route: unknown, query: unknown, referralPage?: unknown) => boolean
  onShow: (title?: unknown) => boolean
  onHide: () => boolean
  onUnload: () => boolean
  onTabItemTap: (options: unknown) => boolean
  onTitleChanged: (title: string) => void
}> {
  const stableInstanceId = typeof instanceId === 'string' && instanceId.length > 0 ? instanceId : ''
  return {
    onTitleChanged: (title) => { target.onPageTitleChanged?.(stableInstanceId, title) },
    onLoad: (route, query, referralPage = null) => {
      const normalizedRoute = routeSnapshot(route)
      if (stableInstanceId === '' || normalizedRoute === null) return false
      return target.onPageLoad({
        instanceId: stableInstanceId,
        route: normalizedRoute,
        query: querySnapshot(query) ?? '',
        referralPage: typeof referralPage === 'string' && referralPage.length > 0 ? referralPage : null,
      })
    },
    onShow: (title = null) => target.onPageShow(stableInstanceId, typeof title === 'string' && title.length > 0 ? title : null),
    onHide: () => target.onPageHide(stableInstanceId),
    onUnload: () => target.onPageUnload(stableInstanceId),
    onTabItemTap: (options) => {
      try {
        const call = tabClickCall(options)
        return call === null ? false : target.autoTrack?.(call) ?? false
      } catch { return false }
    },
  }
}
