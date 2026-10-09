import {
  GIO_IDENTITY_CIPHER,
  decryptIdentityValue,
  encryptIdentityValue,
} from './identity-codec.js'

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
