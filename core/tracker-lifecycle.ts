import { normalizeInitOptions, type GioInitOptions, type ResolvedGioConfig } from './config.js'
import { BuiltinPluginRegistry, type GioBuiltinPlugin } from './plugin-registry.js'

export type TrackerStatus = 'new' | 'initializing' | 'ready'
export type TrackerInitResult =
  | Readonly<{ ok: true; config: ResolvedGioConfig }>
  | Readonly<{ ok: false; code: 'invalid_config' | 'already_initialized' }>

export type DataCollectTransition = Readonly<{
  ok: boolean
  changed: boolean
  sessionRenewalRequired: boolean
}>

/**
 * Owns only public init/register ordering. Hydration is deliberately completed by runtime once
 * storage and system context are ready, so no event can bypass the bootstrap gate.
 */
export class TrackerLifecycle {
  private statusValue: TrackerStatus = 'new'
  private configValue: ResolvedGioConfig | null = null
  private readonly plugins = new BuiltinPluginRegistry()

  public registerPlugins(...plugins: GioBuiltinPlugin[]): boolean {
    return this.plugins.register(...plugins).ok
  }

  public init(options: GioInitOptions): TrackerInitResult {
    if (this.statusValue !== 'new') return { ok: false, code: 'already_initialized' }
    const normalized = normalizeInitOptions(options)
    if (!normalized.ok) return { ok: false, code: 'invalid_config' }
    this.configValue = normalized.config
    this.statusValue = 'initializing'
    this.plugins.closeRegistration()
    return { ok: true, config: normalized.config }
  }

  public markReady(): boolean {
    if (this.statusValue !== 'initializing') return false
    this.statusValue = 'ready'
    return true
  }

  /** The sole runtime-mutable init option. Lifecycle owns the later VISIT/PAGE replay. */
  public setDataCollect(value: unknown): DataCollectTransition {
    if (this.configValue === null || typeof value !== 'boolean') return { ok: false, changed: false, sessionRenewalRequired: false }
    if (this.configValue.dataCollect === value) return { ok: true, changed: false, sessionRenewalRequired: false }
    const wasEnabled = this.configValue.dataCollect
    this.configValue = { ...this.configValue, dataCollect: value }
    return { ok: true, changed: true, sessionRenewalRequired: !wasEnabled && value }
  }

  public status(): TrackerStatus {
    return this.statusValue
  }

  public config(): ResolvedGioConfig | null {
    return this.configValue
  }

  public registeredPlugins(): readonly GioBuiltinPlugin[] {
    return this.plugins.plugins()
  }
}
