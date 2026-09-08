import { BootstrapBuffer } from './bootstrap-buffer.js'
import { TrackerLifecycle } from './tracker-lifecycle.js'

export type TrackerIntent = Readonly<{ kind: string; payload: Readonly<Record<string, unknown>>; collecting?: boolean }>
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
