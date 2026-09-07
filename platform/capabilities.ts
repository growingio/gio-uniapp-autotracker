import { CHANGE_ELEMENTS, type ChangeElement } from '../autotrack/contract.js'
import type { AppPlatform } from '../core/ports.js'

export type AppCapabilityProfile = Readonly<{
  platform: AppPlatform
  appLifecycle: boolean
  pageLifecycle: boolean
  autoClick: boolean
  autoChange: Readonly<Record<ChangeElement, boolean>>
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
  autoChange: Object.fromEntries(CHANGE_ELEMENTS.map((element) => [element, false])) as Record<ChangeElement, boolean>,
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

export function appCapabilityProfile(platform: unknown, verificationBuild = false): AppCapabilityProfile | null {
  const profile = typeof platform === 'string' && Object.prototype.hasOwnProperty.call(profiles, platform) ? profiles[platform as AppPlatform] : null
  if (profile === null || !verificationBuild) return profile
  // demo 的显式验证构建只开放采集链路，不回写已验收能力表。
  return {
    ...profile, autoClick: true, tabBar: true, changeInput: true, changePicker: true,
    autoChange: Object.fromEntries(CHANGE_ELEMENTS.map((element) => [element, true])) as Record<ChangeElement, boolean>,
  }
}

export function allAppCapabilityProfiles(): readonly AppCapabilityProfile[] {
  return Object.values(profiles)
}
