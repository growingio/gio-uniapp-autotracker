import type { StorageArea, StoragePort, StorageRead, StorageWrite } from '../core/ports.js'

/** Minimal synchronous uni storage surface, injected so platform code remains testable. */
export interface AppStorageApi {
  getStorageSync(key: string): unknown
  setStorageSync(key: string, value: string): void
  removeStorageSync(key: string): void
}

function writeFailure(error: unknown): StorageWrite {
  const message = error instanceof Error ? error.message : undefined
  return message !== undefined && /(quota|full|space)/i.test(message)
    ? { kind: 'quota', message }
    : { kind: 'failed', message }
}

/** App-only adapter: it translates synchronous host calls, but never interprets SDK records. */
export class AppStoragePort implements StoragePort {
  public readonly persistentQueue = true

  public constructor(private readonly api: AppStorageApi) {}

  public async read(_area: StorageArea, key: string): Promise<StorageRead> {
    try {
      const value = this.api.getStorageSync(key)
      if (value === undefined || value === null || value === '') return { kind: 'missing' }
      return typeof value === 'string' ? { kind: 'value', value } : { kind: 'corrupt', message: 'storage_value_not_string' }
    } catch (error) {
      return { kind: 'unavailable', message: error instanceof Error ? error.message : undefined }
    }
  }

  public async write(_area: StorageArea, key: string, value: string): Promise<StorageWrite> {
    try {
      this.api.setStorageSync(key, value)
      return { kind: 'ok' }
    } catch (error) {
      return writeFailure(error)
    }
  }

  public async remove(_area: StorageArea, key: string): Promise<StorageWrite> {
    try {
      this.api.removeStorageSync(key)
      return { kind: 'ok' }
    } catch (error) {
      return writeFailure(error)
    }
  }
}
