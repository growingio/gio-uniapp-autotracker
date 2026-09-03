import { BootstrapBuffer } from './bootstrap-buffer.js'
import { TrackerLifecycle } from './tracker-lifecycle.js'

export type TrackerIntent = Readonly<{ kind: string; payload: Readonly<Record<string, unknown>> }>

/** Enforces public-call ordering without letting initializing events bypass hydration. */
export class TrackerEventGate {
  public constructor(
    private readonly lifecycle: TrackerLifecycle,
    private readonly buffer: BootstrapBuffer = new BootstrapBuffer(),
  ) {}

  public submit(intent: TrackerIntent, emit: (intent: TrackerIntent) => boolean): boolean {
    const config = this.lifecycle.config()
    if (config === null || !config.dataCollect) return false
    if (this.lifecycle.status() === 'initializing') return this.buffer.push(intent)
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
    if (this.lifecycle.status() === 'initializing') return this.buffer.push(intent)
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
    for (const value of this.buffer.drain()) {
      if (!isIntent(value)) continue
      try {
        emit(value)
      } catch {
        // One failed intent must not block later buffered lifecycle/business intents.
      }
    }
    return true
  }

  public bufferedCount(): number {
    return this.buffer.size()
  }
}

function isIntent(value: unknown): value is TrackerIntent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, unknown>>
  return typeof record.kind === 'string' && typeof record.payload === 'object' && record.payload !== null && !Array.isArray(record.payload)
}
