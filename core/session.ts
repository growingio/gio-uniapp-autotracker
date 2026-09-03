import type { SessionPolicy } from './config.js'

export type SessionSnapshot = Readonly<{
  sessionId: string
  lastCloseTime: number | null
}>

export type SessionStartReason = 'initial' | 'timeout' | 'user_changed' | 'collection_resumed'

export type SessionTransition = Readonly<{
  snapshot: SessionSnapshot | null
  startedNew: boolean
  reason: SessionStartReason | null
}>

export type SessionIdFactory = () => string

function validTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function isLoggedIn(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function createSession(idFactory: SessionIdFactory, reason: SessionStartReason): SessionTransition {
  const sessionId = idFactory()
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('session_id_factory_returned_empty')
  }
  return {
    snapshot: { sessionId, lastCloseTime: null },
    startedNew: true,
    reason,
  }
}

/**
 * The session state machine deliberately has no host-storage dependency.
 * The App adapter persists `snapshot` only after a successful storage write.
 */
export class SessionManager {
  private snapshot: SessionSnapshot | null

  public constructor(
    private readonly policy: SessionPolicy,
    private readonly idFactory: SessionIdFactory,
    initialSnapshot: SessionSnapshot | null = null,
  ) {
    this.snapshot = initialSnapshot
  }

  public current(): SessionSnapshot | null {
    return this.snapshot
  }

  /** Handles App.onShow. Equality with the timeout continues the same session. */
  public resume(now: number): SessionTransition {
    if (!validTimestamp(now)) throw new Error('invalid_session_timestamp')

    if (this.snapshot === null || this.snapshot.sessionId.trim().length === 0) {
      return this.replace(createSession(this.idFactory, 'initial'))
    }

    const { lastCloseTime } = this.snapshot
    if (lastCloseTime !== null && validTimestamp(lastCloseTime) && now - lastCloseTime > this.policy.timeoutMs) {
      return this.replace(createSession(this.idFactory, 'timeout'))
    }

    this.snapshot = { ...this.snapshot, lastCloseTime: null }
    return { snapshot: this.snapshot, startedNew: false, reason: null }
  }

  /** Handles App.onHide: record the time but retain the session for a hot resume. */
  public hide(now: number): SessionSnapshot | null {
    if (!validTimestamp(now)) throw new Error('invalid_session_timestamp')
    if (this.snapshot === null) return null
    this.snapshot = { ...this.snapshot, lastCloseTime: now }
    return this.snapshot
  }

  /** Anonymous → A and A → empty preserve the session; A → B starts a new one. */
  public onUserIdChange(previousUserId: string | null | undefined, nextUserId: string | null | undefined): SessionTransition {
    if (isLoggedIn(previousUserId) && isLoggedIn(nextUserId) && previousUserId !== nextUserId) {
      return this.replace(createSession(this.idFactory, 'user_changed'))
    }
    if (this.snapshot === null) return { snapshot: null, startedNew: false, reason: null }
    return { snapshot: this.snapshot, startedNew: false, reason: null }
  }

  /** Privacy consent false → true always starts a fresh visit/session. */
  public onCollectionResumed(): SessionTransition {
    return this.replace(createSession(this.idFactory, 'collection_resumed'))
  }

  private replace(transition: SessionTransition): SessionTransition {
    if (transition.snapshot === null) throw new Error('session_transition_missing_snapshot')
    this.snapshot = transition.snapshot
    return transition
  }
}
