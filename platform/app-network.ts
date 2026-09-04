import type { NetworkPort, NetworkState } from '../core/ports.js'

export interface AppNetworkApi {
  getNetworkType(options: Readonly<{
    success: (result: Readonly<{ networkType?: unknown }>) => void
    fail: () => void
  }>): void
  onNetworkStatusChange?(listener: (result: Readonly<{ networkType?: unknown; isConnected?: unknown }>) => void): void
  offNetworkStatusChange?(listener: (result: Readonly<{ networkType?: unknown; isConnected?: unknown }>) => void): void
}

export function normalizeAppNetworkState(value: unknown, isConnected: unknown = true): NetworkState {
  if (isConnected === false || typeof value !== 'string') return 'UNKNOWN'
  const state = value.trim().toLowerCase()
  if (state === 'wifi') return 'WIFI'
  if (state === '2g') return '2G'
  if (state === '3g') return '3G'
  if (state === '4g') return '4G'
  if (state === '5g') return '5G'
  return 'UNKNOWN'
}

function plusNetworkState(): NetworkState {
  const plus = (globalThis as Readonly<Record<string, unknown>>).plus
  if (typeof plus !== 'object' || plus === null || Array.isArray(plus)) return 'UNKNOWN'
  const networkInfo = (plus as Readonly<Record<string, unknown>>).networkinfo
  if (typeof networkInfo !== 'object' || networkInfo === null || Array.isArray(networkInfo)) return 'UNKNOWN'
  const source = networkInfo as Readonly<Record<string, unknown>>
  if (typeof source.getCurrentType !== 'function') return 'UNKNOWN'
  try {
    const current = (source.getCurrentType as () => unknown)()
    if (current === source.CONNECTION_WIFI) return 'WIFI'
    if (current === source.CONNECTION_2G) return '2G'
    if (current === source.CONNECTION_3G) return '3G'
    if (current === source.CONNECTION_4G) return '4G'
    if (current === source.CONNECTION_5G) return '5G'
    return normalizeAppNetworkState(current)
  } catch {
    return 'UNKNOWN'
  }
}

/** App-only bridge for uni.getNetworkType/onNetworkStatusChange with safe UNKNOWN fallback. */
export class AppNetworkPort implements NetworkPort {
  public constructor(private readonly api: AppNetworkApi) {}

  public current(): Promise<NetworkState> {
    return new Promise((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof globalThis.setTimeout> | null = null
      const finish = (state: NetworkState): void => {
        if (settled) return
        settled = true
        if (timeout !== null) globalThis.clearTimeout(timeout)
        resolve(state)
      }
      timeout = globalThis.setTimeout(() => finish(plusNetworkState()), 1000)
      try {
        this.api.getNetworkType({ success: (result) => finish(normalizeAppNetworkState(result.networkType)), fail: () => finish(plusNetworkState()) })
      } catch {
        finish(plusNetworkState())
      }
    })
  }

  public subscribe(listener: (state: NetworkState) => void): () => void {
    if (typeof this.api.onNetworkStatusChange !== 'function') return () => undefined
    const hostListener = (result: Readonly<{ networkType?: unknown; isConnected?: unknown }>): void => {
      listener(normalizeAppNetworkState(result.networkType, result.isConnected))
    }
    try {
      this.api.onNetworkStatusChange(hostListener)
    } catch {
      return () => undefined
    }
    return () => {
      try {
        this.api.offNetworkStatusChange?.(hostListener)
      } catch {
        // Unsubscription is best effort; this SDK has no destroy lifecycle in phase 1.
      }
    }
  }
}
