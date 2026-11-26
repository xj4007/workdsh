/** Update manifest parsing and version comparison for the Desktop update prompt. */

export const UPDATE_FEED_URL = 'https://sanyunbuddy.sycjlht.com/desktop/latest.json'

export type UpdateManifest = {
  version: string
  url: string
  notes?: string
  minVersion?: string
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u

type ParsedVersion = { core: [number, number, number], prerelease: string[] }

function parseVersion(value: string): ParsedVersion | undefined {
  if (!VERSION_PATTERN.test(value)) return undefined
  const separator = value.indexOf('-')
  const [major = 0, minor = 0, patch = 0] = (separator === -1 ? value : value.slice(0, separator)).split('.').map(Number)
  const prerelease = separator === -1 ? [] : value.slice(separator + 1).split('.')
  return { core: [major, minor, patch], prerelease }
}

function comparePrerelease(left: string[], right: string[]): number {
  for (let index = 0; ; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return b === undefined ? 0 : -1
    if (b === undefined) return 1
    if (a === b) continue
    const numeric = /^\d+$/u.test(a) && /^\d+$/u.test(b)
    if (numeric) return Number(a) < Number(b) ? -1 : 1
    return a < b ? -1 : 1
  }
}

/** Semver ordering: numeric triple first, then prerelease (a release outranks its prereleases). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) return false
  const [major, minor, patch] = next.core
  const [installedMajor, installedMinor, installedPatch] = installed.core
  if (major !== installedMajor) return major > installedMajor
  if (minor !== installedMinor) return minor > installedMinor
  if (patch !== installedPatch) return patch > installedPatch
  if (next.prerelease.length === 0) return installed.prerelease.length > 0
  if (installed.prerelease.length === 0) return false
  return comparePrerelease(next.prerelease, installed.prerelease) > 0
}

/** Accepts only the fields the update prompt uses; unknown keys such as sha256 are ignored. */
export function parseUpdateManifest(value: unknown): UpdateManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('更新清单无效')
  const record = value as Record<string, unknown>
  const { version, url, notes, minVersion } = record
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) throw new Error('更新清单无效')
  if (typeof url !== 'string') throw new Error('更新清单无效')
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('更新清单无效') }
  if (parsed.protocol !== 'https:') throw new Error('更新清单无效')
  if (notes !== undefined && typeof notes !== 'string') throw new Error('更新清单无效')
  if (minVersion !== undefined && typeof minVersion !== 'string') throw new Error('更新清单无效')
  return {
    version,
    url,
    ...(notes === undefined ? {} : { notes }),
    ...(minVersion === undefined ? {} : { minVersion }),
  }
}
