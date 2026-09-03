import { describe, expect, it } from 'vitest'

import { normalizeAutoTrackCall } from '../../autotrack/contract.js'

describe('normalizeAutoTrackCall', () => {
  it('accepts a JSON-only click contract and preserves zero index', () => {
    expect(normalizeAutoTrackCall({ schemaVersion: 1, kind: 'click', xpath: '/view[1]', textValue: 'Buy', index: 0, hyperlink: '/buy' }))
      .toStrictEqual({
        kind: 'click', xpath: '/view[1]', textValue: 'Buy', index: 0, hyperlink: '/buy',
        ignored: false, trackValue: false, sensitive: false,
      })
  })

  it('rejects unsupported call kinds and unsafe xpath/index values', () => {
    expect(normalizeAutoTrackCall({ schemaVersion: 1, kind: 'click', xpath: '' })).toBeNull()
    expect(normalizeAutoTrackCall({ schemaVersion: 1, kind: 'other' as 'click', xpath: '/x' })).toBeNull()
    expect(normalizeAutoTrackCall({ schemaVersion: 1, kind: 'change', xpath: '/x', index: 1.5 })).toMatchObject({ index: null })
    expect(normalizeAutoTrackCall({ schemaVersion: 2 as 1, kind: 'click', xpath: '/x' })).toBeNull()
  })

  it('normalizes supported component values without preserving control characters or excess length', () => {
    expect(normalizeAutoTrackCall({ schemaVersion: 1, kind: 'change', xpath: '/input[1]', textValue: [0, false, 'x\n'] })?.textValue).toBe('0||false||x')
    expect(normalizeAutoTrackCall({ schemaVersion: 1, kind: 'change', xpath: '/input[1]', textValue: 'a'.repeat(101) })?.textValue).toHaveLength(100)
  })
})
