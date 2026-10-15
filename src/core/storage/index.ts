import { readIdentityRecord, serializeIdentityRecord, type Identity, type SessionSnapshot } from '../userStore.js'
import type { StoragePort, StorageWrite } from '../../types/index.js'
import type { EventSequenceSnapshot } from '../dataStore/index.js'
import { EventQueue, type QueueEntry } from '../queue.js'

export const GIO_STORAGE_PREFIX = 'gio:v1:'

export type StorageKeys = Readonly<{
  identity: string
  session: string
  meta: string
  queue: string
}>

export function storageKeys(dataSourceId: string): StorageKeys {
  const prefix = `${GIO_STORAGE_PREFIX}${dataSourceId}:`
  return { identity: `${prefix}identity`, session: `${prefix}session`, meta: `${prefix}meta`, queue: `${prefix}queue:v1` }
}

export type IdentityHydration = Readonly<{
  identity: Identity
  source: 'restored' | 'legacy' | 'generated' | 'corrupt' | 'unavailable'
}>

export type DeviceIdFactory = () => string

function generatedIdentity(factory: DeviceIdFactory): Identity {
  const deviceId = factory()
  if (typeof deviceId !== 'string' || deviceId.length === 0) throw new Error('device_id_factory_returned_empty')
  return { deviceId, userId: null, userKey: null }
}

/** IDs issued by the first App preview builds were not UUIDs and must not survive this migration. */
function isLegacyAppGeneratedDeviceId(deviceId: string): boolean {
  return /^device-[a-z0-9]+-[a-z0-9]+$/i.test(deviceId)
}

/** Restores one identity record and only ever deletes this SDK's namespace key. */
export class IdentityPersistence {
  public constructor(
    private readonly storage: StoragePort,
    private readonly key: string,
    private readonly dataSourceId: string,
    private readonly deviceIdFactory: DeviceIdFactory,
  ) {}

  public async hydrate(): Promise<IdentityHydration> {
    const read = await this.storage.read('state', this.key)
    if (read.kind === 'missing') return this.generateAndPersist('generated')
    if (read.kind === 'unavailable') return { identity: generatedIdentity(this.deviceIdFactory), source: 'unavailable' }
    if (read.kind === 'corrupt') {
      await this.storage.remove('state', this.key)
      return this.generateAndPersist('corrupt')
    }
    if (read.kind !== 'value') return { identity: generatedIdentity(this.deviceIdFactory), source: 'unavailable' }

    const decoded = readIdentityRecord(read.value, this.dataSourceId)
    if (decoded.kind === 'corrupt') {
      await this.storage.remove('state', this.key)
      return this.generateAndPersist('corrupt')
    }
    if (decoded.kind === 'legacy') {
      return this.persistDecodedIdentity(decoded.identity, 'legacy')
    }
    return this.persistDecodedIdentity(decoded.identity, 'restored')
  }

  public persist(identity: Identity): Promise<StorageWrite> {
    return this.storage.write('state', this.key, serializeIdentityRecord(identity, this.dataSourceId))
  }

  /** A first-run identity must survive the next cold start; a failed best-effort write never blocks init. */
  private async generateAndPersist(source: 'generated' | 'corrupt'): Promise<IdentityHydration> {
    const identity = generatedIdentity(this.deviceIdFactory)
    try {
      await this.persist(identity)
    } catch {
      // Storage failures are handled as unavailable on the next hydration attempt.
    }
    return { identity, source }
  }

  private async persistDecodedIdentity(identity: Identity, source: 'legacy' | 'restored'): Promise<IdentityHydration> {
    if (!isLegacyAppGeneratedDeviceId(identity.deviceId)) {
      if (source === 'legacy') await this.persist(identity)
      return { identity, source }
    }

    const migrated: Identity = { ...identity, deviceId: generatedIdentity(this.deviceIdFactory).deviceId }
    try {
      await this.persist(migrated)
    } catch {
      // The UUID is still used for this process; storage failures are handled on next hydration.
    }
    return { identity: migrated, source: 'generated' }
  }
}

export type SessionHydration = Readonly<{ snapshot: SessionSnapshot | null; source: 'restored' | 'missing' | 'corrupt' | 'unavailable' }>

function validSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, unknown>>
  return typeof record.sessionId === 'string' && record.sessionId.length > 0
    && (record.lastCloseTime === null || (typeof record.lastCloseTime === 'number' && Number.isFinite(record.lastCloseTime) && record.lastCloseTime >= 0))
}

function encodeSession(snapshot: SessionSnapshot): string {
  return JSON.stringify({ version: 1, expiresAt: null, value: snapshot })
}

/** Session failure is isolated from identity/meta and never triggers broad host-storage cleanup. */
export class SessionPersistence {
  public constructor(private readonly storage: StoragePort, private readonly key: string) {}

