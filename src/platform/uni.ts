import type { StorageArea, StoragePort, StorageRead, StorageWrite, TransportHandle, TransportPort, TransportRequest, TransportResult } from '../types/index.js'

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

export type AppRequestTask = Readonly<{ abort?: () => void }>
export type AppRequestResponse = Readonly<{ statusCode: number; data?: unknown }>
export type AppRequestFailure = Readonly<{ errMsg?: string }>

export interface AppRequestApi {
  request(options: Readonly<{
    url: string
    method: 'POST'
    header: Readonly<Record<string, string>>
    data: string
    timeout: number
    success: (response: AppRequestResponse) => void
    fail: (failure: AppRequestFailure) => void
    complete: () => void
  }>): AppRequestTask | void
}

/** App-only `uni.request` translation. Batch policy, retries and finalization remain in core. */
export class AppRequestPort implements TransportPort {
  public constructor(private readonly api: AppRequestApi) {}

  public dispatch(request: TransportRequest, done: (result: TransportResult) => void): TransportHandle | void {
    let completed = false
    const finish = (result: TransportResult): void => {
      if (completed) return
      completed = true
      done(result)
    }
    try {
      const task = this.api.request({
        url: request.url,
        method: request.method,
        header: request.headers,
        data: request.body,
        timeout: request.timeoutMs,
        success: (response) => finish({ kind: 'success', status: response.statusCode }),
        fail: (failure) => {
          const message = failure.errMsg
          finish(/timeout/i.test(message ?? '') ? { kind: 'timeout', message } : { kind: 'network', message })
        },
        complete: () => undefined,
      })
      return task?.abort === undefined ? undefined : { abort: () => task.abort?.() }
    } catch (error) {
      finish({ kind: 'network', message: error instanceof Error ? error.message : undefined })
      return undefined
    }
  }
}
