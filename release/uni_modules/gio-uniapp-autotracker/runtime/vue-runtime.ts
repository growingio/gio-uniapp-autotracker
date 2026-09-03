import type { TrackerRuntime } from './tracker.js'

export type GioVueApp = Readonly<{
  config?: Readonly<{
    globalProperties?: Record<string, unknown>
  }>
}>

export type GioVueRuntime = Readonly<{
  install(app: GioVueApp): void
}>

/**
 * Deliberately structural: the SDK does not depend on Vue at runtime, but Vue's `app.use()` can
 * install this object and Options API consumers can access the same singleton as `$gio`.
 */
export function createGioVueRuntime(tracker: TrackerRuntime): GioVueRuntime {
  return {
    install(app: GioVueApp): void {
      const properties = app.config?.globalProperties
      if (properties !== undefined) properties.$gio = tracker
    },
  }
}
