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

/** App-only bridge for uni.getNetworkType/onNetworkStatusChange with safe UNKNOWN fallback. */
export class AppNetworkPort implements NetworkPort {
  public constructor(private readonly api: AppNetworkApi) {}

  public current(): Promise<NetworkState> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (state: NetworkState): void => {
        if (settled) return
        settled = true
        resolve(state)
      }
      try {
        this.api.getNetworkType({ success: (result) => finish(normalizeAppNetworkState(result.networkType)), fail: () => finish('UNKNOWN') })
      } catch {
        finish('UNKNOWN')
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
