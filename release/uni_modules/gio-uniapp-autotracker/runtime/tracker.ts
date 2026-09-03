import { EventComposer } from '../core/event-composer.js'
import type { GioInitOptions, ResolvedGioConfig } from '../core/config.js'
import { EventSequence } from '../core/event-sequence.js'
import { hydrateTrackerState } from '../core/hydration.js'
import { IdentityPersistence, type DeviceIdFactory } from '../core/identity-persistence.js'
import { updateIdentity, type Identity } from '../core/identity.js'
import { LocationState } from '../core/location-state.js'
import { MetaPersistence } from '../core/meta-persistence.js'
import { PageStore, type PageLoadInput } from '../core/page-store.js'
import type { ClockPort, LoggerPort, NetworkPort, NetworkState, StoragePort, SystemContextPort, TimezonePort, TransportPort } from '../core/ports.js'
import type { ProtocolEvent } from '../core/protocol.js'
import { EventQueue } from '../core/queue.js'
import { QueuePersistence } from '../core/queue-persistence.js'
import { SessionPersistence } from '../core/session-persistence.js'
import { SessionManager, type SessionIdFactory } from '../core/session.js'
import { storageKeys } from '../core/storage-keys.js'
import { TrackerEventGate, type TrackerIntent } from '../core/tracker-event-gate.js'
import { TrackerLifecycle, type DataCollectTransition } from '../core/tracker-lifecycle.js'
import { AppLifecycle, type AppEntrySnapshot } from './app-lifecycle.js'
import { EventDispatcher } from './event-dispatcher.js'
import type { PageOrientation } from './orientation.js'
import { PageLifecycle } from './page-lifecycle.js'
import { Uploader, type UploaderRuntime } from '../core/uploader.js'
import type { AutoTrackCall } from '../autotrack/contract.js'

export type TrackerRuntimeDependencies = Readonly<{
  storage: StoragePort
  systemContext: SystemContextPort | ((config: ResolvedGioConfig) => SystemContextPort)
  clock: ClockPort
  timezone: TimezonePort
  deviceIdFactory: DeviceIdFactory
  sessionIdFactory: SessionIdFactory
  orientation: () => PageOrientation
  logger?: LoggerPort
  network?: NetworkPort
  upload?: Readonly<{ transport: TransportPort; runtime: UploaderRuntime }>
}>

type RuntimeState = Readonly<{
  identity: { value: Identity }
  identityPersistence: IdentityPersistence
  sessionPersistence: SessionPersistence
  metaPersistence: MetaPersistence
  queuePersistence: QueuePersistence
  queue: EventQueue
  sequence: EventSequence
  sessions: SessionManager
  location: LocationState
  app: AppLifecycle
  page: PageLifecycle
  dispatcher: EventDispatcher
  uploader: Uploader | null
  stopNetwork: (() => void) | null
}>

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null
}

/**
 * Runtime-only coordinator with explicit host ports. It deliberately exposes no `uni` objects,
 * allowing the production App bridge and static tests to share exactly the same hydration path.
 */
export class TrackerRuntime {
  private readonly lifecycle = new TrackerLifecycle()
  private readonly gate = new TrackerEventGate(this.lifecycle)
  private state: RuntimeState | null = null
  private bootstrapFailed = false
  private pendingCollectionResume = false
  private hydration: Promise<void> | null = null
  private userKeyIgnoredWarned = false

  public constructor(private readonly dependencies: TrackerRuntimeDependencies) {}

  public registerPlugins(...plugins: Parameters<TrackerLifecycle['registerPlugins']>): boolean {
    return this.lifecycle.registerPlugins(...plugins)
  }

  public init(options: unknown): boolean {
    const result = this.lifecycle.init(options as GioInitOptions)
    if (!result.ok) {
      this.log('warn', `[GrowingIO]: init failed (${result.code})`)
      return false
    }
    this.log('info', '[GrowingIO]: init accepted')
    this.hydration = this.hydrate(result.config)
    return true
  }

  public ready(): boolean {
    return this.lifecycle.status() === 'ready' && this.state !== null
  }

  public failed(): boolean {
    return this.bootstrapFailed
  }

  /** Intended for the App bridge and static integration tests, not as a business tracking API. */
  public async whenReady(): Promise<boolean> {
    await this.hydration
    return this.ready()
  }

  public queuedEvents(): readonly ProtocolEvent[] {
    return this.state?.queue.snapshot().map((entry) => entry.event) ?? []
  }

  public track(eventName: unknown, properties?: unknown): boolean {
    return this.gate.submit({ kind: 'track', payload: { eventName, properties } }, (intent) => this.emit(intent))
  }

  public autoTrack(call: AutoTrackCall): boolean {
    if (!this.lifecycle.registeredPlugins().some((plugin) => plugin.name === 'gioEventAutoTracking')) return false
    return this.gate.submit({ kind: 'autotrack', payload: call as Readonly<Record<string, unknown>> }, (intent) => this.emit(intent))
  }

