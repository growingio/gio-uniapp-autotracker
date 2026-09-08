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

type NetworkSnapshot = Readonly<{ state: NetworkState; connected: boolean | null }>
function snapshot(value?: unknown, isConnected?: unknown): NetworkSnapshot {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const connected = isConnected === false || type === 'none' ? false
    : isConnected === true || ['wifi', '2g', '3g', '4g', '5g', 'cellular', 'ethernet'].includes(type) ? true : null
  return { state: normalizeAppNetworkState(value, connected !== false), connected }
}

function plusNetworkState(): NetworkSnapshot {
  const plus = (globalThis as Readonly<Record<string, unknown>>).plus
  if (typeof plus !== 'object' || plus === null || Array.isArray(plus)) return snapshot()
  const networkInfo = (plus as Readonly<Record<string, unknown>>).networkinfo
  if (typeof networkInfo !== 'object' || networkInfo === null || Array.isArray(networkInfo)) return snapshot()
  const source = networkInfo as Readonly<Record<string, unknown>>
  if (typeof source.getCurrentType !== 'function') return snapshot()
  try {
    const current = (source.getCurrentType as () => unknown)()
    for (const type of ['none', 'wifi', '2g', '3g', '4g', '5g', 'cellular', 'ethernet']) {
      const constant = source[`CONNECTION_${type.toUpperCase()}`]
      if (constant !== undefined && current === constant) return snapshot(type)
    }
    return snapshot(current)
  } catch {
    return snapshot()
  }
}

/** App-only bridge for uni.getNetworkType/onNetworkStatusChange with safe UNKNOWN fallback. */
export class AppNetworkPort implements NetworkPort {
  private state: NetworkState = 'UNKNOWN'
  private connected: boolean | null = null
  private revision = 0
  public constructor(private readonly api: AppNetworkApi) {}

  public isConnected(): boolean | null { return this.connected }

  private update(value: NetworkSnapshot): void {
    this.state = value.state
    // 查询超时/失败不代表已经联网，不能解除此前明确的断网状态。
    if (value.connected !== null) this.connected = value.connected
  }

  public current(): Promise<NetworkState> {
    const revision = ++this.revision
    return new Promise((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof globalThis.setTimeout> | null = null
      const finish = (value: NetworkSnapshot): void => {
        if (settled) return
        settled = true
        if (timeout !== null) globalThis.clearTimeout(timeout)
        // 查询过程中到达的网络通知优先，迟到的查询不能覆盖更新的断网状态。
        if (revision === this.revision) this.update(value)
        resolve(this.state)
      }
      timeout = globalThis.setTimeout(() => finish(plusNetworkState()), 1000)
      try {
        this.api.getNetworkType({ success: (result) => finish(snapshot(result.networkType)), fail: () => finish(plusNetworkState()) })
      } catch {
        finish(plusNetworkState())
      }
    })
  }

  public subscribe(listener: (state: NetworkState) => void): () => void {
    if (typeof this.api.onNetworkStatusChange !== 'function') return () => undefined
    const hostListener = (result: Readonly<{ networkType?: unknown; isConnected?: unknown }>): void => {
      this.revision++
      this.update(snapshot(result.networkType, result.isConnected))
      listener(this.state)
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
