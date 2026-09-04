import { readIdentityRecord, serializeIdentityRecord, type Identity } from './identity.js'
import type { StoragePort, StorageWrite } from './ports.js'

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
