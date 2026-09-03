import { describe, expect, it } from 'vitest'

import { dispatchAutoTrack, installAutoTrackDispatcher } from '../../runtime/autotrack-dispatch.js'

describe('dispatchAutoTrack', () => {
  it('is safe without a target and isolates target errors from compiled handlers', () => {
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/x' })).toBe(false)
    installAutoTrackDispatcher({ autoTrack: () => { throw new Error('sdk error') } })
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/x' })).toBe(false)
    installAutoTrackDispatcher({ autoTrack: () => true })
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'change', xpath: '/x' })).toBe(true)
  })

  it('deduplicates only an identical probe from the same native event', () => {
    const calls: string[] = []
    installAutoTrackDispatcher({ autoTrack: (call) => { calls.push(String(call.xpath)); return true } })
    const nativeEvent = {}
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]' }, nativeEvent)).toBe(true)
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]' }, nativeEvent)).toBe(false)
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]/text[1]' }, nativeEvent)).toBe(true)
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]' }, {})).toBe(true)
    expect(calls).toStrictEqual(['/view[1]', '/view[1]/text[1]', '/view[1]'])
  })

  it('snapshots dynamic metadata and values without forwarding the native event', () => {
    let captured: unknown = null
    installAutoTrackDispatcher({ autoTrack: (call) => { captured = call; return true } })
    const nativeEvent = {
      currentTarget: { type: 'text', dataset: { growingTrack: true, title: 'Dynamic title', index: 0, src: '/detail' } },
      detail: { value: false },
    }
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'change', xpath: '/input[1]' }, nativeEvent)).toBe(true)
    expect(captured).toStrictEqual({
      schemaVersion: 1, kind: 'change', xpath: '/input[1]', ignored: false, trackValue: true, sensitive: false,
      textValue: false, index: 0, hyperlink: '/detail',
    })
    expect(dispatchAutoTrack({ schemaVersion: 1, kind: 'click', xpath: '/view[1]' }, { currentTarget: { type: 'password', dataset: {} } })).toBe(true)
    expect(captured).toMatchObject({ kind: 'click', sensitive: true })
  })
})
