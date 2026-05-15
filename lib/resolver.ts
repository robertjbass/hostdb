/**
 * Version resolution for the hostdb npm package.
 *
 * Consumers (spindb, layerbase-cloud, third parties) call these functions
 * to translate user-supplied version strings (e.g., '17', '11.4', '8.0.23')
 * into the full pinned version that's actually built and published on R2.
 *
 * Resolution algorithm:
 *   1. Identity — if the input is already a known full version, return it.
 *   2. Defaults — if the input matches a key in the engine's `defaults` block,
 *      return the explicit policy choice. This preserves LTS-vs-latest decisions
 *      that previously lived only as comments in spindb's hand-written MAPs.
 *   3. Major.minor prefix — pick the highest non-deprecated full version that
 *      starts with the input prefix.
 *   4. Major prefix — same, but only when no `defaults['X']` is declared.
 *   5. Otherwise null.
 */

import {
  loadDatabasesJson,
  loadReleasesJson,
  isVersionDeprecated as _isVersionDeprecated,
  isVersionEnabled,
  getVersionPlatforms,
  getVersionCliTools,
  type DatabaseEntry,
  type CliTools,
  type Platform,
  type DatabasesJson,
  type ReleasesJson,
} from './databases.js'

// ─── Loaded data (cached on first call) ──────────────────────────────────────

let _databasesCache: DatabasesJson | null = null
let _releasesCache: ReleasesJson | null = null

function databases(): DatabasesJson {
  if (_databasesCache === null) _databasesCache = loadDatabasesJson()
  return _databasesCache
}

function releases(): ReleasesJson {
  if (_releasesCache === null) _releasesCache = loadReleasesJson()
  return _releasesCache
}

/** Reset the in-process cache. Useful for tests. Not part of the public API. */
export function _resetCacheForTests(): void {
  _databasesCache = null
  _releasesCache = null
}

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

function getAvailableFullVersions(
  engine: string,
  opts: { includeDeprecated?: boolean } = {},
): string[] {
  const entry = getEntry(engine)
  if (!entry) return []
  const all = Object.keys(entry.versions ?? {})
  if (opts.includeDeprecated) return all
  return all.filter((v) => isVersionEnabled(entry.versions[v]))
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type ListVersionsOptions = {
  format?: 'full' | 'major' | 'major-minor'
  includeDeprecated?: boolean
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

  // 3. Major.minor prefix — pick highest in that minor
  // (matches inputs like '11.4', '17.7', '8.0')
  const dots = version.split('.').length
  if (dots === 2) {
    const matches = versions
      .filter((v) => v.startsWith(version + '.'))
      .sort((a, b) => compareVersions(b, a))
    return matches[0] ?? null
  }

  // 4. Major prefix — only when no explicit default declared
  // (matches inputs like '17', '8', '11')
  if (dots === 1 && !defaults[version]) {
    const matches = versions
      .filter((v) => v.startsWith(version + '.') || v === version)
      .sort((a, b) => compareVersions(b, a))
    return matches[0] ?? null
  }

  return null
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
  const versions = getAvailableFullVersions(engine, opts)
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
