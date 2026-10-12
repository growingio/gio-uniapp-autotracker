import { EventComposer } from '../core/event-composer.js'
import { BootstrapBuffer } from '../core/bootstrap-buffer.js'
import type { GioInitOptions, ResolvedGioConfig } from '../core/config.js'
import { EventSequence } from '../core/event-sequence.js'
import { hydrateTrackerState } from '../core/hydration.js'
import { IdentityPersistence, type DeviceIdFactory } from '../core/identity-persistence.js'
import { updateIdentity, type Identity } from '../core/identity.js'
import { LocationState } from '../core/location-state.js'
import { MetaPersistence } from '../core/meta-persistence.js'
import { PageStore, type PageLoadInput } from '../core/page-store.js'
import type { ClockPort, LoggerPort, NetworkPort, NetworkState, StoragePort, SystemContextPort, TimezonePort, TransportPort } from '../core/ports.js'
import { isValidCustomEventName, normalizeAttributes, type ProtocolEvent } from '../core/protocol.js'
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
import type { AutoTrackCall, ChangeElement, NormalizedAutoTrackCall } from '../autotrack/contract.js'
import { AutoTrackDispatcher } from './autotrack-dispatch.js'
import { appCapabilityProfile, type AppCapabilityProfile } from '../platform/capabilities.js'

declare const __GIO_AUTOTRACK_VERIFICATION__: boolean

