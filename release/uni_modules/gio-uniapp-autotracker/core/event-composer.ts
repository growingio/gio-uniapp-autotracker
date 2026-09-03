import type { ResolvedGioConfig } from './config.js'
import { EventSequence } from './event-sequence.js'
import type { Identity } from './identity.js'
import { LocationState } from './location-state.js'
import type { AppSystemContext, ClockPort, NetworkState, TimezonePort } from './ports.js'
import { buildAppEvent, type AppEventType, type ProtocolEvent } from './protocol.js'
import { EventQueue } from './queue.js'
import { SessionManager } from './session.js'

export type EventComposeInput = Readonly<{
  eventType: AppEventType
  /** Event-specific protocol fields. Common fields always come from the trusted runtime context. */
  fields?: Readonly<Record<string, unknown>>
  appState?: AppSystemContext['appState']
}>

export type EventComposeResult =
  | Readonly<{ ok: true; event: ProtocolEvent; requestId: string }>
  | Readonly<{
    ok: false
    code: 'missing_session' | 'invalid_timestamp' | 'invalid_event_type' | 'missing_required_field'
      | 'invalid_custom_event_name' | 'event_not_serializable' | 'event_too_large' | 'queue_full'
  }>

function timezoneOffset(timezone: TimezonePort): string {
  try {
    const value = timezone.getOffsetMinutes()
    return Number.isFinite(value) ? String(Math.trunc(value)) : '0'
  } catch {
    return '0'
  }
}

/**
 * Builds one protocol event from stable system context plus the current mutable SDK state.
 * It validates using a placeholder sequence before incrementing the real counter, so rejected
 * business input never creates a gap in `eventSequenceId`.
 */
export class EventComposer {
  public constructor(
    private readonly config: ResolvedGioConfig,
    private readonly system: AppSystemContext,
    private readonly identity: () => Identity,
    private readonly sessions: SessionManager,
    private readonly sequence: EventSequence,
    private readonly queue: EventQueue,
    private readonly clock: ClockPort,
    private readonly timezone: TimezonePort,
    private readonly location: LocationState,
    private readonly network: (() => NetworkState) | undefined = undefined,
  ) {}

  public compose(input: EventComposeInput): EventComposeResult {
    const session = this.sessions.current()
    if (session === null) return { ok: false, code: 'missing_session' }

    let timestamp: number
    try {
      timestamp = this.clock.now()
    } catch {
      return { ok: false, code: 'invalid_timestamp' }
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) return { ok: false, code: 'invalid_timestamp' }

    const identity = this.identity()
    const base = {
      ...this.system,
      ...input.fields,
      deviceId: identity.deviceId,
      userId: identity.userId,
      userKey: identity.userKey,
      sessionId: session.sessionId,
      dataSourceId: this.config.dataSourceId,
      timestamp,
      appState: input.appState ?? this.system.appState,
      appChannel: this.config.appChannel,
      networkState: this.networkState(),
      timezoneOffset: timezoneOffset(this.timezone),
      ...(this.location.current() ?? {}),
    }

    // `buildAppEvent` is pure, so placeholder validation has no observable runtime side effect.
    const preview = buildAppEvent(input.eventType, { ...base, eventSequenceId: 1 })
    if (!preview.ok) return preview

    const eventSequenceId = this.sequence.next(input.eventType)
    const built = eventSequenceId === null
      ? preview
      : buildAppEvent(input.eventType, { ...base, eventSequenceId })
    if (!built.ok) return built

    const enqueued = this.queue.enqueue(built.event)
    if (!enqueued.ok) return enqueued
    return { ok: true, event: built.event, requestId: enqueued.requestId }
  }

  private networkState(): NetworkState {
    try {
      const state = this.network?.()
      return state === '2G' || state === '3G' || state === '4G' || state === '5G' || state === 'WIFI' || state === 'UNKNOWN'
        ? state : this.system.networkState
    } catch {
      return this.system.networkState
    }
  }
}