  public setUserAttributes(properties: unknown): boolean {
    if (this.state === null || !this.collecting()) return false
    const result = this.state.dispatcher.setUserAttributes(properties)
    this.persistAfterEvent()
    return result
  }

  public setUserId(userId: unknown, userKey?: unknown): boolean {
    const state = this.state
    const config = this.lifecycle.config()
    if (state === null || config === null) return false
    const previous = state.identity.value
    const update = updateIdentity(previous, userId, userKey, config.idMapping)
    if (!update.ok) return false
    if (update.userKeyIgnored && !this.userKeyIgnoredWarned) {
      this.userKeyIgnoredWarned = true
      this.log('warn', '[GrowingIO]: userKey ignored because idMapping is disabled')
    }
    if (!this.updateIdentity(update.identity)) return false
    const transition = state.sessions.onUserIdChange(previous.userId, update.identity.userId)
    if (transition.snapshot !== null) void state.sessionPersistence.persist(transition.snapshot)
    if (transition.startedNew) state.app.onUserChanged()
    this.persistAfterEvent()
    return true
  }

  public clearUserId(): boolean {
    return this.setUserId('')
  }

  public setDataCollect(value: unknown): boolean {
    const transition = this.lifecycle.setDataCollect(value)
    if (!transition.ok) return false
    if (!transition.sessionRenewalRequired) return transition.changed
    if (this.state === null) {
      this.pendingCollectionResume = true
      return true
    }
    this.resumeCollection()
    return true
  }

  /** Only collection consent is mutable after initialization; all init-time options stay fixed. */
  public setOptions(options: unknown): boolean {
    const candidate = record(options)
    if (candidate === null || Object.keys(candidate).length !== 1 || !Object.hasOwn(candidate, 'dataCollect')) return false
    return this.setDataCollect(candidate.dataCollect)
  }

  public setLocation(latitude: unknown, longitude: unknown): boolean {
    return this.state?.location.set(latitude, longitude) ?? false
  }

  public clearLocation(): boolean {
    if (this.state === null) return false
    this.state.location.clear()
    return true
  }

  public onAppLaunch(entry: AppEntrySnapshot): boolean {
    return this.submitLifecycle('app-launch', entry)
  }

  public onAppShow(entry: AppEntrySnapshot): boolean {
    return this.submitLifecycle('app-show', entry)
  }

  public onAppHide(): boolean {
    return this.submitLifecycle('app-hide', {})
  }

  public onPageLoad(input: PageLoadInput): boolean {
    return this.submitLifecycle('page-load', input)
  }

  public onPageShow(instanceId: string, title: string | null): boolean {
    return this.submitLifecycle('page-show', { instanceId, title })
  }

  public onPageHide(instanceId: string): boolean {
    return this.submitLifecycle('page-hide', { instanceId })
  }

  public onPageUnload(instanceId: string): boolean {
    return this.submitLifecycle('page-unload', { instanceId })
  }

  private async hydrate(config: NonNullable<ReturnType<TrackerLifecycle['config']>>): Promise<void> {
    const keys = storageKeys(config.dataSourceId)
    const queue = new EventQueue()
    const identityPersistence = new IdentityPersistence(this.dependencies.storage, keys.identity, config.dataSourceId, this.dependencies.deviceIdFactory)
    const sessionPersistence = new SessionPersistence(this.dependencies.storage, keys.session)
    const metaPersistence = new MetaPersistence(this.dependencies.storage, keys.meta)
    const queuePersistence = new QueuePersistence(this.dependencies.storage, keys.queue)
    const hydrated = await hydrateTrackerState({
      hydrateIdentity: () => identityPersistence.hydrate(),
      hydrateSession: () => sessionPersistence.hydrate(),
      hydrateMeta: () => metaPersistence.hydrate(),
      hydrateQueue: () => queuePersistence.hydrate(queue),
      loadSystemContext: () => this.systemContext(config).load(),
    })
    if (!hydrated.ok) {
      this.bootstrapFailed = true
      this.log('error', '[GrowingIO]: initialization failed')
      return
    }

    const sessions = new SessionManager(config.sessionPolicy, this.dependencies.sessionIdFactory, hydrated.state.session.snapshot)
    const sequence = new EventSequence(hydrated.state.meta.snapshot.eventSequenceId)
    const location = new LocationState()
    const identity = { value: hydrated.state.identity.identity }
    let networkState: NetworkState = hydrated.state.systemContext.networkState
    const composer = new EventComposer(
      config, hydrated.state.systemContext, () => identity.value, sessions, sequence, queue,
      this.dependencies.clock, this.dependencies.timezone, location, () => networkState,
    )
    const pages = new PageStore()
    const page = new PageLifecycle({ pages, composer, clock: this.dependencies.clock, orientation: this.dependencies.orientation, canCollect: () => this.collecting() })
    const dispatcher = new EventDispatcher(composer, () => pages.current())
    const uploader = this.dependencies.upload === undefined ? null : new Uploader(
      queue,
      this.dependencies.upload.transport,
      this.dependencies.upload.runtime,
      config.serverUrl,
      config.accountId,
      (drop) => this.log('warn', `[GrowingIO]: upload dropped (${drop.reason})`),
      () => { void queuePersistence.persist(queue) },
      (events) => this.debugEvents(events),
    )
    const appWithFlush = new AppLifecycle({
      sessions, composer, clock: this.dependencies.clock, canCollect: () => this.collecting(), currentPage: () => pages.current(),
      persistSession: (snapshot) => { if (snapshot !== null) void sessionPersistence.persist(snapshot) },
      forceFlush: () => { if (uploader !== null) void uploader.forceFlush() },
    })
    const updateNetwork = (next: NetworkState): void => {
      const previous = networkState
      networkState = next
      if (previous === 'UNKNOWN' && next !== 'UNKNOWN') uploader?.flush()
    }
    const stopNetwork = this.dependencies.network === undefined ? null : this.dependencies.network.subscribe(updateNetwork)
    if (this.dependencies.network !== undefined) {
      void this.dependencies.network.current().then(updateNetwork).catch(() => updateNetwork('UNKNOWN'))
    }
    this.state = {
      identity, identityPersistence, sessionPersistence, metaPersistence, queuePersistence, queue, sequence, sessions, location,
      app: appWithFlush, page, dispatcher, uploader, stopNetwork,
    }
    this.log('success', '[GrowingIO]: initialized')
    this.gate.release((intent) => this.emit(intent))
    if (this.pendingCollectionResume) {
      this.pendingCollectionResume = false
      this.resumeCollection()
    }
  }

