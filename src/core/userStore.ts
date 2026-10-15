import { GIO_IDENTITY_CIPHER, decryptIdentityValue, encryptIdentityValue } from './storage/encrypt.js'
import type { SessionPolicy } from '../constants/config.js'

export const IDENTITY_VALUE_MAX_LENGTH = 1000

export type Identity = Readonly<{
  deviceId: string
  userId: string | null
  userKey: string | null
  /** Internal comparison identity retained through logout; never emitted as event userId. */
  lastUserId?: string | null
}>

export type IdentityRecordRead =
  | Readonly<{ kind: 'current' | 'legacy'; identity: Identity }>
  | Readonly<{ kind: 'corrupt' }>

export type IdentityUpdate = Readonly<{
  ok: boolean
  identity: Identity
  userKeyIgnored: boolean
  changed: boolean
}>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWithinLimit(value: string): boolean {
  const characters = Array.from(value)
  // The shared storage codec cannot encrypt unpaired UTF-16; reject before mutating identity.
  return characters.length <= IDENTITY_VALUE_MAX_LENGTH
    && characters.every((character) => character.length > 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff)
}

function validIdentity(value: unknown): value is Identity {
  return isRecord(value)
    && typeof value.deviceId === 'string'
    && value.deviceId.length > 0
    && isWithinLimit(value.deviceId)
    && (typeof value.userId === 'string' || value.userId === null)
    && (typeof value.userKey === 'string' || value.userKey === null)
    && (value.userId === null || isWithinLimit(value.userId))
    && (value.userKey === null || isWithinLimit(value.userKey))
    && (value.lastUserId === undefined || value.lastUserId === null || typeof value.lastUserId === 'string' && isWithinLimit(value.lastUserId))
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.deviceId === right.deviceId && left.userId === right.userId && left.userKey === right.userKey && left.lastUserId === right.lastUserId
}

/** Writes versioned JSON, protecting every populated identity field separately. */
export function serializeIdentityRecord(identity: Identity, dataSourceId: string): string {
  if (!validIdentity(identity)) throw new Error('identity_invalid')
  const protect = (value: string | null): string | null => value === null ? null : encryptIdentityValue(value, dataSourceId)
  return JSON.stringify({
    version: 1,
    expiresAt: null,
    cipher: GIO_IDENTITY_CIPHER,
    value: {
      deviceId: protect(identity.deviceId),
      userId: protect(identity.userId),
      userKey: protect(identity.userKey),
      ...(identity.lastUserId === undefined ? {} : { lastUserId: protect(identity.lastUserId) }),
    },
  })
}

/** Accepts the old plain envelope once so a later successful write can migrate it. */
export function readIdentityRecord(serialized: string, dataSourceId: string): IdentityRecordRead {
  let record: unknown
  try {
    record = JSON.parse(serialized)
  } catch {
    return { kind: 'corrupt' }
  }
  if (!isRecord(record) || record.version !== 1 || record.expiresAt !== null || !isRecord(record.value)) return { kind: 'corrupt' }

  if (record.cipher === undefined) {
    return validIdentity(record.value) ? { kind: 'legacy', identity: record.value } : { kind: 'corrupt' }
  }
  if (record.cipher !== GIO_IDENTITY_CIPHER) return { kind: 'corrupt' }

  // A stored null is anonymous; failure to decrypt a populated field is corruption.
  const decrypt = (value: unknown): string | null | undefined => value === null ? null : decryptIdentityValue(value, dataSourceId) ?? undefined
  const hasLastUserId = Object.prototype.hasOwnProperty.call(record.value, 'lastUserId')
  const lastUserId = hasLastUserId ? decrypt(record.value.lastUserId) : undefined
  if (hasLastUserId && lastUserId === undefined) return { kind: 'corrupt' }
  const identity = {
    deviceId: decrypt(record.value.deviceId),
    userId: decrypt(record.value.userId),
    userKey: decrypt(record.value.userKey),
    ...(hasLastUserId ? { lastUserId } : {}),
  }
  return validIdentity(identity) ? { kind: 'current', identity } : { kind: 'corrupt' }
}

