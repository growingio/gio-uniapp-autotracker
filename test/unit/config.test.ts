import { describe, expect, it } from 'vitest'

import { normalizeInitOptions } from '../../core/config.js'

const required = { accountId: ' account ', dataSourceId: ' source ' }

describe('normalizeInitOptions', () => {
  it('normalizes every App-owned option once and drops appId', () => {
    expect(
      normalizeInitOptions({
        ...required,
        serverUrl: 'collector.example.com/',
        appId: 'web-only-id',
        appChannel: ' channel ',
        appVersion: ' 2.3.4 ',
        sessionExpires: 0.5,
        dataCollect: false,
        idMapping: true,
        debug: true,
      }),
    ).toStrictEqual({
      ok: true,
      config: {
        accountId: 'account',
        dataSourceId: 'source',
        serverUrl: 'https://collector.example.com',
        appChannel: 'channel',
        appVersionFallback: '2.3.4',
        sessionPolicy: { timeoutMs: 30_000 },
        dataCollect: false,
        idMapping: true,
        debug: true,
      },
    })
  })

  it('uses only documented defaults', () => {
    expect(normalizeInitOptions(required)).toStrictEqual({
      ok: true,
      config: {
        accountId: 'account',
        dataSourceId: 'source',
        serverUrl: 'https://napi.growingio.com',
        appChannel: null,
        appVersionFallback: null,
        sessionPolicy: { timeoutMs: 30_000 },
        dataCollect: true,
        idMapping: false,
        debug: false,
      },
    })
  })

  it.each([
    [{}, 'invalid_account_id'],
    [{ accountId: 'a' }, 'invalid_data_source_id'],
    [{ ...required, serverUrl: 'ftp://collector.example.com' }, 'invalid_server_url'],
    [{ ...required, serverUrl: 'https://collector.example.com/v3/projects/a/collect' }, 'invalid_server_url'],
    [{ ...required, serverUrl: 'https://collector.example.com?unsafe=true' }, 'invalid_server_url'],
    [{ ...required, sessionExpires: 0 }, 'invalid_session_expires'],
    [{ ...required, sessionExpires: Number.NaN }, 'invalid_session_expires'],
    [{ ...required, dataCollect: 'false' }, 'invalid_data_collect'],
    [{ ...required, idMapping: 1 }, 'invalid_id_mapping'],
    [{ ...required, debug: null }, 'invalid_debug'],
  ])('rejects %o with %s and no partial configuration', (options, code) => {
    expect(normalizeInitOptions(options)).toStrictEqual({ ok: false, code })
  })

  it('allows a corrected retry because the normalizer does not preserve failed input', () => {
    expect(normalizeInitOptions({ ...required, serverUrl: 'bad url' })).toStrictEqual({
      ok: false,
      code: 'invalid_server_url',
    })
    expect(normalizeInitOptions({ ...required, serverUrl: 'https://collector.example.com' })).toMatchObject({
      ok: true,
      config: { serverUrl: 'https://collector.example.com' },
    })
  })
})