  public async hydrate(): Promise<SessionHydration> {
    const read = await this.storage.read('state', this.key)
    if (read.kind === 'missing') return { snapshot: null, source: 'missing' }
    if (read.kind === 'unavailable') return { snapshot: null, source: 'unavailable' }
    if (read.kind === 'corrupt') {
      await this.storage.remove('state', this.key)
      return { snapshot: null, source: 'corrupt' }
    }
    if (read.kind !== 'value') return { snapshot: null, source: 'unavailable' }
    try {
      const record: unknown = JSON.parse(read.value)
      if (typeof record !== 'object' || record === null || Array.isArray(record)) throw new Error('session_record_corrupt')
      const envelope = record as Readonly<Record<string, unknown>>
      if (envelope.version !== 1 || envelope.expiresAt !== null || !validSessionSnapshot(envelope.value)) throw new Error('session_record_corrupt')
      return { snapshot: envelope.value, source: 'restored' }
    } catch {
      await this.storage.remove('state', this.key)
      return { snapshot: null, source: 'corrupt' }
    }
  }

  public persist(snapshot: SessionSnapshot): Promise<StorageWrite> {
    if (!validSessionSnapshot(snapshot)) return Promise.resolve({ kind: 'failed', message: 'invalid_session_snapshot' })
    return this.storage.write('state', this.key, encodeSession(snapshot))
  }
}

export type MetaHydration = Readonly<{ snapshot: EventSequenceSnapshot; source: 'restored' | 'missing' | 'corrupt' | 'unavailable' }>

function validMetaSnapshot(value: unknown): value is EventSequenceSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const sequence = (value as Record<string, unknown>).eventSequenceId
  return typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 0
}

/** Persists the global sequence separately so identity/session failures cannot reset it. */
export class MetaPersistence {
  public constructor(private readonly storage: StoragePort, private readonly key: string) {}

  public async hydrate(): Promise<MetaHydration> {
    const read = await this.storage.read('state', this.key)
    if (read.kind === 'missing') return { snapshot: { eventSequenceId: 0 }, source: 'missing' }
    if (read.kind === 'unavailable') return { snapshot: { eventSequenceId: 0 }, source: 'unavailable' }
    if (read.kind === 'corrupt') return this.corrupt()
    if (read.kind !== 'value') return { snapshot: { eventSequenceId: 0 }, source: 'unavailable' }
    try {
      const parsed: unknown = JSON.parse(read.value)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('meta_corrupt')
      const record = parsed as Record<string, unknown>
      if (record.version !== 1 || record.expiresAt !== null || !validMetaSnapshot(record.value)) throw new Error('meta_corrupt')
      return { snapshot: record.value, source: 'restored' }
    } catch {
      return this.corrupt()
    }
  }

  public persist(snapshot: EventSequenceSnapshot): Promise<StorageWrite> {
    if (!validMetaSnapshot(snapshot)) return Promise.resolve({ kind: 'failed', message: 'invalid_meta_snapshot' })
    return this.storage.write('state', this.key, JSON.stringify({ version: 1, expiresAt: null, value: snapshot }))
  }

  private async corrupt(): Promise<MetaHydration> {
    await this.storage.remove('state', this.key)
    return { snapshot: { eventSequenceId: 0 }, source: 'corrupt' }
  }
}

type PersistedQueue = Readonly<{ version: 1; revision: number; entries: readonly QueueEntry[] }>

export type QueueHydration = 'restored' | 'missing' | 'corrupt' | 'unavailable'

function validRecord(value: unknown): value is PersistedQueue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, unknown>>
  return record.version === 1 && Number.isSafeInteger(record.revision) && typeof record.entries === 'object' && Array.isArray(record.entries)
}

function encodeQueue(revision: number, entries: readonly QueueEntry[]): string {
  return JSON.stringify({ version: 1, revision, entries })
}

/** Serializes queue snapshots and advances revision only after a successful host write. */
export class QueuePersistence {
  private revision = 0
  private writes: Promise<void> = Promise.resolve()

  public constructor(private readonly storage: StoragePort, private readonly key: string) {}

  public async hydrate(queue: EventQueue): Promise<QueueHydration> {
    const read = await this.storage.read('queue', this.key)
    if (read.kind === 'missing') return 'missing'
    if (read.kind === 'unavailable') return 'unavailable'
    if (read.kind === 'corrupt') {
      await this.storage.remove('queue', this.key)
      return 'corrupt'
    }
    if (read.kind !== 'value') return 'unavailable'
    try {
      const parsed: unknown = JSON.parse(read.value)
      if (!validRecord(parsed) || !queue.restore(parsed.entries)) throw new Error('queue_record_corrupt')
      this.revision = parsed.revision
      return 'restored'
    } catch {
      await this.storage.remove('queue', this.key)
      return 'corrupt'
    }
  }

  public persist(queue: EventQueue): Promise<StorageWrite> {
    const entries = queue.snapshot()
    let resolveResult: (result: StorageWrite) => void = () => undefined
    const result = new Promise<StorageWrite>((resolve) => { resolveResult = resolve })
    this.writes = this.writes.then(async () => {
      const nextRevision = this.revision + 1
      const write = await this.storage.write('queue', this.key, encodeQueue(nextRevision, entries))
      if (write.kind === 'ok') this.revision = nextRevision
      resolveResult(write)
    }).catch(() => resolveResult({ kind: 'failed' }))
    return result
  }

  public currentRevision(): number {
    return this.revision
  }
}
