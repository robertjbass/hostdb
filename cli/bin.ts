#!/usr/bin/env tsx
/**
 * hostdb CLI
 *
 * Query and download database binaries from hostdb releases.
 */

import {
  loadDatabasesJson,
  loadReleasesJson,
  type Platform,
  type PlatformAsset,
} from '../lib/databases.js'

// Aliases for databases
const DATABASE_ALIASES: Record<string, string> = {
  postgres: 'postgresql',
  pg: 'postgresql',
  mongo: 'mongodb',
  maria: 'mariadb',
  ch: 'clickhouse',
  duck: 'duckdb',
}

// Aliases for platforms - maps to array of platforms
const PLATFORM_ALIASES: Record<string, Platform[]> = {
  // macOS
  mac: ['darwin-arm64', 'darwin-x64'],
  macos: ['darwin-arm64', 'darwin-x64'],
  darwin: ['darwin-arm64', 'darwin-x64'],
  osx: ['darwin-arm64', 'darwin-x64'],
  apple: ['darwin-arm64', 'darwin-x64'],
  // macOS specific
  'mac-arm': ['darwin-arm64'],
  'mac-intel': ['darwin-x64'],
  'm1': ['darwin-arm64'],
  'm2': ['darwin-arm64'],
  'm3': ['darwin-arm64'],
  'm4': ['darwin-arm64'],
  // Windows
  win: ['win32-x64'],
  windows: ['win32-x64'],
  win32: ['win32-x64'],
  win64: ['win32-x64'],
  // Linux
  linux: ['linux-x64', 'linux-arm64'],
  ubuntu: ['linux-x64', 'linux-arm64'],
  debian: ['linux-x64', 'linux-arm64'],
  // Linux specific
  'linux-amd64': ['linux-x64'],
  'linux-aarch64': ['linux-arm64'],
  // Architecture shortcuts
  x64: ['linux-x64', 'darwin-x64', 'win32-x64'],
  arm64: ['linux-arm64', 'darwin-arm64'],
  arm: ['linux-arm64', 'darwin-arm64'],
  amd64: ['linux-x64', 'darwin-x64', 'win32-x64'],
  aarch64: ['linux-arm64', 'darwin-arm64'],
  // Direct platform names
  'linux-x64': ['linux-x64'],
  'linux-arm64': ['linux-arm64'],
  'darwin-x64': ['darwin-x64'],
  'darwin-arm64': ['darwin-arm64'],
  'win32-x64': ['win32-x64'],
}

function resolveDatabase(input: string): string | null {
  const lower = input.toLowerCase()
  if (DATABASE_ALIASES[lower]) {
    return DATABASE_ALIASES[lower]
  }
  return lower
}

function resolvePlatforms(input: string): Platform[] | null {
  const lower = input.toLowerCase()
  if (PLATFORM_ALIASES[lower]) {
    return PLATFORM_ALIASES[lower]
  }
  return null
}

function isVersionString(input: string): boolean {
  // Matches version patterns like 8.4.3, 17.7.0, 25.12.3.21
  return /^\d+(\.\d+)+$/.test(input)
}

function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const partsA = a.split('.').map((p) => parseInt(p, 10) || 0)
    const partsB = b.split('.').map((p) => parseInt(p, 10) || 0)
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsB[i] || 0) - (partsA[i] || 0)
      if (diff !== 0) return diff
    }
    return 0
  })
}

/**
 * Resolve a platform alias to a single target platform from available platforms
 */
function resolveTargetPlatform(
  platformInput: string,
  availablePlatforms: Partial<Record<Platform, PlatformAsset>>,
): Platform {
  const platforms = resolvePlatforms(platformInput)

  if (platforms && platforms.length === 1) {
    const target = platforms[0]
    if (!availablePlatforms[target]) {
      console.error(`Error: Platform '${platformInput}' not found`)
      console.error(`\nAvailable: ${Object.keys(availablePlatforms).join(', ')}`)
      process.exit(1)
    }
    return target
  }

  if (platforms) {
    // Multiple platforms from alias - find first available
    const target = platforms.find((p) => availablePlatforms[p])
    if (!target) {
      console.error(`Error: No matching platform for '${platformInput}'`)
      console.error(`\nAvailable: ${Object.keys(availablePlatforms).join(', ')}`)
      process.exit(1)
    }
    return target
  }

  // Try as direct platform name
  const target = platformInput as Platform
  if (!availablePlatforms[target]) {
    console.error(`Error: Platform '${platformInput}' not found`)
    console.error(`\nAvailable: ${Object.keys(availablePlatforms).join(', ')}`)
    process.exit(1)
  }
  return target
}

