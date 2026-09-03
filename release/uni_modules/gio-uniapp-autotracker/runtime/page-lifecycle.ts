import { EventComposer } from '../core/event-composer.js'
import { PageStore, type PageLoadInput, type PageSnapshot } from '../core/page-store.js'
import type { ClockPort } from '../core/ports.js'
import type { PageOrientation } from './orientation.js'

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
    const page = this.dependencies.pages.current()
    return page !== null && this.emitPage(page)
  }

  private emitPage(page: PageSnapshot): boolean {
    if (!this.dependencies.canCollect()) return false
    return this.dependencies.composer.compose({
      eventType: 'PAGE',
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