  private collecting(): boolean {
    return this.lifecycle.config()?.dataCollect === true
  }

  private systemContext(config: ResolvedGioConfig): SystemContextPort {
    return typeof this.dependencies.systemContext === 'function'
      ? this.dependencies.systemContext(config)
      : this.dependencies.systemContext
  }

  private submitLifecycle(kind: string, payload: Readonly<Record<string, unknown>>): boolean {
    return this.gate.submitLifecycle({ kind, payload }, (intent) => this.emit(intent))
  }

  private emit(intent: TrackerIntent): boolean {
    const state = this.state
    if (state === null) return false
    const payload = record(intent.payload)
    if (payload === null) return false
    let emitted = false
    switch (intent.kind) {
      case 'track': emitted = state.dispatcher.track({ eventName: payload.eventName, properties: payload.properties }); break
      case 'autotrack': emitted = state.dispatcher.autoTrack(payload as AutoTrackCall); break
      case 'app-launch': state.app.onLaunch(payload as AppEntrySnapshot); emitted = true; break
      case 'app-show': emitted = state.app.onShow(payload as AppEntrySnapshot).visitQueued; break
      case 'app-hide': emitted = state.app.onHide().appClosedQueued; break
      case 'page-load': emitted = state.page.onLoad(payload as PageLoadInput) !== null; break
      case 'page-show': emitted = typeof payload.instanceId === 'string' && (typeof payload.title === 'string' || payload.title === null)
        ? state.page.onShow(payload.instanceId, payload.title).pageQueued : false; break
      case 'page-hide': if (typeof payload.instanceId === 'string') { state.page.onHide(payload.instanceId); emitted = true }; break
      case 'page-unload': if (typeof payload.instanceId === 'string') { state.page.onUnload(payload.instanceId); emitted = true }; break
      default: return false
    }
    if (emitted) this.debugAction(intent.kind)
    this.persistAfterEvent()
    return emitted
  }

  private updateIdentity(identity: Identity): boolean {
    const state = this.state
    if (state === null) return false
    const previous = state.identity.value
    if (previous.deviceId === identity.deviceId && previous.userId === identity.userId && previous.userKey === identity.userKey) return true
    state.identity.value = identity
    void state.identityPersistence.persist(identity)
    return true
  }

  private resumeCollection(): void {
    const state = this.state
    if (state === null) return
    state.app.onCollectionResumed()
    state.page.replayCurrentPage()
    this.persistAfterEvent()
  }

  private persistAfterEvent(): void {
    const state = this.state
    if (state === null) return
    void state.queuePersistence.persist(state.queue)
    void state.metaPersistence.persist(state.sequence.current())
    state.uploader?.flush()
  }

  private debugAction(kind: string): void {
    if (this.lifecycle.config()?.debug !== true) return
    this.log('debug', `[GrowingIO Debug]: action=${kind}`)
  }

  /** Only the uploader knows a batch will actually be dispatched, so its observer owns event JSON logs. */
  private debugEvents(events: readonly ProtocolEvent[]): void {
    if (this.lifecycle.config()?.debug !== true) return
    try {
      this.log('debug', `[GrowingIO Debug]: ${JSON.stringify(events, null, 2)}`)
    } catch {
      this.log('debug', '[GrowingIO Debug]: []')
    }
  }

  private log(level: keyof LoggerPort, message: string): void {
    try { this.dependencies.logger?.[level](message) } catch { /* Diagnostics must never alter collection. */ }
  }
}
