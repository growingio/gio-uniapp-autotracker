import type { ResolvedGioConfig } from '../core/config.js'
import type { DeviceIdFactory } from '../core/identity-persistence.js'
import type { SessionIdFactory } from '../core/session.js'
import { OrientationResolver, type PageOrientation } from '../runtime/orientation.js'
import { TrackerRuntime } from '../runtime/tracker.js'
import { installAutoTrackDispatcher } from '../runtime/autotrack-dispatch.js'
import { AppRequestPort, type AppRequestApi } from './app-request.js'
import { AppNetworkPort, type AppNetworkApi } from './app-network.js'
import { AppStoragePort, type AppStorageApi } from './app-storage.js'
import { AppSystemContextPort, type AppSystemApi } from './app-system-context.js'

export type AppRuntimeHost = AppStorageApi & AppRequestApi & AppSystemApi & AppNetworkApi

export type AppRuntimeOptions = Readonly<{
  sdkVersion: string
  deviceIdFactory: DeviceIdFactory
  sessionIdFactory: SessionIdFactory
}>

function orientationReader(host: AppSystemApi): () => PageOrientation {
  const resolver = new OrientationResolver()
  return () => {
    try {
      const value = host.getSystemInfoSync()
      const system = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}
      return resolver.resolve({
        deviceOrientation: system.deviceOrientation,
        windowWidth: system.windowWidth,
        windowHeight: system.windowHeight,
      })
    } catch {
      return resolver.resolve({})
    }
  }
}

/** Creates the App profile from the real `uni` surface without letting `uni` cross into core/runtime. */
export function createAppTracker(host: AppRuntimeHost, options: AppRuntimeOptions): TrackerRuntime {
  const storage = new AppStoragePort(host)
  const network = new AppNetworkPort(host)
  const tracker = new TrackerRuntime({
    storage,
    systemContext: (config: ResolvedGioConfig) => ({
      load: async () => ({
        ...(await new AppSystemContextPort(host, options.sdkVersion, config.appVersionFallback).load()),
        networkState: await network.current(),
      }),
    }),
    clock: { now: () => Date.now() },
    timezone: { getOffsetMinutes: () => new Date().getTimezoneOffset() },
    deviceIdFactory: options.deviceIdFactory,
    sessionIdFactory: options.sessionIdFactory,
    orientation: orientationReader(host),
    logger: {
      info: (message) => globalThis.console?.info(message),
      success: (message) => globalThis.console?.info(message),
      warn: (message) => globalThis.console?.warn(message),
      error: (message) => globalThis.console?.error(message),
      debug: (message, data) => data === undefined ? globalThis.console?.log(message) : globalThis.console?.log(message, data),
    },
    network,
    upload: {
      transport: new AppRequestPort(host),
      runtime: {
        now: () => Date.now(),
        random: () => Math.random(),
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
      },
    },
  })
  installAutoTrackDispatcher(tracker)
  return tracker
}
