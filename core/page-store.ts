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