export type TrackerRuntimeDependencies = Readonly<{
  storage: StoragePort
  systemContext: SystemContextPort | ((config: ResolvedGioConfig) => SystemContextPort)
  clock: ClockPort
  timezone: TimezonePort
  deviceIdFactory: DeviceIdFactory
  sessionIdFactory: SessionIdFactory
  orientation: () => PageOrientation
  logger?: LoggerPort
  /** 仅内部受控宿主验证注入，不通过 gdp init 暴露。 */
  autoTrackProfile?: AppCapabilityProfile
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
  pages: PageStore
  autoTrackProfile: AppCapabilityProfile | null
  uploader: Uploader | null
  stopNetwork: (() => void) | null
  refreshNetwork: (requireFresh?: boolean) => void
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
  private appShown = false
  private intentCollection: boolean | undefined
  private readonly pendingSessionCommands = new BootstrapBuffer()
  private hydration: Promise<void> | null = null
  private userKeyIgnoredWarned = false
  private readonly autoTrackDispatcher = new AutoTrackDispatcher()

  public constructor(private readonly dependencies: TrackerRuntimeDependencies) {}

  public registerPlugins(...plugins: Parameters<TrackerLifecycle['registerPlugins']>): boolean {
    return this.lifecycle.registerPlugins(...plugins)
  }

  public registeredPluginNames(): readonly string[] { return this.lifecycle.registeredPlugins().map((plugin) => plugin.name) }

  public init(options: unknown): boolean {
    this.log('info', '[GrowingIO]：Gio uni-app SDK 初始化中...')
    const result = this.lifecycle.init(options as GioInitOptions)
    if (!result.ok) {
      this.log(
        result.code === 'already_initialized' ? 'warn' : 'error',
        result.code === 'already_initialized'
          ? '[GrowingIO]：SDK重复初始化，请检查是否重复加载SDK或接入其他平台SDK导致冲突!'
          : '[GrowingIO]：SDK初始化失败，初始化参数不合法!',
      )
      return false
    }
    this.hydration = this.hydrate(result.config).catch(() => {
      this.bootstrapFailed = true
      this.log('error', '[GrowingIO]：SDK初始化失败，运行时初始化异常!')
    })
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
    return this.submitAttributes('track', properties, eventName)
  }

  public autoTrack(call: AutoTrackCall, nativeEvent?: unknown): boolean {
    try {
      if (!this.ready() || !this.collecting() || !this.lifecycle.registeredPlugins().some((plugin) => plugin.name === 'gioEventAutoTracking')) return false
      const state = this.state
      const profile = state?.autoTrackProfile
      const probe = record(call)
      if (state === null || profile == null || probe === null) return false
      const allowed = probe.source === 'tabbar' ? profile.tabBar : probe.kind === 'click' ? profile.autoClick
        : typeof probe.elementType === 'string' && Object.prototype.hasOwnProperty.call(profile.autoChange, probe.elementType) && profile.autoChange[probe.elementType as ChangeElement]
      if (!allowed) { this.autoTrackRejected('capability_unverified'); return false }
      const page = state.pages.current()
      const accepted = this.autoTrackDispatcher.dispatch(call, nativeEvent, page?.shownAt == null ? null : page.pageKey,
        (normalized) => this.gate.submit({ kind: 'autotrack', payload: normalized }, (intent) => this.emit(intent)))
      if (!accepted) this.autoTrackRejected('invalid_or_duplicate')
      return accepted
    } catch {
      this.autoTrackRejected('invalid_probe')
      return false
    }
  }

  public setUserAttributes(properties: unknown): boolean {
    return this.submitAttributes('user-attributes', properties)
  }

  private submitAttributes(kind: 'track' | 'user-attributes', properties: unknown, eventName?: unknown): boolean {
    if (this.lifecycle.config()?.dataCollect !== true) return false
    if (kind === 'track' && !isValidCustomEventName(eventName)) return false
    try {
      // 在 JSON 快照之前统一属性语义；关闭采集时不能读取业务属性。
      const attributes = Object.fromEntries(normalizeAttributes(properties).attributes)
      return this.gate.submit({ kind, payload: { eventName, properties: attributes } }, (intent) => this.emit(intent))
    } catch { return false }
  }

  public setUserId(userId: unknown, userKey?: unknown): boolean {
    const config = this.lifecycle.config()
    if (config === null || !updateIdentity({ deviceId: 'pending', userId: null, userKey: null }, userId, userKey, config.idMapping).ok) return false
    const deferred = this.deferStateCommand('user-id', { userId, userKey })
    if (deferred !== null) return deferred
    const state = this.state
    if (state === null || config === null) return false
    const previous = state.identity.value
    const update = updateIdentity(previous, userId, userKey, config.idMapping)
    if (!update.ok) return false
    if (update.userKeyIgnored && !this.userKeyIgnoredWarned) {
      this.userKeyIgnoredWarned = true
      this.log('warn', '[GrowingIO]: userKey ignored because idMapping is disabled')
    }
    if (!this.updateIdentity(update.identity)) return false
    // 首次显示之前只保存身份，不能为早期 A→B 创建无入口的 VISIT 或使用历史会话。
    if (!this.appShown) return true
    const transition = state.sessions.onUserIdChange(previous.userId ?? previous.lastUserId, update.identity.userId)
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
    if (!transition.sessionRenewalRequired) return true
    if (this.submitLifecycle('collection-resume', {})) return true
    // A full bootstrap buffer must not enable collection without its required resume boundary.
    this.lifecycle.setDataCollect(false)
    return false
  }

  /** Only collection consent is mutable after initialization; all init-time options stay fixed. */
  public setOptions(options: unknown): boolean {
    const candidate = record(options)
    if (candidate === null || Object.keys(candidate).length !== 1 || !Object.prototype.hasOwnProperty.call(candidate, 'dataCollect')) return false
    return this.setDataCollect(candidate.dataCollect)
  }

  public setLocation(latitude: unknown, longitude: unknown): boolean {
    if (!new LocationState().set(latitude, longitude)) return false
    const deferred = this.deferStateCommand('location', { latitude, longitude })
    if (deferred !== null) return deferred
    return this.state?.location.set(latitude, longitude) ?? false
  }

  public clearLocation(): boolean {
    const deferred = this.deferStateCommand('clear-location', {})
    if (deferred !== null) return deferred
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

  public onPageTitleChanged(instanceId: string, title: string): boolean {
    return this.submitLifecycle('page-title', { instanceId, title })
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
      this.log('error', '[GrowingIO]：SDK初始化失败!')
      return
    }

    const sessions = new SessionManager(config.sessionPolicy, this.dependencies.sessionIdFactory, hydrated.state.session.snapshot,
      hydrated.state.identity.identity.lastUserId ?? hydrated.state.identity.identity.userId)
    const sequence = new EventSequence(hydrated.state.meta.snapshot.eventSequenceId)
    const location = new LocationState()
    const identity = { value: hydrated.state.identity.identity }
    if (!config.idMapping && identity.value.userKey !== null) {
      identity.value = { ...identity.value, userKey: null }
      await identityPersistence.persist(identity.value)
    }
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
      () => this.dependencies.network?.isConnected() !== false,
    )
    const appWithFlush = new AppLifecycle({
      sessions, composer, clock: this.dependencies.clock, canCollect: () => this.collecting(), currentPage: () => pages.current(),
      persistSession: (snapshot) => { if (snapshot !== null) void sessionPersistence.persist(snapshot) },
      forceFlush: () => { if (uploader !== null) void uploader.forceFlush() },
    })
    let connected = this.dependencies.network?.isConnected()
    let networkRevision = 0
    const updateNetwork = (next: NetworkState): void => {
      networkRevision++
      networkState = next
      // cellular/unknown 也可能明确联网；由独立连接状态决定能否恢复上传。
      const nextConnected = this.dependencies.network?.isConnected()
      if (connected === false && nextConnected !== false) uploader?.flush()
      else uploader?.schedule()
      connected = nextConnected
    }
    const stopNetwork = this.dependencies.network === undefined ? null : this.dependencies.network.subscribe(updateNetwork)
    let readingNetwork = false
    let refreshPending = false
    const refreshNetwork = (requireFresh = false): void => {
      const network = this.dependencies.network
      if (network === undefined) return
      if (readingNetwork) {
        // Startup may share its first read, but a later foreground needs a fresh reading.
        refreshPending ||= requireFresh
        return
      }
      readingNetwork = true
      const revision = networkRevision
      const applyReading = (next: NetworkState): void => {
        // A host notification can arrive after current() settles but before its Promise callback.
        if (revision === networkRevision) updateNetwork(next)
      }
      void network.current().then(applyReading).catch(() => applyReading('UNKNOWN')).finally(() => {
        readingNetwork = false
        if (refreshPending) {
          refreshPending = false
          refreshNetwork()
        }
      })
    }
    refreshNetwork()
    this.state = {
      identity, identityPersistence, sessionPersistence, metaPersistence, queuePersistence, queue, sequence, sessions, location,
      app: appWithFlush, page, dispatcher, pages, uploader, stopNetwork, refreshNetwork,
      autoTrackProfile: this.dependencies.autoTrackProfile ?? appCapabilityProfile(hydrated.state.systemContext.platform, typeof __GIO_AUTOTRACK_VERIFICATION__ !== 'undefined' && __GIO_AUTOTRACK_VERIFICATION__ === true),
    }
    this.log('success', '[GrowingIO]：Gio uni-app SDK 初始化完成！')
    this.gate.release((intent) => this.emit(intent))
  }

  private collecting(): boolean {
    return this.lifecycle.config()?.dataCollect === true && this.intentCollection !== false
  }

  private systemContext(config: ResolvedGioConfig): SystemContextPort {
    return typeof this.dependencies.systemContext === 'function'
      ? this.dependencies.systemContext(config)
      : this.dependencies.systemContext
  }

  private submitLifecycle(kind: string, payload: Readonly<Record<string, unknown>>): boolean {
    if (this.lifecycle.config() === null) return false
    // Preserve observed background intervals through hydration; wire timestamps still use creation time.
    const timed = kind === 'app-show' || kind === 'app-hide'
    let observedAt: number | undefined
    if (timed) {
      try { observedAt = this.dependencies.clock.now() } catch { return false }
      if (!Number.isFinite(observedAt) || observedAt < 0) return false
    }
    return this.gate.submitLifecycle({ kind, payload, ...(observedAt === undefined ? {} : { observedAt }) }, (intent) => this.emit(intent))
  }

  private emit(intent: TrackerIntent): boolean {
    const previous = this.intentCollection
    this.intentCollection = intent.collecting
    try { return this.emitIntent(intent) } finally { this.intentCollection = previous }
  }

  private deferStateCommand(kind: string, payload: Readonly<Record<string, unknown>>): boolean | null {
    if (this.state === null) return this.submitLifecycle(kind, payload)
    // 首个等待会话的事件之后，状态修改也需要保序，防止事件串用后续身份或位置。
    if (!this.appShown && this.pendingSessionCommands.size() > 0) {
      return this.pendingSessionCommands.push({ kind, payload, collecting: this.intentCollection ?? this.lifecycle.config()?.dataCollect })
    }
    return null
  }

  private emitIntent(intent: TrackerIntent): boolean {
    const state = this.state
    if (state === null) return false
    const payload = record(intent.payload)
    if (payload === null) return false
    if (intent.kind === 'track' || intent.kind === 'user-attributes') {
      if (!this.collecting()) return false
      // 恢复出的历史会话不能承接本次启动的业务事件，等待首次真实 App.onShow。
      if (!this.appShown) return this.pendingSessionCommands.push(intent)
    }
    const shownBefore = state.pages.current()
    let emitted = false
    let lifecycleHandled = false
    switch (intent.kind) {
      case 'user-id': return this.setUserId(payload.userId, payload.userKey)
      case 'location': return this.setLocation(payload.latitude, payload.longitude)
      case 'clear-location': return this.clearLocation()
      case 'user-attributes': emitted = state.dispatcher.setUserAttributes(payload.properties); break
      case 'collection-resume':
        if (this.appShown && this.collecting()) this.resumeCollection()
        return true
      case 'track': emitted = state.dispatcher.track({ eventName: payload.eventName, properties: payload.properties }); break
      case 'autotrack': emitted = state.dispatcher.autoTrack(payload as NormalizedAutoTrackCall); break
      case 'app-launch': state.app.onLaunch(payload as AppEntrySnapshot); emitted = true; lifecycleHandled = true; break
      case 'app-show':
        emitted = state.app.onShow(payload as AppEntrySnapshot, intent.observedAt).visitQueued
        state.refreshNetwork(this.appShown)
        this.appShown = true
        lifecycleHandled = true
        for (const command of this.pendingSessionCommands.drain()) this.emit(command as TrackerIntent)
        break
      case 'app-hide': emitted = state.app.onHide(intent.observedAt).appClosedQueued; lifecycleHandled = true; break
      case 'page-load': emitted = state.page.onLoad(payload as PageLoadInput) !== null; lifecycleHandled = true; break
      case 'page-title':
        if (typeof payload.instanceId !== 'string' || typeof payload.title !== 'string') return false
        state.pages.setTitle(payload.instanceId, payload.title)
        return true
      case 'page-show': emitted = typeof payload.instanceId === 'string' && (typeof payload.title === 'string' || payload.title === null)
        ? state.page.onShow(payload.instanceId, payload.title).pageQueued : false; lifecycleHandled = typeof payload.instanceId === 'string' && (typeof payload.title === 'string' || payload.title === null); break
      case 'page-hide': if (typeof payload.instanceId === 'string') { state.page.onHide(payload.instanceId); emitted = true; lifecycleHandled = true }; break
      case 'page-unload': if (typeof payload.instanceId === 'string') { state.page.onUnload(payload.instanceId); emitted = true; lifecycleHandled = true }; break
      default: return false
    }
    if (state.pages.current() !== shownBefore) this.autoTrackDispatcher.reset()
    if (emitted || lifecycleHandled) this.debugAction(intent.kind, payload)
    this.persistAfterEvent()
    return emitted
  }

  private updateIdentity(identity: Identity): boolean {
    const state = this.state
    if (state === null) return false
    const previous = state.identity.value
    if (previous.deviceId === identity.deviceId && previous.userId === identity.userId && previous.userKey === identity.userKey && previous.lastUserId === identity.lastUserId) return true
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
    state.uploader?.schedule()
  }

  /** Matches the mini-program SDK's lifecycle diagnostics while keeping event JSON at send time. */
  private debugAction(kind: string, payload: Readonly<Record<string, unknown>>): void {
    if (this.lifecycle.config()?.debug !== true) return
    const timestamp = this.dependencies.clock.now()
    switch (kind) {
      case 'app-launch': this.log('debug', `App: onLaunch ${timestamp}`); return
      case 'app-show': this.log('debug', `App: onShow ${timestamp}`); return
      case 'app-hide': this.log('debug', `App: onHide ${timestamp}`); return
      case 'page-load': this.log('debug', `Page: ${typeof payload.route === 'string' ? payload.route : ''} # onLoad ${timestamp}`); return
      case 'page-show': this.log('debug', `Page: ${typeof payload.instanceId === 'string' ? payload.instanceId : ''} # onShow ${timestamp}`); return
      case 'page-hide': this.log('debug', `Page: ${typeof payload.instanceId === 'string' ? payload.instanceId : ''} # onHide ${timestamp}`); return
      case 'page-unload': this.log('debug', `Page: ${typeof payload.instanceId === 'string' ? payload.instanceId : ''} # onUnload ${timestamp}`); return
      case 'autotrack': this.log('debug', `[GrowingIO Debug]: action=${payload.kind === 'change' ? 'change' : 'click'}`); return
      default: this.log('debug', `[GrowingIO Debug]: action=${kind}`)
    }
  }

  /** Only the uploader knows a batch will actually be dispatched, so it logs the event-object array. */
  private debugEvents(events: readonly ProtocolEvent[]): void {
    if (this.lifecycle.config()?.debug !== true) return
    try {
      // App 调试基座可能只展示 console.log 的第一个参数，必须合成一条完整日志。
      this.dependencies.logger?.debug(`[GrowingIO Debug]: ${JSON.stringify(events)}`)
    } catch {
      // Diagnostics must never alter collection.
    }
  }

  private autoTrackRejected(reason: string): void {
    if (this.lifecycle.config()?.debug === true) this.log('debug', `[GrowingIO Debug]: autotrack_rejected=${reason}`)
  }

  private log(level: keyof LoggerPort, message: string): void {
    try { this.dependencies.logger?.[level](message) } catch { /* Diagnostics must never alter collection. */ }
  }
}
