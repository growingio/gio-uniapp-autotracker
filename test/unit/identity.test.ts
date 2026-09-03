import { describe, expect, it } from 'vitest'

import {
  IDENTITY_VALUE_MAX_LENGTH,
  readIdentityRecord,
  serializeIdentityRecord,
  updateIdentity,
} from '../../core/identity.js'

const anonymous = { deviceId: 'visitor-1', userId: null, userKey: null } as const

describe('identity record and mutation semantics', () => {
  it('writes an encrypted v1 envelope and reads it back', () => {
    const serialized = serializeIdentityRecord({ ...anonymous, userId: '张三', userKey: 'email' }, 'source')
    expect(serialized).not.toContain('visitor-1')
    expect(serialized).not.toContain('张三')
    expect(readIdentityRecord(serialized, 'source')).toStrictEqual({
      kind: 'current', identity: { deviceId: 'visitor-1', userId: '张三', userKey: 'email' },
    })
  })

  it('reads a valid plain legacy envelope for one-way migration', () => {
    expect(readIdentityRecord(JSON.stringify({ version: 1, expiresAt: null, value: anonymous }), 'source')).toStrictEqual({
      kind: 'legacy', identity: anonymous,
    })
  })

  it.each([
    'not-json',
    JSON.stringify({ version: 2, expiresAt: null, value: anonymous }),
    JSON.stringify({ version: 1, expiresAt: null, cipher: 'xor-utf8-v0', value: anonymous }),
    JSON.stringify({ version: 1, expiresAt: null, cipher: 'xor-utf8-v1', value: { ...anonymous, deviceId: 'gioenc-v3-invalid=' } }),
  ])('marks malformed or untrusted records as corrupt', (serialized) => {
    expect(readIdentityRecord(serialized, 'source')).toStrictEqual({ kind: 'corrupt' })
  })

  it('uses idMapping as an init-fixed user-key gate and clears identity on an empty user ID', () => {
    expect(updateIdentity(anonymous, 'A', 'email', false)).toStrictEqual({
      ok: true, identity: { ...anonymous, userId: 'A', userKey: null }, userKeyIgnored: true, changed: true,
    })
    const mapped = updateIdentity(anonymous, 'A', 'email', true)
    expect(mapped.identity).toStrictEqual({ ...anonymous, userId: 'A', userKey: 'email' })
    expect(updateIdentity(mapped.identity, '', undefined, true)).toStrictEqual({
      ok: true, identity: anonymous, userKeyIgnored: false, changed: true,
    })
  })

  it('rejects an oversize user id or user key atomically', () => {
    const tooLong = '😀'.repeat(IDENTITY_VALUE_MAX_LENGTH + 1)
    expect(updateIdentity(anonymous, tooLong, null, true)).toMatchObject({ ok: false, identity: anonymous, changed: false })
    expect(updateIdentity(anonymous, 'A', tooLong, true)).toMatchObject({ ok: false, identity: anonymous, changed: false })
  })
})