/** Applies public `setUserId` semantics without deciding when an adapter persists the result. */
export function updateIdentity(
  current: Identity,
  userId: unknown,
  userKey: unknown,
  idMapping: boolean,
): IdentityUpdate {
  if (!validIdentity(current) || typeof userId !== 'string' || !isWithinLimit(userId)) {
    return { ok: false, identity: current, userKeyIgnored: false, changed: false }
  }
  if (userKey !== undefined && userKey !== null && (typeof userKey !== 'string' || !isWithinLimit(userKey))) {
    return { ok: false, identity: current, userKeyIgnored: false, changed: false }
  }
  const next: Identity = userId.length === 0
    ? { ...current, userId: null, userKey: null, lastUserId: current.userId ?? current.lastUserId ?? null }
    : { ...current, userId, userKey: idMapping ? (userKey ?? null) : null, lastUserId: userId }
  return {
    ok: true,
    identity: next,
    userKeyIgnored: userId.length > 0 && !idMapping && userKey !== undefined && userKey !== null,
    changed: !sameIdentity(current, next),
  }
}

export type SessionSnapshot = Readonly<{
  sessionId: string
  lastCloseTime: number | null
}>

export type SessionStartReason = 'initial' | 'cold_start' | 'timeout' | 'user_changed' | 'collection_resumed'

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
  return typeof value === 'string' && value.length > 0
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
  private lastUserId: string | null

  public constructor(
    private readonly policy: SessionPolicy,
    private readonly idFactory: SessionIdFactory,
    initialSnapshot: SessionSnapshot | null = null,
    initialLastUserId: string | null = null,
  ) {
    this.snapshot = initialSnapshot
    this.lastUserId = isLoggedIn(initialLastUserId) ? initialLastUserId : null
  }

  public current(): SessionSnapshot | null {
    return this.snapshot
  }

  /** A new App JS runtime is a cold start even when a prior session was persisted moments ago. */
  public onProcessLaunch(): SessionTransition {
    const reason: SessionStartReason = this.snapshot === null || this.snapshot.sessionId.trim() === ''
      ? 'initial'
      : 'cold_start'
    return this.replace(createSession(this.idFactory, reason))
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

  /** First login and logout preserve the session; a different login after logout still renews it. */
  public onUserIdChange(previousUserId: string | null | undefined, nextUserId: string | null | undefined): SessionTransition {
    const previous = isLoggedIn(previousUserId) ? previousUserId : this.lastUserId
    if (isLoggedIn(nextUserId)) this.lastUserId = nextUserId ?? null
    else if (isLoggedIn(previousUserId)) this.lastUserId = previousUserId ?? null
    if (isLoggedIn(previous) && isLoggedIn(nextUserId) && previous !== nextUserId) {
      return this.replace(createSession(this.idFactory, 'user_changed'), true)
    }
    if (this.snapshot === null) return { snapshot: null, startedNew: false, reason: null }
    return { snapshot: this.snapshot, startedNew: false, reason: null }
  }

  /** Privacy consent false → true always starts a fresh visit/session. */
  public onCollectionResumed(): SessionTransition {
    return this.replace(createSession(this.idFactory, 'collection_resumed'), true)
  }

  private replace(transition: SessionTransition, preserveCloseTime = false): SessionTransition {
    if (transition.snapshot === null) throw new Error('session_transition_missing_snapshot')
    // 后台更新身份或采集开关不会让 App 回到前台，必须保留离开时间。
    this.snapshot = preserveCloseTime
      ? { ...transition.snapshot, lastCloseTime: this.snapshot?.lastCloseTime ?? null }
      : transition.snapshot
    return { ...transition, snapshot: this.snapshot }
  }
}

export type Location = Readonly<{ latitude: number; longitude: number }>

/** Memory-only explicit business location; it never requests a permission or touches storage. */
export class LocationState {
  private location: Location | null = null

  public set(latitude: unknown, longitude: unknown): boolean {
    if (typeof latitude !== 'number' || typeof longitude !== 'number'
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false
    this.location = { latitude, longitude }
    return true
  }

  public clear(): void {
    this.location = null
  }

  public current(): Location | null {
    return this.location === null ? null : { ...this.location }
  }
}
