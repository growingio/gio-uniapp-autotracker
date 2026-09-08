import semver from 'semver'

export function releasePolicy(version: string, gitTag = `v${version}`): { version: string; tag: 'latest' | 'next'; prerelease: boolean } {
  if (semver.valid(version) !== version || version.includes('+') || gitTag !== `v${version}`) throw new Error('release_version_tag_mismatch')
  const prerelease = semver.prerelease(version) !== null
  return { version, tag: prerelease ? 'next' : 'latest', prerelease }
}
