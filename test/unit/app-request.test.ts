import { describe, expect, it } from 'vitest'

import { AppRequestPort, type AppRequestApi } from '../../platform/app-request.js'
import type { TransportRequest, TransportResult } from '../../core/ports.js'

const request: TransportRequest = { url: 'https://collector.example', method: 'POST', headers: { Accept: 'application/json' }, body: '[]', timeoutMs: 5_000 }

describe('AppRequestPort', () => {
  it('passes the fixed request shape through and preserves status for core classification', () => {
    let received: Parameters<AppRequestApi['request']>[0] | undefined
    const port = new AppRequestPort({ request: (options) => { received = options; options.success({ statusCode: 500, data: 'failure' }); return { abort: () => undefined } } })
    const results: TransportResult[] = []
    const handle = port.dispatch(request, (result) => results.push(result))
    expect(received).toMatchObject({ url: request.url, method: 'POST', header: request.headers, data: '[]', timeout: 5_000 })
    expect(results).toStrictEqual([{ kind: 'success', status: 500 }])
    expect(typeof handle?.abort).toBe('function')
  })

  it('normalizes failure callbacks and ignores duplicate host callbacks', () => {
    let options: Parameters<AppRequestApi['request']>[0] | undefined
    const port = new AppRequestPort({ request: (next) => { options = next } })
    const results: TransportResult[] = []
    port.dispatch(request, (result) => results.push(result))
    options?.fail({ errMsg: 'request:fail timeout' })
    options?.success({ statusCode: 200 })
    expect(results).toStrictEqual([{ kind: 'timeout', message: 'request:fail timeout' }])
  })

  it('returns network for a synchronous host throw and allows a host without abort', () => {
    const results: TransportResult[] = []
    const port = new AppRequestPort({ request: () => { throw new Error('offline') } })
    expect(port.dispatch(request, (result) => results.push(result))).toBeUndefined()
    expect(results).toStrictEqual([{ kind: 'network', message: 'offline' }])
  })
})
