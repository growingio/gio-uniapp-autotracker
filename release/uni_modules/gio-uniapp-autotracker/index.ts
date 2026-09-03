import { createAppTracker, type AppRuntimeHost, type AppRuntimeOptions } from './platform/app-runtime.js'
import { TrackerRuntime } from './runtime/tracker.js'

let singleton: TrackerRuntime | null = null

/**
 * The App profile is intentionally singleton-only: repeated calls return the first runtime and
 * never create duplicate lifecycle listeners, queues, storage namespaces, or uploaders.
 */
export function createGioTracker(host: AppRuntimeHost, options: AppRuntimeOptions): TrackerRuntime {
  if (singleton === null) singleton = createAppTracker(host, options)
  return singleton
}

export { allAppCapabilityProfiles, appCapabilityProfile } from './platform/capabilities.js'
export { appEntrySnapshot, createAppLifecycleBridge, querySnapshot } from './runtime/app-bridge.js'
export { createPageLifecycleBridge } from './runtime/page-bridge.js'
export { dispatchAutoTrack, installAutoTrackDispatcher } from './runtime/autotrack-dispatch.js'
export { createGioVueRuntime } from './runtime/vue-runtime.js'
export type { AppEntrySnapshot } from './runtime/app-lifecycle.js'
export type { PageLoadInput, PageSnapshot } from './core/page-store.js'
export type { AppRuntimeHost, AppRuntimeOptions }
export type { AppCapabilityProfile } from './platform/capabilities.js'
export type { GioInitOptions } from './core/config.js'
export type { GioVueApp, GioVueRuntime } from './runtime/vue-runtime.js'
