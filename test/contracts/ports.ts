/**
 * 阶段 0 只定义跨层边界。具体 core 与 `uni.*` 适配器分别在阶段 1、2 实现。
 */
export type AppPlatform = 'Android' | 'iOS' | 'HarmonyOS'

export type AppSystemContext = Readonly<{
  platform: AppPlatform
  platformVersion: string
  domain: string
  appState: 'FOREGROUND' | 'BACKGROUND'
  appName: string
  networkState: '2G' | '3G' | '4G' | '5G' | 'WIFI' | 'UNKNOWN'
  screenWidth: number
  screenHeight: number
  deviceBrand: string
  deviceModel: string
  deviceType: 'PHONE' | 'PAD' | 'FOLD' | 'UNKNOWN'
  appVersion: string
  language: string
  sdkVersion: string
}>

/** Loads only stable App context. Per-event timezone belongs to TimezonePort. */
export interface SystemContextPort {
  load(): Promise<AppSystemContext>
}

/** Event timestamps are current device Unix milliseconds and are never monotonicized. */
export interface ClockPort {
  now(): number
}

/** Timezone changes affect only events created after the change. */
export interface TimezonePort {
  getOffsetMinutes(): number
}