function printUsage() {
  console.log(`
hostdb - Query database binaries from hostdb releases

Usage:
  hostdb list [filters...] [--json]     List/filter databases, versions, platforms
  hostdb url <db> <version> <platform>  Get download URL
  hostdb info <db> <version> <platform> Get full release info as JSON

Filters (combine any):
  <database>   Filter by database (mysql, postgres, mongodb, etc.)
  <version>    Filter by version (8.4.3, 17.7.0, etc.)
  <platform>   Filter by platform (mac, linux, windows, arm64, etc.)

Examples:
  hostdb list                           List all databases
  hostdb list --json                    List all databases as JSON
  hostdb list mysql                     List MySQL versions
  hostdb list mysql --json              List MySQL versions as JSON
  hostdb list mac                       List all versions available on macOS
  hostdb list mysql mac                 List MySQL versions for macOS
  hostdb list postgres linux arm64      List PostgreSQL for Linux ARM64
  hostdb list mysql 8.4.3               List platforms for MySQL 8.4.3
  hostdb list mysql 8.4.3 mac           Show MySQL 8.4.3 for macOS

  hostdb url mysql 8.4.3 darwin-arm64   Get download URL
  hostdb info mysql 8.4.3 darwin-arm64  Get full info as JSON

Platform Aliases:
  mac, macos, darwin, osx       → darwin-x64, darwin-arm64
  win, windows                  → win32-x64
  linux, ubuntu, debian         → linux-x64, linux-arm64
  arm64, arm, aarch64           → linux-arm64, darwin-arm64
  x64, amd64                    → linux-x64, darwin-x64, win32-x64
  m1, m2, m3, m4                → darwin-arm64

Database Aliases:
  postgres, pg                  → postgresql
  mongo                         → mongodb
  maria                         → mariadb
  ch                            → clickhouse
  duck                          → duckdb
`)
}

