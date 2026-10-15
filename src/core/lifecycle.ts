import { normalizeInitOptions, type GioInitOptions, type ResolvedGioConfig } from '../constants/config.js'
import type { EventSequenceSnapshot } from './dataStore/index.js'
import type { IdentityHydration, QueueHydration, SessionHydration } from './storage/index.js'
import type { AppSystemContext } from '../types/index.js'

export type GioBuiltinPlugin = Readonly<{
  name: 'gioEventAutoTracking'
  options?: Readonly<Record<string, never>>
}>

export type PluginRegistrationCode = 'plugin_invalid' | 'plugin_duplicate' | 'plugin_registration_closed'
export type PluginRegistrationResult = Readonly<{ ok: true } | { ok: false; code: PluginRegistrationCode }>

function isBuiltinPlugin(value: unknown): value is GioBuiltinPlugin {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, unknown>>
  if (record.name !== 'gioEventAutoTracking') return false
  return record.options === undefined
    || (typeof record.options === 'object' && record.options !== null && !Array.isArray(record.options) && Object.keys(record.options).length === 0)
}

/** Registers declarations only. Plugin setup belongs to the tracker after successful init. */
export class BuiltinPluginRegistry {
  private readonly registered = new Map<string, GioBuiltinPlugin>()
  private registrationOpen = true

  public register(...plugins: unknown[]): PluginRegistrationResult {
    if (!this.registrationOpen) return { ok: false, code: 'plugin_registration_closed' }
    const names = new Set<string>()
    for (const plugin of plugins) {
      if (!isBuiltinPlugin(plugin)) return { ok: false, code: 'plugin_invalid' }
      if (names.has(plugin.name) || this.registered.has(plugin.name)) return { ok: false, code: 'plugin_duplicate' }
      names.add(plugin.name)
    }
    for (const plugin of plugins as GioBuiltinPlugin[]) this.registered.set(plugin.name, plugin)
    return { ok: true }
  }

  /** Call only after config validation has succeeded; failed init attempts leave registration open. */
  public closeRegistration(): void {
    this.registrationOpen = false
  }

  public plugins(): readonly GioBuiltinPlugin[] {
    return [...this.registered.values()]
  }
}

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

export const MAX_BOOTSTRAP_BUFFER_ITEMS = 50
export const MAX_BOOTSTRAP_BUFFER_BYTES = 256 * 1024

export type BootstrapBufferLimits = Readonly<{ maxItems: number; maxBytes: number }>

const DEFAULT_LIMITS: BootstrapBufferLimits = {
  maxItems: MAX_BOOTSTRAP_BUFFER_ITEMS,
  maxBytes: MAX_BOOTSTRAP_BUFFER_BYTES,
}

function utf8ByteLength(value: string): number {
  let size = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit <= 0x7f) size += 1
    else if (unit <= 0x7ff) size += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      size += 4
      index += 1
    } else size += 3
  }
  return size
}

/** Captures JSON snapshots while state/system hydration is incomplete; never evicts old intents. */
export class BootstrapBuffer {
  private readonly serialized: string[] = []

  public constructor(private readonly limits: BootstrapBufferLimits = DEFAULT_LIMITS) {}

  public push(intent: unknown): boolean {
    let value: string | undefined
    try {
      value = JSON.stringify(intent)
    } catch {
      return false
    }
    if (value === undefined || this.serialized.length >= this.limits.maxItems) return false
    const candidate = `[${this.serialized.concat(value).join(',')}]`
    if (utf8ByteLength(candidate) > this.limits.maxBytes) return false
    this.serialized.push(value)
    return true
  }

  public drain(): readonly unknown[] {
    const values = JSON.parse(`[${this.serialized.join(',')}]`) as unknown[]
    this.serialized.splice(0, this.serialized.length)
    return values
  }

  public size(): number {
    return this.serialized.length
  }
}

export type TrackerIntent = Readonly<{ kind: string; payload: Readonly<Record<string, unknown>>; collecting?: boolean; observedAt?: number }>
type BufferedIntent = Readonly<{ order: number; intent: TrackerIntent }>
const lifecycleKinds = new Set(['app-launch', 'app-show', 'app-hide', 'page-load', 'page-show', 'page-hide', 'page-unload', 'page-title', 'collection-resume'])

