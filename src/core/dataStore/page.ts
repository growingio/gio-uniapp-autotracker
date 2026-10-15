import { EventComposer } from './index.js'
import type { ClockPort } from '../../types/index.js'

export type PageSnapshot = Readonly<{
  pageKey: string
  route: string
  query: string
  title: string | null
  referralPage: string | null
  shownAt: number | null
}>

export type PageLoadInput = Readonly<{
  instanceId: string
  route: string
  query: string
  referralPage: string | null
}>

/** Stores only normalized lifecycle data; Vue/Page instances never enter the core. */
export class PageStore {
  private readonly pages = new Map<string, PageSnapshot>()
  private currentInstanceId: string | null = null
  private nextPageNumber = 1
  private readonly automaticReferrals = new Set<string>()
  private lastShownRoute: string | null = null
  private lastShownPageKey: string | null = null

  /** 冻结 onLoad query 与显式来源；自动来源在真实页面切换时更新。 */
  public onLoad(input: PageLoadInput): PageSnapshot | null {
    if (!this.validLoadInput(input)) return null
    const existing = this.pages.get(input.instanceId)
    if (existing !== undefined) return existing
    const snapshot: PageSnapshot = {
      pageKey: `page-${this.nextPageNumber++}`,
      route: input.route,
      query: input.query,
      title: null,
      referralPage: input.referralPage ?? this.lastShownRoute,
      shownAt: null,
    }
    if (input.referralPage === null) this.automaticReferrals.add(input.instanceId)
    this.pages.set(input.instanceId, snapshot)
    return snapshot
  }

  /** A true onShow selects the current page and may refresh its safely-read title. */
  public onShow(instanceId: string, shownAt: number, title: string | null): PageSnapshot | null {
    if (!Number.isFinite(shownAt) || shownAt < 0 || typeof title !== 'string' && title !== null) return null
    const page = this.pages.get(instanceId)
    if (page === undefined) return null
    const referralPage = this.automaticReferrals.has(instanceId) && this.lastShownRoute !== null && this.lastShownPageKey !== page.pageKey
      ? this.lastShownRoute : page.referralPage
    const snapshot = { ...page, title, shownAt, referralPage }
    this.pages.set(instanceId, snapshot)
    this.currentInstanceId = instanceId
    this.lastShownRoute = page.route
    this.lastShownPageKey = page.pageKey
    return snapshot
  }

  public setTitle(instanceId: string, title: string): void {
    const page = this.pages.get(instanceId)
    if (page !== undefined) this.pages.set(instanceId, { ...page, title })
  }

  /** Page hide never means App background; it only removes this instance as the current context. */
  public onHide(instanceId: string): void {
    if (this.currentInstanceId === instanceId) this.currentInstanceId = null
  }

  public onUnload(instanceId: string): void {
    this.pages.delete(instanceId)
    this.automaticReferrals.delete(instanceId)
    if (this.currentInstanceId === instanceId) this.currentInstanceId = null
  }

  public current(): PageSnapshot | null {
    if (this.currentInstanceId === null) return null
    return this.pages.get(this.currentInstanceId) ?? null
  }

  /** A consent replay starts a new PAGE time without simulating navigation or changing its referral. */
  public refreshCurrentShownAt(shownAt: number): PageSnapshot | null {
    const page = this.current()
    if (page === null || this.currentInstanceId === null || !Number.isFinite(shownAt) || shownAt < 0) return null
    const refreshed = { ...page, shownAt }
    this.pages.set(this.currentInstanceId, refreshed)
    return refreshed
  }

  private validLoadInput(input: PageLoadInput): boolean {
    return typeof input.instanceId === 'string' && input.instanceId.length > 0
      && typeof input.route === 'string' && input.route.length > 0
      && typeof input.query === 'string'
      && (typeof input.referralPage === 'string' || input.referralPage === null)
  }
}

export type PageOrientation = 'PORTRAIT' | 'LANDSCAPE'

export type OrientationInput = Readonly<{
  deviceOrientation?: unknown
  windowWidth?: unknown
  windowHeight?: unknown
}>

function normalizedOrientation(value: unknown): PageOrientation | null {
  if (typeof value !== 'string') return null
  const source = value.trim().toLowerCase()
  if (source === 'portrait') return 'PORTRAIT'
  if (source === 'landscape') return 'LANDSCAPE'
  return null
}

function inferredOrientation(width: unknown, height: unknown): PageOrientation | null {
  if (typeof width !== 'number' || typeof height !== 'number'
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width === height) return null
  return width > height ? 'LANDSCAPE' : 'PORTRAIT'
}

/** Resolves one PAGE orientation from host snapshots without keeping a host object in runtime state. */
export class OrientationResolver {
  private lastObserved: PageOrientation | null = null

  public resolve(input: OrientationInput): PageOrientation {
    const observed = normalizedOrientation(input.deviceOrientation) ?? inferredOrientation(input.windowWidth, input.windowHeight)
    if (observed !== null) {
      this.lastObserved = observed
      return observed
    }
    return this.lastObserved ?? 'PORTRAIT'
  }
}

export type PageShowResult = Readonly<{
  page: PageSnapshot | null
  pageQueued: boolean
}>

export type PageLifecycleDependencies = Readonly<{
  pages: PageStore
  composer: EventComposer
  clock: ClockPort
  orientation: () => PageOrientation
  canCollect: () => boolean
}>

/** Turns pre-normalized Page lifecycle snapshots into PAGE events; it never owns an App lifecycle. */
export class PageLifecycle {
  public constructor(private readonly dependencies: PageLifecycleDependencies) {}

  public onLoad(input: PageLoadInput): PageSnapshot | null {
    return this.dependencies.pages.onLoad(input)
  }

  public onShow(instanceId: string, title: string | null): PageShowResult {
    const page = this.dependencies.pages.onShow(instanceId, this.dependencies.clock.now(), title)
    return { page, pageQueued: page !== null && this.emitPage(page) }
  }

  public onHide(instanceId: string): void {
    this.dependencies.pages.onHide(instanceId)
  }

  public onUnload(instanceId: string): void {
    this.dependencies.pages.onUnload(instanceId)
  }

  /** Used after dataCollect false → true, after the lifecycle router has emitted its replacement VISIT. */
  public replayCurrentPage(): boolean {
    if (!this.dependencies.canCollect() || this.dependencies.pages.current() === null) return false
    const page = this.dependencies.pages.refreshCurrentShownAt(this.dependencies.clock.now())
    return page !== null && this.emitPage(page)
  }

  private emitPage(page: PageSnapshot): boolean {
    if (!this.dependencies.canCollect() || page.shownAt === null) return false
    return this.dependencies.composer.compose({
      eventType: 'PAGE',
      timestamp: page.shownAt,
      fields: {
        path: page.route,
        query: page.query,
        title: page.title,
        referralPage: page.referralPage,
        orientation: this.dependencies.orientation(),
      },
    }).ok
  }
}
