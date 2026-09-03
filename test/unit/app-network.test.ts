import { describe, expect, it } from 'vitest'

import { AppNetworkPort, normalizeAppNetworkState } from '../../platform/app-network.js'

describe('AppNetworkPort', () => {
  it('normalizes only documented generations and keeps offline, cellular and failures UNKNOWN', () => {
    expect(normalizeAppNetworkState('wifi')).toBe('WIFI')
    expect(normalizeAppNetworkState('5g')).toBe('5G')
    expect(normalizeAppNetworkState('cellular')).toBe('UNKNOWN')
    expect(normalizeAppNetworkState('wifi', false)).toBe('UNKNOWN')
  })

  it('uses UNKNOWN for host failure and forwards later subscription changes', async () => {
    const host = { listener: null as ((result: Readonly<{ networkType?: unknown; isConnected?: unknown }>) => void) | null }
    const port = new AppNetworkPort({
      getNetworkType: (options) => { options.fail() },
      onNetworkStatusChange: (next) => { host.listener = next },
      offNetworkStatusChange: (next) => { if (host.listener === next) host.listener = null },
    })
    await expect(port.current()).resolves.toBe('UNKNOWN')
    const received: string[] = []
    const stop = port.subscribe((state) => received.push(state))
    host.listener?.({ networkType: '4g', isConnected: true })
    host.listener?.({ networkType: 'wifi', isConnected: false })
    stop()
    expect(received).toStrictEqual(['4G', 'UNKNOWN'])
    expect(host.listener).toBeNull()
  })
})
