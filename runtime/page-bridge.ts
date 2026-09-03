import type { PageLoadInput } from '../core/page-store.js'
import type { AutoTrackCall } from '../autotrack/contract.js'
import { querySnapshot } from './app-bridge.js'

export interface PageLifecycleTarget {
  onPageLoad(input: PageLoadInput): boolean
  onPageShow(instanceId: string, title: string | null): boolean
  onPageHide(instanceId: string): boolean
  onPageUnload(instanceId: string): boolean
  autoTrack?(call: AutoTrackCall): boolean
}

function routeSnapshot(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null
}

function tabClickCall(value: unknown): AutoTrackCall | null {
  const source = record(value)
  const index = source?.index
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return null
  const text = source?.text
  return {
    schemaVersion: 1,
    kind: 'click',
    xpath: `/tabBar[${index + 1}]`,
    index,
    ...(typeof text === 'string' || typeof text === 'number' || typeof text === 'boolean' ? { textValue: text } : {}),
  }
}

/** Binds one host page instance to its own immutable page key; callers never pass Vue/Page objects to tracker. */
export function createPageLifecycleBridge(target: PageLifecycleTarget, instanceId: string): Readonly<{
  onLoad: (route: unknown, query: unknown, referralPage?: unknown) => boolean
  onShow: (title?: unknown) => boolean
  onHide: () => boolean
  onUnload: () => boolean
  onTabItemTap: (options: unknown) => boolean
}> {
  const stableInstanceId = typeof instanceId === 'string' && instanceId.length > 0 ? instanceId : ''
  return {
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
      const call = tabClickCall(options)
      return call === null ? false : target.autoTrack?.(call) ?? false
    },
  }
}
