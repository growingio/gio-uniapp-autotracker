import type { StoragePort, StorageWrite } from './ports.js'
import { EventQueue, type QueueEntry } from './queue.js'

type PersistedQueue = Readonly<{ version: 1; revision: number; entries: readonly QueueEntry[] }>

export type QueueHydration = 'restored' | 'missing' | 'corrupt' | 'unavailable'

function validRecord(value: unknown): value is PersistedQueue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Readonly<Record<string, unknown>>
  return record.version === 1 && Number.isSafeInteger(record.revision) && typeof record.entries === 'object' && Array.isArray(record.entries)
}

function encode(revision: number, entries: readonly QueueEntry[]): string {
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
      const write = await this.storage.write('queue', this.key, encode(nextRevision, entries))
      if (write.kind === 'ok') this.revision = nextRevision
      resolveResult(write)
    }).catch(() => resolveResult({ kind: 'failed' }))
    return result
  }

  public currentRevision(): number {
    return this.revision
  }
}
