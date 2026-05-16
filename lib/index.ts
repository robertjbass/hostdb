/**
 * hostdb — public npm package surface
 *
 * Consumers (spindb, layerbase-cloud, third parties) install this package
 * and import from it. The package bundles `databases.json` and `releases.json`
 * snapshotted at publish time, so the resolver works offline with no network
 * dependency on registry.layerbase.host.
 *
 * Quick start:
 *   import { resolveVersion, getReleaseInfo } from 'hostdb'
 *
 *   const full = resolveVersion('postgresql', '17')        // '17.10.0'
 *   const info = getReleaseInfo('postgresql', full, 'linux-x64')
 *   //   { url: 'https://registry.layerbase.host/...', sha256: '...', size: ... }
 *
 * Anything outside this index is internal and may change without notice.
 */

// ─── Resolver (the headline API) ────────────────────────────────────────────
export {
  resolveVersion,
  normalizeVersion,
  listVersions,
  listEngines,
  getSupportedMajorVersions,
  getMajorDefault,
  getEngineDefaults,
  getReleaseInfo,
  getAvailablePlatforms,
  isVersionDeprecated,
  getCliTools,
  getDatabaseEntry,
  compareVersions,
  type ListVersionsOptions,
} from './resolver.js'

// ─── Data-access primitives (lower-level, for power users) ──────────────────
export {
  loadDatabasesJson,
  loadReleasesJson,
  loadDownloadsJson,
  isVersionEnabled,
  getEnabledVersions,
} from './databases.js'

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  Platform,
  PlatformEntry,
  PlatformConfig,
  PlatformAsset,
  Dependency,
  CliTools,
  VersionConfig,
  VersionEntry,
  VersionRelease,
  DatabaseEntry,
  DatabasesJson,
  ReleasesJson,
} from './databases.js'

export { ALL_PLATFORMS } from './databases.js'
