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
