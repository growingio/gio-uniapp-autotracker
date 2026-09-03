import { EventComposer } from '../core/event-composer.js'
import type { PageSnapshot } from '../core/page-store.js'
import type { ClockPort } from '../core/ports.js'
import { SessionManager, type SessionSnapshot, type SessionTransition } from '../core/session.js'

export type AppEntrySnapshot = Readonly<{
  path: string | null
  query: string | null
}>

export type AppShowResult = Readonly<{
  session: SessionTransition
  visitQueued: boolean
}>

export type AppHideResult = Readonly<{
  session: SessionSnapshot | null
  appClosedQueued: boolean
}>

export type AppLifecycleDependencies = Readonly<{
  sessions: SessionManager
  composer: EventComposer
  clock: ClockPort
  /** `dataCollect` belongs to TrackerLifecycle; this bridge only asks whether a behavior event is allowed now. */
  canCollect: () => boolean
  /** APP_CLOSED reuses the current page path/query when that context still exists. */
  currentPage?: () => PageSnapshot | null
  persistSession?: (snapshot: SessionSnapshot | null) => void
  forceFlush?: () => void
}>

function normalizeEntry(entry: AppEntrySnapshot): AppEntrySnapshot {
  return {
    path: typeof entry.path === 'string' && entry.path.length > 0 ? entry.path : null,
    query: typeof entry.query === 'string' ? entry.query : null,
  }
}

/**
 * Pure App.vue lifecycle router. It never reads `uni`, Page, or Vue objects, so platform glue can
 * turn host arguments into a small snapshot before entering the SDK.
 */
export class AppLifecycle {
  private launchEntry: AppEntrySnapshot | null = null
  private currentEntry: AppEntrySnapshot | null = null

  public constructor(private readonly dependencies: AppLifecycleDependencies) {}

  /** Records launch data for diagnostics only; App.onShow is the single source for VISIT input. */
  public onLaunch(entry: AppEntrySnapshot): void {
    this.launchEntry = normalizeEntry(entry)
  }

  public onShow(entry: AppEntrySnapshot): AppShowResult {
    this.currentEntry = normalizeEntry(entry)
    const session = this.dependencies.sessions.resume(this.dependencies.clock.now())
    this.persistSession(session.snapshot)
    const visitQueued = session.startedNew && this.dependencies.canCollect()
      ? this.dependencies.composer.compose({ eventType: 'VISIT', fields: this.currentEntry }).ok
      : false
    return { session, visitQueued }
  }

  /** Invoked only after `dataCollect` changes from false to true. */
  public onCollectionResumed(): AppShowResult {
    const session = this.dependencies.sessions.onCollectionResumed()
    this.persistSession(session.snapshot)
    const visitQueued = this.dependencies.canCollect()
      ? this.dependencies.composer.compose({ eventType: 'VISIT', fields: this.currentEntry ?? {} }).ok
      : false
    return { session, visitQueued }
  }

  /** The identity router has already replaced the session; this only emits its required VISIT. */
  public onUserChanged(): boolean {
    return this.dependencies.canCollect()
      ? this.dependencies.composer.compose({ eventType: 'VISIT', fields: this.currentEntry ?? {} }).ok
      : false
  }

  /** Best effort only: persistence and flush failures cannot block the host entering background. */
  public onHide(): AppHideResult {
    const session = this.dependencies.sessions.hide(this.dependencies.clock.now())
    const page = this.dependencies.currentPage?.() ?? null
    const appClosedQueued = session !== null && this.dependencies.canCollect()
      ? this.dependencies.composer.compose({
        eventType: 'APP_CLOSED',
        appState: 'BACKGROUND',
        fields: page === null ? {} : { path: page.route, query: page.query },
      }).ok
      : false
    this.persistSession(session)
    try {
      this.dependencies.forceFlush?.()
    } catch {
      // A host-specific flush is deliberately non-blocking during App.onHide.
    }
    return { session, appClosedQueued }
  }

  public entry(): Readonly<{ launch: AppEntrySnapshot | null; current: AppEntrySnapshot | null }> {
    return { launch: this.launchEntry, current: this.currentEntry }
  }

  private persistSession(snapshot: SessionSnapshot | null): void {
    try {
      this.dependencies.persistSession?.(snapshot)
    } catch {
      // Persistence is retried by the adapter on its next opportunity.
    }
  }
}
