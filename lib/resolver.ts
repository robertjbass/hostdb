/**
 * Version resolution for the hostdb npm package.
 *
 * Consumers (spindb, layerbase-cloud, third parties) call these functions
 * to translate user-supplied version strings (e.g., '17', '11.4', '8.0.23')
 * into the full pinned version that's actually built and published on R2.
 *
 * Resolution algorithm:
 *   1. Identity — if the input is already a known full version, return it.
 *      Deprecated patches still match here; only `enabled: false` excludes a
 *      version from resolution entirely. The deprecated-but-resolvable case
 *      is intentional: existing containers keep working when a version is
 *      deprecation-flagged but not removed.
 *   2. Defaults — if the input matches a key in the engine's `defaults` block,
 *      return the explicit policy choice. Preserves LTS-vs-latest decisions
 *      that previously lived only as comments in spindb's hand-written MAPs.
 *   3. Major.minor prefix — pick the highest full version (including deprecated)
 *      that starts with the input prefix.
 *   4. Major prefix — same, but only when no `defaults['X']` is declared.
 *   5. Otherwise null.
 *
 * "Enabled" vs "deprecated":
 *   - `enabled: false`  → version is INVISIBLE to the resolver (skipped entirely).
 *   - `deprecated: true` → version is still resolvable (so containers don't break)
 *                          but flagged for UI consumers via `isVersionDeprecated`.
 *   These flags are independent. UI layers like spindb's version picker use
 *   `getDeprecatedVersions()` to hide deprecated entries from create flows.
 */

import {
  loadDatabasesJson,
  loadReleasesJson,
  _resetLoaderCachesForTests,
  isVersionDeprecated as _isVersionDeprecated,
  isVersionEnabled,
  getVersionPlatforms,
  getVersionCliTools,
  type DatabaseEntry,
  type CliTools,
  type Platform,
} from './databases.js'

// The loader functions cache their parsed result, so calling them on every
// resolver invocation is O(1) after the first read. No second-layer cache needed.

const databases = loadDatabasesJson
const releases = loadReleasesJson

/**
 * Reset the in-process loader cache. Tests only — not part of the public API.
 * Re-exported here so test files don't need to import from two places.
 */
export const _resetCacheForTests = _resetLoaderCachesForTests

// ─── Version comparison ─────────────────────────────────────────────────────

/**
 * Compare two version strings. Handles:
 *   - standard semver (X.Y.Z)
 *   - 4-part ClickHouse-style (25.12.3.21)
 *   - PostgreSQL-DocumentDB compound format (17-0.107.0)
 *
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  // Compound format like '17-0.107.0' splits on '-' first.
  const [aBase, aSuffix = ''] = a.split('-', 2)
  const [bBase, bSuffix = ''] = b.split('-', 2)

  const aParts = aBase.split('.').map((n) => parseInt(n, 10) || 0)
  const bParts = bBase.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const ai = aParts[i] ?? 0
    const bi = bParts[i] ?? 0
    if (ai !== bi) return ai - bi
  }

  // Bases equal — compare suffix recursively (treats no-suffix as smaller)
  if (!aSuffix && !bSuffix) return 0
  if (!aSuffix) return -1
  if (!bSuffix) return 1
  return compareVersions(aSuffix, bSuffix)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getEntry(engine: string): DatabaseEntry | null {
  return databases().databases[engine] ?? null
}

/**
 * Return the engine's full-version list, filtered by the `enabled` flag.
 * Deprecated versions stay in the list — see resolver-level docstring.
 */
function getAvailableFullVersions(engine: string): string[] {
  const entry = getEntry(engine)
  if (!entry) return []
  return Object.keys(entry.versions ?? {}).filter((v) =>
    isVersionEnabled(entry.versions[v]),
  )
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type ListVersionsOptions = {
  format?: 'full' | 'major' | 'major-minor'
}

/**
 * List every engine known to the bundled registry.
 */
export function listEngines(): string[] {
  return Object.keys(databases().databases).sort()
}

/**
 * Get the raw database entry from the bundled databases.json.
 */
export function getDatabaseEntry(engine: string): DatabaseEntry | null {
  return getEntry(engine)
}

/**
 * Resolve a user-supplied version string to a full pinned version.
 *
 * Returns null when no known version matches the input.
 *
 * Examples:
 *   resolveVersion('postgresql', '17')      → '17.10.0'
 *   resolveVersion('mariadb',    '11')      → '11.8.6'   (from defaults)
 *   resolveVersion('mongodb',    '8')       → '8.0.23'   (LTS, from defaults)
 *   resolveVersion('mysql',      '9')       → '9.6.0'    (no defaults; prefix match)
 *   resolveVersion('sqlite',     '3.53.1')  → '3.53.1'   (identity)
 *   resolveVersion('postgresql', '99')      → null
 */
export function resolveVersion(engine: string, version: string): string | null {
  const entry = getEntry(engine)
  if (!entry) return null

  const versions = getAvailableFullVersions(engine)
  if (versions.length === 0) return null

  // 1. Identity — already a known full version
  if (versions.includes(version)) return version

  // 2. Defaults — explicit policy
  const defaults = entry.defaults ?? {}
  if (defaults[version]) {
    const target = defaults[version]
    // Accept only if the target is actually a known version
    return versions.includes(target) ? target : null
  }

  // 3. Prefix match — for any input length, pick the highest non-deprecated
  //    full version that starts with `<input>.`
  //
  // Skip the major-only case (1-part) when an explicit `defaults` entry exists
  // for a different major: e.g., MongoDB '8' is governed by defaults block;
  // don't fall through to "highest version starting with '8.'" which would
  // pick 8.2.9 instead of the intended 8.0.23 LTS.
  const isOnePart = !version.includes('.')
  if (isOnePart && defaults[version]) {
    // already handled above; this case shouldn't fall through
    return null
  }

  const matches = versions
    .filter((v) => v.startsWith(version + '.'))
    .sort((a, b) => compareVersions(b, a))
  return matches[0] ?? null
}

/**
 * Like resolveVersion, but returns the input unchanged when nothing matches.
 * Mirrors spindb's per-engine `normalizeVersion` behavior so the wrapper layer
 * can be a drop-in replacement.
 */
export function normalizeVersion(engine: string, version: string): string {
  return resolveVersion(engine, version) ?? version
}

/**
 * List versions for an engine in the requested format.
 *
 * - 'full' (default): every full version, sorted descending.
 * - 'major-minor': every unique X.Y prefix among full versions, sorted descending.
 * - 'major': every unique X prefix, sorted descending.
 */
export function listVersions(
  engine: string,
  opts: ListVersionsOptions = {},
): string[] {
  const versions = getAvailableFullVersions(engine)
  if (versions.length === 0) return []

  const sorted = [...versions].sort((a, b) => compareVersions(b, a))
  const format = opts.format ?? 'full'

  if (format === 'full') return sorted

  if (format === 'major-minor') {
    const seen = new Set<string>()
    const out: string[] = []
    for (const v of sorted) {
      const parts = v.split('-')[0].split('.')
      const key = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0]
      if (!seen.has(key)) {
        seen.add(key)
        out.push(key)
      }
    }
    return out
  }

  // 'major'
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of sorted) {
    const major = v.split('-')[0].split('.')[0]
    if (!seen.has(major)) {
      seen.add(major)
      out.push(major)
    }
  }
  return out
}

