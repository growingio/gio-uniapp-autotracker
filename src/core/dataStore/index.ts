import { type AppEventType, buildAppEvent, type ProtocolEvent, normalizeAttributes } from './protocol.js'
import type { ResolvedGioConfig } from '../../constants/config.js'
import { type Identity, LocationState, SessionManager } from '../userStore.js'
import type { AppSystemContext, ClockPort, NetworkState, TimezonePort } from '../../types/index.js'
import { EventQueue } from '../queue.js'
import type { PageSnapshot } from './page.js'
import type { NormalizedAutoTrackCall } from '../../plugins/gioEventAutoTracking/contract.js'

const SEQUENCED_EVENT_TYPES = new Set<AppEventType>([
  'VISIT',
  'PAGE',
  'CUSTOM',
  'VIEW_CLICK',
  'VIEW_CHANGE',
])

export type EventSequenceSnapshot = Readonly<{ eventSequenceId: number }>

/**
 * A single monotonically increasing counter shared by every sequenced event.
 * The storage module persists this counter independently of identity and session.
 */
export class EventSequence {
  private currentValue: number

  public constructor(initialValue: number | null | undefined = 0) {
    this.currentValue = typeof initialValue === 'number' && Number.isSafeInteger(initialValue) && initialValue >= 0 ? initialValue : 0
  }

  public current(): EventSequenceSnapshot {
    return { eventSequenceId: this.currentValue }
  }

  public next(eventType: AppEventType): number | null {
    const next = this.peek(eventType)
    if (next !== null) this.currentValue = next
    return next
  }

  /** Allows the composer to validate and enqueue before committing the sequence. */
  public peek(eventType: AppEventType): number | null {
    if (!SEQUENCED_EVENT_TYPES.has(eventType)) return null
    if (this.currentValue >= Number.MAX_SAFE_INTEGER) throw new Error('event_sequence_overflow')
    return this.currentValue + 1
  }
}

export type EventComposeInput = Readonly<{
  eventType: AppEventType
  /** Event-specific protocol fields. Common fields always come from the trusted runtime context. */
  fields?: Readonly<Record<string, unknown>>
  /** Captured by a trusted lifecycle router so its event and context share one timestamp. */
  timestamp?: number
  appState?: AppSystemContext['appState']
}>

export type EventComposeResult =
  | Readonly<{ ok: true; event: ProtocolEvent; requestId: string }>
  | Readonly<{
    ok: false
    code: 'missing_session' | 'invalid_timestamp' | 'invalid_event_type' | 'missing_required_field'
      | 'invalid_custom_event_name' | 'invalid_field_value' | 'event_not_serializable' | 'event_too_large' | 'queue_full'
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
  private appState: AppSystemContext['appState'] = 'FOREGROUND'
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

  public setAppState(value: AppSystemContext['appState']): void { this.appState = value }

  public compose(input: EventComposeInput): EventComposeResult {
    const session = this.sessions.current()
    if (session === null) return { ok: false, code: 'missing_session' }

    let timestamp: number
    try {
      timestamp = input.timestamp ?? this.clock.now()
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
      appState: input.appState ?? this.appState,
      appChannel: this.config.appChannel,
      networkState: this.networkState(),
      timezoneOffset: timezoneOffset(this.timezone),
      ...(this.location.current() ?? {}),
    }

    // `buildAppEvent` is pure, so placeholder validation has no observable runtime side effect.
    const preview = buildAppEvent(input.eventType, { ...base, eventSequenceId: 1 })
    if (!preview.ok) return preview

    const eventSequenceId = this.sequence.peek(input.eventType)
    const built = eventSequenceId === null
      ? preview
      : buildAppEvent(input.eventType, { ...base, eventSequenceId })
    if (!built.ok) return built

    const enqueued = this.queue.enqueue(built.event)
    if (!enqueued.ok) return enqueued
    if (eventSequenceId !== null) this.sequence.next(input.eventType)
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

export type TrackIntent = Readonly<{
  eventName: unknown
  properties?: unknown
}>

/**
 * Converts the two public business intents into protocol events. The caller owns readiness and
 * dataCollect gating; this class deliberately cannot emit raw arbitrary protocol records.
 */
export class EventDispatcher {
  public constructor(
    private readonly composer: EventComposer,
    private readonly currentPage: () => PageSnapshot | null,
  ) {}

  public track(intent: TrackIntent): boolean {
    const page = this.currentPage()
    const attributes = Object.fromEntries(this.attributes(intent.properties))
    return this.composer.compose({
      eventType: 'CUSTOM',
      fields: {
        eventName: intent.eventName,
        attributes,
        ...(page === null ? {} : {
          path: page.route,
          query: page.query,
          pageShowTimestamp: page.shownAt,
        }),
      },
    }).ok
  }

  /** User attributes are intentionally independent of current page and are never sequence-numbered. */
  public setUserAttributes(properties: unknown): boolean {
    return this.composer.compose({
      eventType: 'LOGIN_USER_ATTRIBUTES',
      fields: { attributes: Object.fromEntries(this.attributes(properties)) },
    }).ok
  }

  /** VIEW events are valid only with a current shown page; no host component object reaches composer. */
  public autoTrack(normalized: NormalizedAutoTrackCall): boolean {
    const page = this.currentPage()
    if (page === null || page.shownAt === null) return false
    return this.composer.compose({
      eventType: normalized.kind === 'click' ? 'VIEW_CLICK' : 'VIEW_CHANGE',
      fields: {
        path: page.route,
        query: page.query,
        pageShowTimestamp: page.shownAt,
        xpath: normalized.xpath,
        textValue: normalized.textValue,
        ...(normalized.kind === 'click' ? { index: normalized.index, hyperlink: normalized.hyperlink } : {}),
      },
    }).ok
  }

  private attributes(properties: unknown): ReadonlyMap<string, string> {
    return normalizeAttributes(properties).attributes
  }
}
