import { createGioTracker } from '../index.js'
import { createAppLifecycleBridge } from '../runtime/app-bridge.js'

function generatedId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Demo intentionally starts with collection disabled. To perform a real-device check, set a real
 * account/data source and a device-reachable collector URL, then explicitly enable dataCollect.
 */
export const gio = createGioTracker(uni, {
  sdkVersion: '0.1.0',
  deviceIdFactory: () => generatedId('device'),
  sessionIdFactory: () => generatedId('session'),
})

gio.init({
  accountId: 'demo-account',
  dataSourceId: 'demo-source',
  dataCollect: false,
})

export const appLifecycle = createAppLifecycleBridge(gio)
