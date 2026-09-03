import { createAppLifecycleBridge, type AppLifecycleTarget } from './app-bridge.js'
import { createPageLifecycleBridge, type PageLifecycleTarget } from './page-bridge.js'

type LifecycleTarget = AppLifecycleTarget & PageLifecycleTarget
type PageBridge = ReturnType<typeof createPageLifecycleBridge>
type VueInstance = Record<string, unknown>

export type UniAppVueApp = Readonly<{
  mixin: (options: Readonly<Record<string, unknown>>) => void
}>

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
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

/**
 * Installs one global Vue mixin. It keeps host Vue/Page objects in a WeakMap and sends the core
 * only the route, query and title snapshots created by the existing bridges.
 */
export function installUniAppLifecycle(app: UniAppVueApp, target: LifecycleTarget): void {
  const appBridge = createAppLifecycleBridge(target)
  const pages = new WeakMap<object, PageBridge>()
  let nextPageId = 1

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
    onLaunch(this: VueInstance, options: unknown) {
      if (!isPage(this)) appBridge.onLaunch(options)
    },
    onShow(this: VueInstance, options: unknown) {
      const bridge = pageBridge(this)
      if (bridge !== null) bridge.onShow(typeof this.gioPageTitle === 'string' ? this.gioPageTitle : null)
      else appBridge.onShow(options)
    },
    onHide(this: VueInstance) {
      const bridge = pageBridge(this)
      if (bridge !== null) bridge.onHide()
      else appBridge.onHide()
    },
    onLoad(this: VueInstance, query: unknown) {
      const bridge = pageBridge(this)
      const route = routeOf(this)
      if (bridge !== null && route !== null) bridge.onLoad(route, query)
    },
    onUnload(this: VueInstance) {
      pageBridge(this)?.onUnload()
    },
    onTabItemTap(this: VueInstance, options: unknown) {
      pageBridge(this)?.onTabItemTap(options)
    },
  })
}
