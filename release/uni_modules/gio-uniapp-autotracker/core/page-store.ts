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

  /** Freezes the page's onLoad query and referral. Repeated load calls cannot overwrite them. */
  public onLoad(input: PageLoadInput): PageSnapshot | null {
    if (!this.validLoadInput(input)) return null
    const existing = this.pages.get(input.instanceId)
    if (existing !== undefined) return existing
    const snapshot: PageSnapshot = {
      pageKey: `page-${this.nextPageNumber++}`,
      route: input.route,
      query: input.query,
      title: null,
      referralPage: input.referralPage,
      shownAt: null,
    }
    this.pages.set(input.instanceId, snapshot)
    return snapshot
  }

  /** A true onShow selects the current page and may refresh its safely-read title. */
  public onShow(instanceId: string, shownAt: number, title: string | null): PageSnapshot | null {
    if (!Number.isFinite(shownAt) || shownAt < 0 || typeof title !== 'string' && title !== null) return null
    const page = this.pages.get(instanceId)
    if (page === undefined) return null
    const snapshot = { ...page, title, shownAt }
    this.pages.set(instanceId, snapshot)
    this.currentInstanceId = instanceId
    return snapshot
  }

  /** Page hide never means App background; it only removes this instance as the current context. */
  public onHide(instanceId: string): void {
    if (this.currentInstanceId === instanceId) this.currentInstanceId = null
  }

  public onUnload(instanceId: string): void {
    this.pages.delete(instanceId)
    if (this.currentInstanceId === instanceId) this.currentInstanceId = null
  }

  public current(): PageSnapshot | null {
    if (this.currentInstanceId === null) return null
    return this.pages.get(this.currentInstanceId) ?? null
  }

  private validLoadInput(input: PageLoadInput): boolean {
    return typeof input.instanceId === 'string' && input.instanceId.length > 0
      && typeof input.route === 'string' && input.route.length > 0
      && typeof input.query === 'string'
      && (typeof input.referralPage === 'string' || input.referralPage === null)
  }
}