/**
 * The set of supported major versions (1-part keys) for an engine.
 *
 * Prefers the engine's `defaults` block (since it represents an explicit policy);
 * falls back to inferring from the version list if no defaults declared.
 *
 * Matches spindb's existing `SUPPORTED_MAJOR_VERSIONS` shape exactly.
 */
export function getSupportedMajorVersions(engine: string): string[] {
  const entry = getEntry(engine)
  if (!entry) return []
  const defaults = entry.defaults ?? {}
  if (Object.keys(defaults).length > 0) {
    return Object.keys(defaults).sort((a, b) => compareVersions(b, a))
  }
  return listVersions(engine, { format: 'major' })
}

/**
 * Get the explicit major-version default for an engine, or null when none declared.
 *
 * Useful when callers want to know whether `'8'` resolves via policy (LTS pick)
 * or via prefix-match fallback.
 */
export function getMajorDefault(engine: string, major: string): string | null {
  const entry = getEntry(engine)
  return entry?.defaults?.[major] ?? null
}

/**
 * Convenience defaults: the engine's overall `defaultVersion` (typically the
 * highest declared major's resolved value) and `latestVersion` (the highest
 * non-deprecated full version).
 *
 * For multi-track engines like MongoDB the two can differ:
 *   - MongoDB defaultVersion = '8.0.23' (LTS pick from defaults['8'])
 *   - MongoDB latestVersion  = '8.2.9'  (highest full version)
 */
export function getEngineDefaults(engine: string): {
  defaultVersion: string | null
  latestVersion: string | null
} {
  const versions = getAvailableFullVersions(engine)
  if (versions.length === 0)
    return { defaultVersion: null, latestVersion: null }

  const sortedDesc = [...versions].sort((a, b) => compareVersions(b, a))
  const latestVersion = sortedDesc[0]

  const majors = getSupportedMajorVersions(engine)
  const highestMajor = majors[0]
  const defaultVersion = highestMajor
    ? (resolveVersion(engine, highestMajor) ?? latestVersion)
    : latestVersion

  return { defaultVersion, latestVersion }
}

/**
 * Check whether a specific version is marked deprecated in the registry.
 */
export function isVersionDeprecated(engine: string, version: string): boolean {
  const entry = getEntry(engine)
  if (!entry) return false
  const ve = entry.versions[version]
  if (ve === undefined) return false
  return _isVersionDeprecated(ve)
}

/**
 * Get the cliTools metadata for a specific version (resolves engine vs. version-level overrides).
 */
export function getCliTools(engine: string, version: string): CliTools | null {
  const entry = getEntry(engine)
  if (!entry) return null
  if (entry.versions[version] === undefined) return null
  return getVersionCliTools(entry, version)
}

/**
 * Get the platforms supported for a specific version.
 */
export function getAvailablePlatforms(
  engine: string,
  version: string,
): Platform[] {
  const entry = getEntry(engine)
  if (!entry) return []
  if (entry.versions[version] === undefined) return []
  return getVersionPlatforms(entry, version)
}

/**
 * Get the download metadata for a specific published-asset version + platform.
 *
 * Returns null when the version isn't published (yet), the platform isn't built
 * for that version, or the engine doesn't exist.
 *
 * Note: `sha256` here is the SHA-256 of the published artifact on R2 (computed
 * by the build pipeline). The build-time *source-tarball* checksum (which is
 * SHA3-256 for SQLite specifically) lives in `sources.json` and is not exposed
 * by this resolver.
 */
export function getReleaseInfo(
  engine: string,
  version: string,
  platform: Platform,
): {
  url: string
  sha256: string
  size: number
} | null {
  const releaseDb = releases().databases[engine]
  if (!releaseDb) return null
  const versionRel = releaseDb[version]
  if (!versionRel) return null
  const asset = versionRel.platforms?.[platform]
  if (!asset) return null
  return {
    url: asset.url,
    sha256: asset.sha256,
    size: asset.size,
  }
}

// Re-exports for type consumers
export type { DatabaseEntry, CliTools, Platform } from './databases.js'