function cmdList(filters: string[], jsonOutput: boolean): void {
  const releases = loadReleasesJson()
  const databases = loadDatabasesJson()

  let dbFilter: string | null = null
  let versionFilter: string | null = null
  let platformFilter: Platform[] | null = null

  // Parse filters
  for (const filter of filters) {
    const platforms = resolvePlatforms(filter)
    if (platforms) {
      platformFilter = platformFilter
        ? platformFilter.filter((p) => platforms.includes(p))
        : platforms
      continue
    }

    if (isVersionString(filter)) {
      versionFilter = filter
      continue
    }

    // Assume it's a database name
    const resolved = resolveDatabase(filter)
    if (resolved && releases.databases[resolved]) {
      dbFilter = resolved
    } else if (resolved) {
      console.error(`Error: Database '${filter}' not found`)
      console.error(`\nAvailable: ${Object.keys(releases.databases).join(', ')}`)
      process.exit(1)
    }
  }

  // Determine what to show based on filters
  if (!dbFilter && !versionFilter && !platformFilter) {
    // No filters: show all databases
    const result = Object.keys(releases.databases).sort().map((db) => {
      const versions = Object.keys(releases.databases[db])
      const info = databases.databases[db]
      return {
        database: db,
        displayName: info?.displayName || db,
        type: info?.type || '',
        versions: versions.length,
      }
    })

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log('Available databases:\n')
      for (const r of result) {
        console.log(`  ${r.database.padEnd(15)} ${r.displayName.padEnd(15)} ${r.type.padEnd(20)} (${r.versions} versions)`)
      }
    }
    return
  }

  if (dbFilter && !versionFilter) {
    // Database specified, no version: show versions
    const dbReleases = releases.databases[dbFilter]
    let versions = sortVersionsDesc(Object.keys(dbReleases))

    // Filter by platform if specified
    if (platformFilter) {
      versions = versions.filter((v) => {
        const release = dbReleases[v]
        return platformFilter!.some((p) => release.platforms[p])
      })
    }

    const result = versions.map((v) => {
      const release = dbReleases[v]
      const availablePlatforms = Object.keys(release.platforms) as Platform[]
      const filteredPlatforms = platformFilter
        ? availablePlatforms.filter((p) => platformFilter!.includes(p))
        : availablePlatforms
      return {
        version: v,
        platforms: filteredPlatforms,
        releasedAt: release.releasedAt,
      }
    })

    if (jsonOutput) {
      console.log(JSON.stringify({ database: dbFilter, versions: result }, null, 2))
    } else {
      const platformLabel = platformFilter ? ` (${platformFilter.join(', ')})` : ''
      console.log(`Versions for ${dbFilter}${platformLabel}:\n`)
      for (const r of result) {
        console.log(`  ${r.version.padEnd(15)} (${r.platforms.join(', ')})`)
      }
    }
    return
  }

  if (dbFilter && versionFilter && !platformFilter) {
    // Database and version: show platforms
    const dbReleases = releases.databases[dbFilter]
    if (!dbReleases[versionFilter]) {
      console.error(`Error: Version '${versionFilter}' not found for ${dbFilter}`)
      console.error(`\nAvailable: ${sortVersionsDesc(Object.keys(dbReleases)).join(', ')}`)
      process.exit(1)
    }

    const release = dbReleases[versionFilter]
    const result = (Object.keys(release.platforms) as Platform[]).sort().map((p) => {
      const asset = release.platforms[p]!
      return {
        platform: p,
        url: asset.url,
        sha256: asset.sha256,
        size: asset.size,
        sizeMB: (asset.size / 1024 / 1024).toFixed(1),
      }
    })

    if (jsonOutput) {
      console.log(JSON.stringify({
        database: dbFilter,
        version: versionFilter,
        releaseTag: release.releaseTag,
        releasedAt: release.releasedAt,
        platforms: result,
      }, null, 2))
    } else {
      console.log(`Platforms for ${dbFilter} ${versionFilter}:\n`)
      for (const r of result) {
        console.log(`  ${r.platform.padEnd(15)} ${r.sizeMB} MB`)
      }
    }
    return
  }

  if (dbFilter && versionFilter && platformFilter) {
    // All three: show specific assets
    const dbReleases = releases.databases[dbFilter]
    if (!dbReleases[versionFilter]) {
      console.error(`Error: Version '${versionFilter}' not found for ${dbFilter}`)
      console.error(`\nAvailable: ${sortVersionsDesc(Object.keys(dbReleases)).join(', ')}`)
      process.exit(1)
    }

    const release = dbReleases[versionFilter]
    const matchingPlatforms = platformFilter.filter((p) => release.platforms[p])

    if (matchingPlatforms.length === 0) {
      console.error(`Error: No matching platforms for ${dbFilter} ${versionFilter}`)
      console.error(`\nAvailable: ${Object.keys(release.platforms).join(', ')}`)
      console.error(`Requested: ${platformFilter.join(', ')}`)
      process.exit(1)
    }

    const result = matchingPlatforms.map((p) => {
      const asset = release.platforms[p]!
      return {
        database: dbFilter,
        version: versionFilter,
        platform: p,
        url: asset.url,
        sha256: asset.sha256,
        size: asset.size,
        releaseTag: release.releaseTag,
        releasedAt: release.releasedAt,
      }
    })

    if (jsonOutput) {
      console.log(JSON.stringify(result.length === 1 ? result[0] : result, null, 2))
    } else {
      for (const r of result) {
        const sizeMB = (r.size / 1024 / 1024).toFixed(1)
        console.log(`${r.database} ${r.version} ${r.platform}`)
        console.log(`  URL:    ${r.url}`)
        console.log(`  SHA256: ${r.sha256}`)
        console.log(`  Size:   ${sizeMB} MB`)
        if (result.length > 1) console.log()
      }
    }
    return
  }

  if (!dbFilter && platformFilter) {
    // Platform only: show all databases/versions for that platform
    const result: Array<{ database: string; version: string; platforms: string[] }> = []

    for (const db of Object.keys(releases.databases).sort()) {
      const dbReleases = releases.databases[db]
      for (const version of sortVersionsDesc(Object.keys(dbReleases))) {
        const release = dbReleases[version]
        const matchingPlatforms = platformFilter.filter((p) => release.platforms[p])
        if (matchingPlatforms.length > 0) {
          result.push({
            database: db,
            version,
            platforms: matchingPlatforms,
          })
        }
      }
    }

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`Releases for ${platformFilter.join(', ')}:\n`)
      let currentDb = ''
      for (const r of result) {
        if (r.database !== currentDb) {
          if (currentDb) console.log()
          console.log(`  ${r.database}:`)
          currentDb = r.database
        }
        console.log(`    ${r.version.padEnd(15)} (${r.platforms.join(', ')})`)
      }
    }
    return
  }

  // Fallback
  console.error('Invalid filter combination')
  process.exit(1)
}

