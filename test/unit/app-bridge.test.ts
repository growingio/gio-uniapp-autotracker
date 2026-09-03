import { describe, expect, it } from 'vitest'

import { appEntrySnapshot, createAppLifecycleBridge } from '../../runtime/app-bridge.js'

describe('appEntrySnapshot', () => {
  it('preserves an existing query string and turns documented scalar query objects into an encoded snapshot', () => {
    expect(appEntrySnapshot({ path: '/pages/home', query: 'from=push' })).toStrictEqual({ path: '/pages/home', query: 'from=push' })
    expect(appEntrySnapshot({ path: '/pages/home', query: { name: '张 三', active: false, page: 0, nested: { ignored: true } } }))
      .toStrictEqual({ path: '/pages/home', query: 'name=%E5%BC%A0%20%E4%B8%89&active=false&page=0' })
  })

  it('does not retain unknown host objects and delegates all three App hooks', () => {
    const calls: unknown[] = []
    const bridge = createAppLifecycleBridge({
      onAppLaunch: (entry) => { calls.push(['launch', entry]); return true },
      onAppShow: (entry) => { calls.push(['show', entry]); return false },
      onAppHide: () => { calls.push(['hide']); return true },
    })
    expect(bridge.onLaunch({ path: '', query: [] })).toBe(true)
    expect(bridge.onShow(null)).toBe(false)
    expect(bridge.onHide()).toBe(true)
    expect(calls).toStrictEqual([
      ['launch', { path: null, query: null }], ['show', { path: null, query: null }], ['hide'],
    ])
  })
})
