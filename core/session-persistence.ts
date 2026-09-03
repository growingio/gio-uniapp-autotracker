import type { StoragePort, StorageWrite } from './ports.js'
import type { SessionSnapshot } from './session.js'

export type SessionHydration = Readonly<{ snapshot: SessionSnapshot | null; source: 'restored' | 'missing' | 'corrupt' | 'unavailable' }>

function validSnapshot(value: unknown): value is SessionSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, unknown>>
  return typeof record.sessionId === 'string' && record.sessionId.length > 0
    && (record.lastCloseTime === null || (typeof record.lastCloseTime === 'number' && Number.isFinite(record.lastCloseTime) && record.lastCloseTime >= 0))
}

function encode(snapshot: SessionSnapshot): string {
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
      if (envelope.version !== 1 || envelope.expiresAt !== null || !validSnapshot(envelope.value)) throw new Error('session_record_corrupt')
      return { snapshot: envelope.value, source: 'restored' }
    } catch {
      await this.storage.remove('state', this.key)
      return { snapshot: null, source: 'corrupt' }
    }
  }

  public persist(snapshot: SessionSnapshot): Promise<StorageWrite> {
    if (!validSnapshot(snapshot)) return Promise.resolve({ kind: 'failed', message: 'invalid_session_snapshot' })
    return this.storage.write('state', this.key, encode(snapshot))
  }
}
