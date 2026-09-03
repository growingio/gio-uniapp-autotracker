import { EventComposer } from '../core/event-composer.js'
import { normalizeAttributes } from '../core/protocol.js'
import type { PageSnapshot } from '../core/page-store.js'
import { normalizeAutoTrackCall, type AutoTrackCall } from '../autotrack/contract.js'

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
  public autoTrack(call: AutoTrackCall): boolean {
    const normalized = normalizeAutoTrackCall(call)
    const page = this.currentPage()
    if (normalized === null || normalized.ignored || normalized.sensitive || page === null || page.shownAt === null) return false
    return this.composer.compose({
      eventType: normalized.kind === 'click' ? 'VIEW_CLICK' : 'VIEW_CHANGE',
      fields: {
        path: page.route,
        query: page.query,
        pageShowTimestamp: page.shownAt,
        xpath: normalized.xpath,
        // A change value is opt-in. Click labels come from the compiler's static data-title only.
        textValue: normalized.kind === 'change' && !normalized.trackValue ? null : normalized.textValue,
        index: normalized.index,
        hyperlink: normalized.hyperlink,
      },
    }).ok
  }

  private attributes(properties: unknown): ReadonlyMap<string, string> {
    return normalizeAttributes(properties).attributes
  }
}
