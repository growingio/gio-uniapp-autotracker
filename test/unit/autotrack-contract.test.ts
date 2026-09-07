import { describe, expect, it, vi } from 'vitest'
import { normalizeAutoTrackCall, MAX_RANGE_ITEMS } from '../../runtime/autotrack-normalize.js'

const click = { schemaVersion: 2, source: 'template', kind: 'click', eventName: 'submitOrder', elementType: 'button' } as const
const change = { ...click, kind: 'change', elementType: 'input', trackValue: true } as const

describe('schema v2 normalization', () => {
  it.each([
    [{ currentTarget: { id: 'buy' }, target: { id: 'child' } }, 'buy#submitOrder'],
    [{ currentTarget: {}, target: { id: 'child' } }, '#submitOrder'],
    [{ currentTarget: { id: '' }, target: { id: 'child' } }, '#submitOrder'],
    [{ target: { id: 0 } }, '0#submitOrder'],
    [{ currentTarget: { id: {} } }, '#submitOrder'],
    [{}, '#submitOrder'],
  ])('uses the primary target without a structural fallback', (event, xpath) => {
    expect(normalizeAutoTrackCall(click, event)).toMatchObject({ xpath })
  })
  it.each([null, undefined, {}, { ...click, schemaVersion: 1 }, { ...click, source: 'other' }, { ...click, xpath: '/old' },
    { ...click, eventName: '' }, { ...click, eventName: {} }, { ...click, elementType: 'business-card' },
    { ...change, elementType: 'button' }, { ...click, textValue: {} }, { ...click, index: NaN }, { ...click, index: Infinity }, { ...change, pickerRange: [] },
    { schemaVersion: 2, source: 'tabbar', kind: 'change', xpath: '#onTabItemTap', index: 1 },
    { schemaVersion: 2, source: 'tabbar', kind: 'click', xpath: '#onTabItemTap', index: '1' },
  ])('rejects incompatible or non-JSON probe fields', (probe) => { expect(normalizeAutoTrackCall(probe)).toBeNull() })
  it.each([0, -1, '01', '+1', '1.0', ' 1', '1e2', 1.5, 2147483647])('rejects noncanonical click index %s', (index) => {
    expect(normalizeAutoTrackCall({ ...click, index })).toMatchObject({ index: null })
  })
  it.each([1, '1', 2147483646])('preserves positive click index %s', (index) => {
    expect(normalizeAutoTrackCall({ ...click, index })).toMatchObject({ index: Number(index) })
  })
  it('uses current event metadata ahead of static or dynamic fallback', () => {
    expect(normalizeAutoTrackCall({ ...click, textValue: 'fallback', index: 9, hyperlink: '/old' }, {
      currentTarget: { dataset: { title: 'live', index: '2', src: '/new' } }, target: { dataset: { title: 'child' } },
    })).toStrictEqual({ kind: 'click', xpath: '#submitOrder', textValue: 'live', index: 2, hyperlink: '/new' })
  })
  it.each(['currentTarget', 'target'])('rejects ignore and sensitive markers on %s without reading any change value', (target) => {
    for (const marker of ['growingIgnore', 'growingSensitive']) {
      const read = vi.fn(() => { throw new Error('secret') })
      const event = { [target]: { dataset: { [marker]: true, growingTrack: true } }, get detail() { return read() } }
      expect(normalizeAutoTrackCall(change, event)).toBeNull()
      expect(read).not.toHaveBeenCalled()
    }
  })
  it.each(['password', 'safe-password', 'file'])('ignores the entire %s event even with track enabled', (type) => {
    const read = vi.fn()
    expect(normalizeAutoTrackCall(change, { currentTarget: { type }, get detail() { return read() } })).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
  it('rejects static sensitivity before reading probe metadata and isolates throwing host accessors', () => {
    const read = vi.fn()
    expect(normalizeAutoTrackCall({ ...change, sensitive: true, get textValue() { return read() } })).toBeNull()
    expect(read).not.toHaveBeenCalled()
    expect(normalizeAutoTrackCall(click, { get currentTarget() { throw new Error('host') } })).toBeNull()
  })
  it('does not read unauthorized change data or let false runtime consent fall back to a true template marker', () => {
    const read = vi.fn()
    expect(normalizeAutoTrackCall(change, { currentTarget: { dataset: { growingTrack: false } }, get detail() { return read() } })).toStrictEqual({ kind: 'change', xpath: '#submitOrder', textValue: null })
    expect(read).not.toHaveBeenCalled()
  })
  it.each([
    ['input', { value: 0 }, '0'], ['textarea', { value: '' }, ''], ['radio-group', { value: false }, 'false'],
    ['switch', { value: false }, 'false'], ['switch', { value: true }, 'true'], ['switch', { value: 'false' }, null],
    ['slider', { value: 0 }, '0'], ['slider', { value: '2' }, null], ['slider', { value: Infinity }, null],
    ['checkbox-group', { value: [0, false, 'a'] }, '0||false||a'], ['checkbox-group', { value: [] }, ''],
    ['checkbox-group', { value: [{}] }, null], ['swiper', { current: 0, source: 'touch' }, '0'],
  ])('normalizes %s values by their component contract', (elementType, detail, textValue) => {
    expect(normalizeAutoTrackCall({ ...change, elementType }, { detail })).toStrictEqual({ kind: 'change', xpath: '#submitOrder', textValue })
  })
  it('uses input target fallbacks and preserves zero and false', () => {
    expect(normalizeAutoTrackCall(change, { detail: { value: '' }, target: { value: 'wrong' } })?.textValue).toBe('')
    expect(normalizeAutoTrackCall(change, { target: { value: 0 } })?.textValue).toBe('0')
    expect(normalizeAutoTrackCall(change, { target: { attr: { value: false } } })?.textValue).toBe('false')
  })
  it('maps picker labels, falls back to canonical indices and bounds ranges', () => {
    const probe = { ...change, elementType: 'picker', pickerRange: [{ name: 'zero' }, { name: 'one' }], pickerRangeKey: 'name' }
    expect(normalizeAutoTrackCall(probe, { detail: { value: '0' } })?.textValue).toBe('zero')
    expect(normalizeAutoTrackCall(probe, { detail: { value: 5 } })?.textValue).toBe('5')
    expect(normalizeAutoTrackCall(probe, { detail: { value: '01' } })?.textValue).toBeNull()
    for (const pickerRange of [Array(MAX_RANGE_ITEMS + 1).fill('a'), [[1]], [{ nested: {} }], [new Date()], [{ get name() { throw new Error('host') } }]]) {
      expect(normalizeAutoTrackCall({ ...probe, pickerRange }, { detail: { value: 0 } })).toBeNull()
    }
  })
  it('does not execute range accessors or use inherited dataset metadata', () => {
    const read = vi.fn(() => ['private'])
    const columns: unknown[] = []
    Object.defineProperty(columns, '0', { enumerable: true, get: read })
    expect(normalizeAutoTrackCall({ ...change, elementType: 'picker-view', pickerRange: columns }, { detail: { value: [0] } })).toBeNull()
    expect(read).not.toHaveBeenCalled()

    const dataset = Object.create({ title: 'inherited', index: 9, src: '/inherited' }) as Record<string, unknown>
    expect(normalizeAutoTrackCall(click, { currentTarget: { dataset } })).toStrictEqual({
      kind: 'click', xpath: '#submitOrder', textValue: null, index: null, hyperlink: null,
    })
  })
  it('maps all picker-view columns or falls back to all indices', () => {
    const probe = { ...change, elementType: 'picker-view', pickerRange: [['A', 'B'], ['X', 'Y']] }
    expect(normalizeAutoTrackCall(probe, { detail: { value: [1, 0] } })?.textValue).toBe('B||X')
    expect(normalizeAutoTrackCall(probe, { detail: { value: [1, 8] } })?.textValue).toBe('1||8')
    expect(normalizeAutoTrackCall(probe, { detail: { value: [] } })?.textValue).toBe('')
  })
  it('filters autoplay using only original target consent and permits swiper title fallback', () => {
    const probe = { ...change, elementType: 'swiper', textValue: 'banner' }
    expect(normalizeAutoTrackCall(probe, { currentTarget: { dataset: { growingTrack: true } }, detail: { source: 'autoplay', current: 0 } })).toBeNull()
    expect(normalizeAutoTrackCall(probe, { target: { dataset: { growingTrack: true } }, detail: { source: 'autoplay', current: 0 } })?.textValue).toBe('0')
    expect(normalizeAutoTrackCall({ ...probe, trackValue: false }, { detail: { source: 'touch', current: 0 } })?.textValue).toBe('banner')
    expect(normalizeAutoTrackCall({ ...change, trackValue: false, textValue: 'private' }, {})?.textValue).toBeNull()
  })
  it('keeps eventName internal, trims text and excludes click-only fields from change', () => {
    expect(normalizeAutoTrackCall({ ...change, eventName: 'actions.save', index: 1, hyperlink: '/private' }, { detail: { value: 'a'.repeat(101) } }))
      .toStrictEqual({ kind: 'change', xpath: '#actions.save', textValue: 'a'.repeat(100) })
    expect(normalizeAutoTrackCall({ schemaVersion: 2, source: 'tabbar', kind: 'click', xpath: '#onTabItemTap', index: 1, hyperlink: 'pages/home/index' }))
      .toStrictEqual({ kind: 'click', xpath: '#onTabItemTap', index: 1, textValue: null, hyperlink: 'pages/home/index' })
  })
})
