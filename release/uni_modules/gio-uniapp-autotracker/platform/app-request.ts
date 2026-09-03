import type { TransportHandle, TransportPort, TransportRequest, TransportResult } from '../core/ports.js'

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
