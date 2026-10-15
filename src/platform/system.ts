import type { AppPlatform, AppSystemContext, SystemContextPort } from '../types/index.js'

export interface AppSystemApi {
  getDeviceInfo(): unknown
  getSystemInfoSync(): unknown
  getAppBaseInfo(): unknown
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}
}

function safeRecord(read: () => unknown): Readonly<Record<string, unknown>> {
  try {
    return record(read())
  } catch {
    return {}
  }
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

/** 传统 App 的部分基座不返回包名，此时通过 Native.js 读取实际安装包标识。 */
function nativeDomain(target: AppPlatform): string {
  try {
    const plus = record((globalThis as Record<string, unknown>).plus)
    const native = record(plus[target === 'iOS' ? 'ios' : 'android'])
    const invoke = native.invoke
    if (typeof invoke !== 'function') return ''
    if (target === 'Android' && typeof native.runtimeMainActivity === 'function') {
      return text(invoke.call(native, native.runtimeMainActivity.call(native), 'getPackageName'))
    }
    if (target === 'iOS') {
      const bundle = invoke.call(native, 'NSBundle', 'mainBundle')
      try { return text(invoke.call(native, bundle, 'bundleIdentifier')) }
      finally { if (typeof native.deleteObject === 'function') native.deleteObject.call(native, bundle) }
    }
  } catch { /* 宿主能力不可用时省略包名，不用 DCloud appid 冒充。 */ }
  return ''
}

function platform(value: unknown): AppPlatform | null {
  const normalized = text(value).toLowerCase()
  if (normalized === 'android') return 'Android'
  if (normalized === 'ios') return 'iOS'
  if (normalized === 'harmony' || normalized === 'harmonyos') return 'HarmonyOS'
  return null
}

function dimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function pixelRatio(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function language(value: unknown): string {
  const source = text(value)
  if (source === '') return 'und'
  const parts = source.replace(/_/g, '-').split('-')
  const base = parts[0]?.toLowerCase()
  if (base === undefined || !/^[a-z]{2,3}$/.test(base)) return 'und'
  return [base, ...parts.slice(1).map((part) => part.length === 4 ? `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}` : part.toUpperCase())].join('-')
}

function deviceType(value: unknown): AppSystemContext['deviceType'] {
  const normalized = text(value).toUpperCase()
  return normalized === 'PHONE' || normalized === 'PAD' || normalized === 'FOLD' ? normalized : 'UNKNOWN'
}

/** Android classifies tablet layouts at a 600dp shortest edge. */
function androidDeviceType(screenWidth: number): AppSystemContext['deviceType'] {
  return screenWidth > 0 ? (screenWidth >= 600 ? 'PAD' : 'PHONE') : 'UNKNOWN'
}

/** Converts standard uni system reads to protocol-ready App context without exposing raw host objects. */
export class AppSystemContextPort implements SystemContextPort {
  public constructor(private readonly api: AppSystemApi, private readonly sdkVersion: string, private readonly appVersionFallback: string | null) {}

  public async load(): Promise<AppSystemContext> {
    const device = safeRecord(() => this.api.getDeviceInfo())
    const system = safeRecord(() => this.api.getSystemInfoSync())
    const app = safeRecord(() => this.api.getAppBaseInfo())
    const targetPlatform = platform(device.platform ?? system.platform)
    if (targetPlatform === null) throw new Error('unsupported_platform')
    const width = dimension(device.screenWidth) ?? dimension(system.screenWidth) ?? 0
    const height = dimension(device.screenHeight) ?? dimension(system.screenHeight) ?? 0
    const ratio = pixelRatio(device.devicePixelRatio) ?? pixelRatio(system.devicePixelRatio) ?? pixelRatio(system.pixelRatio) ?? 1
    const physicalWidth = Math.round(width * ratio)
    const physicalHeight = Math.round(height * ratio)
    const domain = (targetPlatform === 'iOS' ? text(app.bundleId) : targetPlatform === 'Android' ? text(app.packageName) : text(app.bundleName ?? app.packageName)) || text(app.hostPackageName ?? system.hostPackageName) || nativeDomain(targetPlatform)
    return {
      platform: targetPlatform,
      platformVersion: text(device.osVersion, text(system.osVersion, text(device.platformVersion, text(system.system).replace(/^(?:iOS|Android|HarmonyOS)\s*/i, '') || 'UNKNOWN'))),
      domain,
      appState: 'FOREGROUND',
      appName: text(app.appName),
      networkState: 'UNKNOWN',
      screenWidth: width === 0 || height === 0 ? 0 : Math.min(physicalWidth, physicalHeight),
      screenHeight: width === 0 || height === 0 ? 0 : Math.max(physicalWidth, physicalHeight),
      deviceBrand: text(device.deviceBrand ?? device.brand ?? system.deviceBrand ?? system.brand, 'UNKNOWN'),
      deviceModel: text(device.deviceModel ?? device.model ?? system.deviceModel ?? system.model, 'UNKNOWN'),
      deviceType: targetPlatform === 'Android' ? androidDeviceType(Math.min(width, height)) : deviceType(device.deviceType),
      appVersion: text(app.appVersion, text(system.appVersion, this.appVersionFallback ?? '')),
      language: language(app.appLanguage ?? app.language),
      sdkVersion: this.sdkVersion,
    }
  }
}
