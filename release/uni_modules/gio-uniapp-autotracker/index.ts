import { createAppTracker, type AppRuntimeHost, type AppRuntimeOptions } from './platform/app-runtime.js'
import type { GioInitOptions } from './core/config.js'
import type { GioBuiltinPlugin } from './core/plugin-registry.js'
import { TrackerRuntime } from './runtime/tracker.js'
import { installUniAppLifecycle, type UniAppVueApp } from './runtime/uniapp-installer.js'
import { guid } from './core/guid.js'

let singleton: TrackerRuntime | null = null
let gdpTracker: TrackerRuntime | null = null
let pendingGdpPlugins: readonly GdpPlugin[] = []

type GdpPlugin = GioBuiltinPlugin | GioPlugin

/**
 * The App profile is intentionally singleton-only: repeated calls return the first runtime and
 * never create duplicate lifecycle listeners, queues, storage namespaces, or uploaders.
 */
function createGioTracker(host: AppRuntimeHost, options: AppRuntimeOptions): TrackerRuntime {
  if (singleton === null) singleton = createAppTracker(host, options)
  return singleton
}

/** Minimal Vue App shape required by the SDK lifecycle installer. `createSSRApp(App)` satisfies it. */
export type GioUniVueApp = UniAppVueApp

export type GioGdpInitOptions = Omit<GioInitOptions, 'accountId' | 'dataSourceId'> & Readonly<{
  /** The Vue app returned by createSSRApp(App); it enables SDK-owned App/Page lifecycle hooks. */
  uniVue: GioUniVueApp
  sdkVersion?: string
}>

/** Values that are normalized into a GrowingIO event or user-attribute string. */
export type GioAttributeScalar = string | number | boolean | Date | null | undefined
export type GioAttributeValue = GioAttributeScalar | readonly GioAttributeScalar[]
export type GioAttributes = Readonly<Record<string, GioAttributeValue>>

/** `dataCollect` is the sole initialization option that can change at runtime. */
export type GioMutableOptions = Readonly<{ dataCollect: boolean }>

/** The internal instance is available only as the argument of an explicitly registered customer plugin. */
export type GioPluginRuntime = TrackerRuntime

export type GioPlugin = Readonly<{
  name: string
  install: (growingio: GioPluginRuntime) => void
}>

export type GioPluginRegistration = GioBuiltinPlugin | GioPlugin

/**
 * The complete customer-facing command surface. This intentionally has no catch-all overload:
 * an unknown command or a mismatched argument list is a TypeScript error before it can reach the
 * runtime's defensive `false` fallback.
 */
export interface GdpCommand {
  (command: 'registerPlugins', plugins: readonly GioPluginRegistration[]): boolean
  (command: 'init', accountId: string, dataSourceId: string, options: GioGdpInitOptions): boolean
  (command: 'track', eventName: string, attributes?: GioAttributes): boolean
  (command: 'setUserId', userId: string, userKey?: string | null): boolean
  (command: 'clearUserId'): boolean
  (command: 'setUserAttributes', attributes: GioAttributes): boolean
  (command: 'setOptions', options: GioMutableOptions): boolean
  (command: 'setLocation', latitude: number, longitude: number): boolean
  (command: 'clearLocation'): boolean
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function appHost(): AppRuntimeHost | null {
  const candidate = record((globalThis as Readonly<Record<string, unknown>>).uni)
  const required = ['getStorageSync', 'setStorageSync', 'removeStorageSync', 'getDeviceInfo', 'getSystemInfoSync', 'getAppBaseInfo', 'getNetworkType', 'request']
  return candidate !== null && required.every((name) => typeof candidate[name] === 'function')
    ? candidate as unknown as AppRuntimeHost
    : null
}

function isUniVueApp(value: unknown): value is UniAppVueApp {
  const candidate = record(value)
  return candidate !== null && typeof candidate.mixin === 'function'
}

function isBuiltinPlugin(value: unknown): value is GioBuiltinPlugin {
  const candidate = record(value)
  const options = record(candidate?.options)
  return candidate?.name === 'gioEventAutoTracking'
    && (candidate.options === undefined || (options !== null && Object.keys(options).length === 0))
}

function isCustomerPlugin(value: unknown): value is GioPlugin {
  const candidate = record(value)
  return candidate !== null && typeof candidate.name === 'string' && candidate.name.trim() !== '' && typeof candidate.install === 'function'
}

function pluginName(plugin: GdpPlugin): string {
  return plugin.name
}

function registerGdpPlugins(value: unknown): boolean {
  if (!Array.isArray(value) || gdpTracker !== null) return false
  const plugins = value.filter((plugin): plugin is GdpPlugin => isBuiltinPlugin(plugin) || isCustomerPlugin(plugin))
  if (plugins.length !== value.length) return false
  const names = new Set(pendingGdpPlugins.map(pluginName))
  for (const plugin of plugins) {
    const name = pluginName(plugin)
    if (names.has(name)) return false
    names.add(name)
  }
  pendingGdpPlugins = [...pendingGdpPlugins, ...plugins]
  return true
}

/**
 * Command entry aligned with the standalone mini-program SDK. Integration requires only main.ts:
 * register plugins, then pass the Vue app as `uniVue` to init. The SDK reads the real global `uni`
 * host and owns App/Page lifecycle forwarding itself. Application code has no tracker object;
 * all normal calls remain gdp commands.
 */
export const gdp: GdpCommand = (command: unknown, ...args: readonly unknown[]): boolean => {
  if (command === 'registerPlugins') return registerGdpPlugins(args[0])
  if (command === 'init') {
    if (gdpTracker !== null || typeof args[0] !== 'string' || typeof args[1] !== 'string') return false
    const input = record(args[2])
    const host = appHost()
    if (input === null || host === null || !isUniVueApp(input.uniVue)) return false
    const { uniVue, sdkVersion, ...init } = input
    const tracker = createGioTracker(host, {
      sdkVersion: typeof sdkVersion === 'string' && sdkVersion.trim() !== '' ? sdkVersion : '0.1.0',
      deviceIdFactory: guid,
      sessionIdFactory: guid,
    })
    const builtinPlugins = pendingGdpPlugins.filter(isBuiltinPlugin)
    if (!tracker.registerPlugins(...builtinPlugins) || !tracker.init({ ...init, accountId: args[0], dataSourceId: args[1] })) return false
    installUniAppLifecycle(uniVue, tracker)
    gdpTracker = tracker
    for (const plugin of pendingGdpPlugins.filter(isCustomerPlugin)) {
      try {
        plugin.install(tracker)
      } catch {
        globalThis.console?.warn(`[GrowingIO]: custom plugin install failed (${plugin.name})`)
      }
    }
    return true
  }
  if (gdpTracker === null) return false
  switch (command) {
    case 'track': return gdpTracker.track(args[0], args[1])
    case 'setUserId': return gdpTracker.setUserId(args[0], args[1])
    case 'clearUserId': return gdpTracker.clearUserId()
    case 'setUserAttributes': return gdpTracker.setUserAttributes(args[0])
    case 'setOptions': return gdpTracker.setOptions(args[0])
    case 'setLocation': return gdpTracker.setLocation(args[0], args[1])
    case 'clearLocation': return gdpTracker.clearLocation()
    default: return false
  }
}

declare global {
  /** SDK-owned command entry available to uni-app pages after the root SDK is imported in main.ts. */
  const gdp: GdpCommand
}

;(globalThis as Record<string, unknown>).gdp = gdp

export default gdp

export type { GioBuiltinPlugin } from './core/plugin-registry.js'