/** Enforces public-call ordering without letting initializing events bypass hydration. */
export class TrackerEventGate {
  private nextOrder = 0
  // 生命周期独立保留相同的条数/字节上限，业务突发不能阻止首屏建立会话。
  private readonly lifecycleBuffer = new BootstrapBuffer()
  public constructor(
    private readonly lifecycle: TrackerLifecycle,
    private readonly buffer: BootstrapBuffer = new BootstrapBuffer(),
  ) {}

  public submit(intent: TrackerIntent, emit: (intent: TrackerIntent) => boolean): boolean {
    const config = this.lifecycle.config()
    if (config === null || !config.dataCollect) return false
    intent = { ...intent, collecting: config.dataCollect }
    if (this.lifecycle.status() === 'initializing') return this.buffer.push({ order: this.nextOrder++, intent })
    if (this.lifecycle.status() !== 'ready') return false
    try {
      return emit(intent)
    } catch {
      return false
    }
  }

  /** Lifecycle state still needs replay while consent is off; its own router suppresses behavior events. */
  public submitLifecycle(intent: TrackerIntent, emit: (intent: TrackerIntent) => boolean): boolean {
    if (this.lifecycle.config() === null) return false
    intent = { ...intent, collecting: this.lifecycle.config()?.dataCollect }
    if (this.lifecycle.status() === 'initializing') {
      const buffer = lifecycleKinds.has(intent.kind) ? this.lifecycleBuffer : this.buffer
      return buffer.push({ order: this.nextOrder++, intent })
    }
    if (this.lifecycle.status() !== 'ready') return false
    try {
      return emit(intent)
    } catch {
      return false
    }
  }

  /** Flushes the bounded JSON snapshots in order after every hydration dependency is ready. */
  public release(emit: (intent: TrackerIntent) => boolean): boolean {
    if (!this.lifecycle.markReady()) return false
    const buffered = [...this.buffer.drain(), ...this.lifecycleBuffer.drain()].filter(isBufferedIntent)
    for (const value of buffered.sort((a, b) => a.order - b.order)) {
      try {
        emit(value.intent)
      } catch {
        // One failed intent must not block later buffered lifecycle/business intents.
      }
    }
    return true
  }

  public bufferedCount(): number {
    return this.buffer.size() + this.lifecycleBuffer.size()
  }
}

function isBufferedIntent(value: unknown): value is BufferedIntent {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Readonly<Record<string, unknown>>
  return Number.isSafeInteger(record.order) && isIntent(record.intent)
}

function isIntent(value: unknown): value is TrackerIntent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, unknown>>
  return typeof record.kind === 'string' && typeof record.payload === 'object' && record.payload !== null && !Array.isArray(record.payload)
}

export type HydratedTrackerState = Readonly<{
  identity: IdentityHydration
  session: SessionHydration
  meta: Readonly<{ snapshot: EventSequenceSnapshot; source: string }>
  queue: QueueHydration
  systemContext: AppSystemContext
}>

export type HydrationDependencies = Readonly<{
  hydrateIdentity: () => Promise<IdentityHydration>
  hydrateSession: () => Promise<SessionHydration>
  hydrateMeta: () => Promise<Readonly<{ snapshot: EventSequenceSnapshot; source: string }>>
  hydrateQueue: () => Promise<QueueHydration>
  loadSystemContext: () => Promise<AppSystemContext>
}>

export type HydrationResult =
  | Readonly<{ ok: true; state: HydratedTrackerState }>
  | Readonly<{ ok: false; code: 'system_context_unavailable' }>

/** One readiness gate: buffered events are released only after every state record and context resolve. */
export async function hydrateTrackerState(dependencies: HydrationDependencies): Promise<HydrationResult> {
  try {
    const [identity, session, meta, queue, systemContext] = await Promise.all([
      dependencies.hydrateIdentity(),
      dependencies.hydrateSession(),
      dependencies.hydrateMeta(),
      dependencies.hydrateQueue(),
      dependencies.loadSystemContext(),
    ])
    return { ok: true, state: { identity, session, meta, queue, systemContext } }
  } catch {
    return { ok: false, code: 'system_context_unavailable' }
  }
}
