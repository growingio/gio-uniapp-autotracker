import type { AppPlatform } from '../core/ports.js'

export type AppCapabilityProfile = Readonly<{
  platform: AppPlatform
  appLifecycle: boolean
  pageLifecycle: boolean
  autoClick: boolean
  changeInput: boolean
  changePicker: boolean
  tabBar: boolean
  appClosedBestEffort: boolean
}>

/**
 * Static tests prove code shape only. Every App capability remains false until its platform,
 * compiler version, device request and collector result have been recorded in the evidence pack.
 */
const unverified = (platform: AppPlatform): AppCapabilityProfile => ({
  platform,
  appLifecycle: false,
  pageLifecycle: false,
  autoClick: false,
  changeInput: false,
  changePicker: false,
  tabBar: false,
  appClosedBestEffort: false,
})

const profiles: Readonly<Record<AppPlatform, AppCapabilityProfile>> = {
  Android: unverified('Android'),
  iOS: unverified('iOS'),
  HarmonyOS: unverified('HarmonyOS'),
}

export function appCapabilityProfile(platform: unknown): AppCapabilityProfile | null {
  return typeof platform === 'string' && platform in profiles ? profiles[platform as AppPlatform] : null
}

export function allAppCapabilityProfiles(): readonly AppCapabilityProfile[] {
  return Object.values(profiles)
}
