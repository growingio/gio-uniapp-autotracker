import { describe, expect, it } from 'vitest'

import { createGioVueRuntime } from '../../runtime/vue-runtime.js'
import { TrackerRuntime } from '../../runtime/tracker.js'

describe('createGioVueRuntime', () => {
  it('installs the supplied runtime as the Options API $gio property without constructing another tracker', () => {
    const tracker = {} as TrackerRuntime
    const properties: Record<string, unknown> = {}
    createGioVueRuntime(tracker).install({ config: { globalProperties: properties } })
    expect(properties.$gio).toBe(tracker)
  })

  it('is safe for a malformed lightweight app object', () => {
    expect(() => createGioVueRuntime({} as TrackerRuntime).install({})).not.toThrow()
  })
})
