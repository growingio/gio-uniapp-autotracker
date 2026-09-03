import { describe, expect, it } from 'vitest'

import { PageStore } from '../../core/page-store.js'

describe('PageStore', () => {
  it('freezes onLoad query/referral while each onShow refreshes title and shown time', () => {
    const pages = new PageStore()
    expect(pages.onLoad({ instanceId: 'detail#1', route: 'pages/detail/index', query: 'id=42', referralPage: 'pages/home/index' })).toMatchObject({
      pageKey: 'page-1', query: 'id=42', referralPage: 'pages/home/index', shownAt: null,
    })
    expect(pages.onLoad({ instanceId: 'detail#1', route: 'changed', query: 'id=99', referralPage: null })).toMatchObject({
      route: 'pages/detail/index', query: 'id=42', referralPage: 'pages/home/index',
    })
    expect(pages.onShow('detail#1', 100, '详情')).toMatchObject({ query: 'id=42', title: '详情', shownAt: 100 })
    expect(pages.onShow('detail#1', 200, '详情（已更新）')).toMatchObject({ query: 'id=42', title: '详情（已更新）', shownAt: 200 })
  })

  it('keeps same-route instances distinct and follows the current shown page', () => {
    const pages = new PageStore()
    pages.onLoad({ instanceId: 'detail#1', route: 'pages/detail/index', query: 'id=1', referralPage: null })
    pages.onLoad({ instanceId: 'detail#2', route: 'pages/detail/index', query: 'id=2', referralPage: 'pages/detail/index' })
    pages.onShow('detail#1', 1, null)
    expect(pages.onShow('detail#2', 2, null)).toMatchObject({ pageKey: 'page-2', query: 'id=2' })
    expect(pages.current()).toMatchObject({ pageKey: 'page-2', route: 'pages/detail/index' })
  })

  it('does not retain lifecycle instances after unload or accept an unbound show', () => {
    const pages = new PageStore()
    expect(pages.onShow('missing', 1, null)).toBeNull()
    pages.onLoad({ instanceId: 'home#1', route: 'pages/home/index', query: '', referralPage: null })
    pages.onShow('home#1', 1, null)
    pages.onUnload('home#1')
    expect(pages.current()).toBeNull()
  })
})
