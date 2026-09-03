import type { EventSequenceSnapshot } from './event-sequence.js'
import type { StoragePort, StorageWrite } from './ports.js'

export type MetaHydration = Readonly<{ snapshot: EventSequenceSnapshot; source: 'restored' | 'missing' | 'corrupt' | 'unavailable' }>

function validSnapshot(value: unknown): value is EventSequenceSnapshot {
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
      if (record.version !== 1 || record.expiresAt !== null || !validSnapshot(record.value)) throw new Error('meta_corrupt')
      return { snapshot: record.value, source: 'restored' }
    } catch {
      return this.corrupt()
    }
  }

  public persist(snapshot: EventSequenceSnapshot): Promise<StorageWrite> {
    if (!validSnapshot(snapshot)) return Promise.resolve({ kind: 'failed', message: 'invalid_meta_snapshot' })
    return this.storage.write('state', this.key, JSON.stringify({ version: 1, expiresAt: null, value: snapshot }))
  }

  private async corrupt(): Promise<MetaHydration> {
    await this.storage.remove('state', this.key)
    return { snapshot: { eventSequenceId: 0 }, source: 'corrupt' }
  }
}
