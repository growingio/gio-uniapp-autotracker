import { describe, expect, it } from 'vitest'

import { allAppCapabilityProfiles, appCapabilityProfile } from '../../platform/capabilities.js'

describe('App capability profiles', () => {
  it('keeps every unverified App feature disabled until device evidence is recorded', () => {
    expect(allAppCapabilityProfiles()).toHaveLength(3)
    expect(appCapabilityProfile('HarmonyOS')).toStrictEqual({
      platform: 'HarmonyOS', appLifecycle: false, pageLifecycle: false, autoClick: false,
      changeInput: false, changePicker: false, tabBar: false, appClosedBestEffort: false,
    })
  })

  it('does not invent a profile for unsupported platforms', () => {
    expect(appCapabilityProfile('web')).toBeNull()
  })
})