function cmdUrl(database: string, version: string, platform: string) {
  const releases = loadReleasesJson()

  const db = resolveDatabase(database)
  if (!db || !releases.databases[db]) {
    console.error(`Error: Database '${database}' not found`)
    console.error(`\nAvailable: ${Object.keys(releases.databases).sort().join(', ')}`)
    process.exit(1)
  }

  if (!releases.databases[db][version]) {
    console.error(`Error: Version '${version}' not found for ${db}`)
    console.error(`\nAvailable: ${sortVersionsDesc(Object.keys(releases.databases[db])).join(', ')}`)
    process.exit(1)
  }

  const release = releases.databases[db][version]
  const targetPlatform = resolveTargetPlatform(platform, release.platforms)
  const asset = release.platforms[targetPlatform]!

  console.log(asset.url)
}

function cmdInfo(database: string, version: string, platform: string) {
  const releases = loadReleasesJson()

  const db = resolveDatabase(database)
  if (!db || !releases.databases[db]) {
    console.error(`Error: Database '${database}' not found`)
    console.error(`\nAvailable: ${Object.keys(releases.databases).sort().join(', ')}`)
    process.exit(1)
  }

  if (!releases.databases[db][version]) {
    console.error(`Error: Version '${version}' not found for ${db}`)
    console.error(`\nAvailable: ${sortVersionsDesc(Object.keys(releases.databases[db])).join(', ')}`)
    process.exit(1)
  }

  const release = releases.databases[db][version]
  const targetPlatform = resolveTargetPlatform(platform, release.platforms)
  const asset = release.platforms[targetPlatform]!

  console.log(JSON.stringify({
    database: db,
    version,
    platform: targetPlatform,
    url: asset.url,
    sha256: asset.sha256,
    size: asset.size,
    releaseTag: release.releaseTag,
    releasedAt: release.releasedAt,
  }, null, 2))
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage()
    process.exit(0)
  }

  // Check for --json flag
  const jsonOutput = args.includes('--json')
  const filteredArgs = args.filter((a) => a !== '--json')

  const command = filteredArgs[0]

  switch (command) {
    case 'list':
    case 'ls':
      cmdList(filteredArgs.slice(1), jsonOutput)
      break

    case 'url':
      if (!filteredArgs[1] || !filteredArgs[2] || !filteredArgs[3]) {
        console.error('Error: Missing arguments')
        console.error('Usage: hostdb url <database> <version> <platform>')
        process.exit(1)
      }
      cmdUrl(filteredArgs[1], filteredArgs[2], filteredArgs[3])
      break

    case 'info':
      if (!filteredArgs[1] || !filteredArgs[2] || !filteredArgs[3]) {
        console.error('Error: Missing arguments')
        console.error('Usage: hostdb info <database> <version> <platform>')
        process.exit(1)
      }
      cmdInfo(filteredArgs[1], filteredArgs[2], filteredArgs[3])
      break

    case 'versions': {
      if (!filteredArgs[1]) {
        console.error('Error: Missing database argument')
        console.error('Usage: hostdb versions <database>')
        process.exit(1)
      }
      const db = resolveDatabase(filteredArgs[1])
      cmdList(db ? [db] : [filteredArgs[1]], jsonOutput)
      break
    }

    case 'platforms': {
      if (!filteredArgs[1] || !filteredArgs[2]) {
        console.error('Error: Missing arguments')
        console.error('Usage: hostdb platforms <database> <version>')
        process.exit(1)
      }
      const db = resolveDatabase(filteredArgs[1])
      cmdList(db ? [db, filteredArgs[2]] : [filteredArgs[1], filteredArgs[2]], jsonOutput)
      break
    }

    default:
      // Try to interpret as list with filters
      cmdList(filteredArgs, jsonOutput)
  }
}

main()
