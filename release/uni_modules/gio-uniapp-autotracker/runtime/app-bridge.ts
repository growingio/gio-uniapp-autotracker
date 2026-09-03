import type { AppEntrySnapshot } from './app-lifecycle.js'

export interface AppLifecycleTarget {
  onAppLaunch(entry: AppEntrySnapshot): boolean
  onAppShow(entry: AppEntrySnapshot): boolean
  onAppHide(): boolean
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null
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
  return Object.entries(query)
    .flatMap(([key, part]) => {
      const normalized = scalar(part)
      return normalized === null ? [] : [`${encodeURIComponent(key)}=${encodeURIComponent(normalized)}`]
    })
    .join('&')
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
