#!/usr/bin/env tsx
/**
 * Pre-commit preparation script
 *
 * Runs all checks and updates required before committing:
 * - Generate databases.json from databases.yml
 * - Type checking (tsc --noEmit)
 * - Linting (eslint)
 * - Sync workflow version dropdowns
 * - Populate missing checksums in sources.json
 *
 * Usage:
 *   pnpm prep              # Run all checks
 *   pnpm prep --fix        # Run checks and auto-fix what's possible
 *   pnpm prep --check      # Check only, don't modify files (for CI)
 */

import { execSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  generateDatabasesJson,
  getEnabledVersions,
  isVersionEnabled,
  isVersionDeprecated,
  getVersionPlatforms,
  getRetiredPlatforms,
  type Platform,
  type DatabasesJson,
  type ReleasesJson,
} from '../lib/databases.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

function log(message: string) {
  console.log(message)
}

function logStep(message: string) {
  console.log(`\n${colors.cyan}▶${colors.reset} ${message}`)
}

function logSuccess(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function logError(message: string) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

function logWarning(message: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

function runCommand(
  command: string,
  description: string,
  options: { allowFailure?: boolean } = {},
): boolean {
  logStep(description)
  try {
    execSync(command, { cwd: ROOT, stdio: 'inherit' })
    logSuccess(description)
    return true
  } catch {
    if (options.allowFailure) {
      logWarning(`${description} (non-critical)`)
      return true
    }
    logError(`${description} failed`)
    return false
  }
}

type SourceEntry = {
  url?: string
  sha256?: string | null
  sha3_256?: string | null // SQLite uses SHA3-256
  sourceType?: string
}

type SourcesJson = {
  versions: Record<string, Record<string, SourceEntry>>
}

type Discrepancy = {
  type:
    | 'missing-release'
    | 'orphaned-release'
    | 'missing-version'
    | 'orphaned-version'
    | 'missing-platform'
    | 'orphaned-platform'
    | 'stale-retirement'
    | 'conflicting-retirement'
  database: string
  version?: string
  platform?: string
  message: string
}

function findDiscrepancies(): Discrepancy[] {
  const discrepancies: Discrepancy[] = []

  const databasesPath = join(ROOT, 'databases.json')
  const releasesPath = join(ROOT, 'releases.json')

  if (!existsSync(databasesPath) || !existsSync(releasesPath)) {
    return discrepancies
  }

  const databases: DatabasesJson = JSON.parse(
    readFileSync(databasesPath, 'utf-8'),
  )
  const releases: ReleasesJson = JSON.parse(readFileSync(releasesPath, 'utf-8'))

  // Get databases that are in-progress or completed (have enabled versions)
  const activeDatabases = Object.entries(databases.databases)
    .filter(
      ([_, entry]) =>
        entry.spindbStatus === 'in-progress' ||
        entry.spindbStatus === 'completed',
    )
    .map(([id]) => id)

  // Check for databases in databases.json but not in releases.json
  for (const dbId of activeDatabases) {
    const dbEntry = databases.databases[dbId]
    const enabledVersions = Object.entries(dbEntry.versions)
      .filter(([_, entry]) => isVersionEnabled(entry))
      .map(([version]) => version)

    if (!releases.databases[dbId]) {
      if (enabledVersions.length > 0) {
        discrepancies.push({
          type: 'missing-release',
          database: dbId,
          message: `Database '${dbId}' has ${enabledVersions.length} enabled version(s) but no releases`,
        })
      }
      continue
    }

    // Check for versions enabled but not released
    for (const version of enabledVersions) {
      if (!releases.databases[dbId][version]) {
        // Skip deprecated versions — they retain existing releases but
        // should not be flagged if they happen to be missing
        const versionEntry = dbEntry.versions[version]
        if (isVersionDeprecated(versionEntry)) continue

        discrepancies.push({
          type: 'missing-version',
          database: dbId,
          version,
          message: `Version '${version}' is enabled but not released`,
        })
        continue
      }

      // Get effective platforms for this version
      const enabledPlatforms = getVersionPlatforms(dbEntry, version)

      // Check for platforms enabled but not released
      const releasedPlatforms = Object.keys(
        releases.databases[dbId][version].platforms,
      )
      for (const platform of enabledPlatforms) {
        if (!releasedPlatforms.includes(platform)) {
          discrepancies.push({
            type: 'missing-platform',
            database: dbId,
            version,
            platform,
            message: `Platform '${platform}' is enabled but not released for ${dbId} ${version}`,
          })
        }
      }
    }
  }

  // Check for orphaned releases (in releases.json but not enabled in databases.json)
  for (const [dbId, versions] of Object.entries(releases.databases)) {
    const dbEntry = databases.databases[dbId]

    if (!dbEntry) {
      discrepancies.push({
        type: 'orphaned-release',
        database: dbId,
        message: `Database '${dbId}' is in releases.json but not in databases.json`,
      })
      continue
    }

    for (const [version, release] of Object.entries(versions)) {
      if (!dbEntry.versions[version]) {
        discrepancies.push({
          type: 'orphaned-version',
          database: dbId,
          version,
          message: `Version '${version}' is released but not in databases.json`,
        })
        continue
      }

      // Get effective platforms for orphan check
      const enabledPlatforms = getVersionPlatforms(dbEntry, version)
      const retiredPlatforms = getRetiredPlatforms(dbEntry, version)

      // Check for orphaned platforms. A platform declared in
      // `retired_platforms` is a known, documented leftover: the artifact is
      // published and immutable, so its release entry is expected.
      for (const platform of Object.keys(release.platforms)) {
        if (enabledPlatforms.includes(platform as Platform)) continue
        if (retiredPlatforms[platform as Platform]) continue

        discrepancies.push({
          type: 'orphaned-platform',
          database: dbId,
          version,
          platform,
          message: `Platform '${platform}' is released but not enabled in databases.json for ${dbId} ${version}`,
        })
      }
    }
  }

  // Verify every retirement still describes reality. Without this the
  // suppression list would be a place to silence warnings forever; instead a
  // retirement that no longer matches a released artifact, or that contradicts
  // the supported-platform list, is itself reported.
  for (const [dbId, dbEntry] of Object.entries(databases.databases)) {
    for (const version of Object.keys(dbEntry.versions)) {
      const retiredPlatforms = getRetiredPlatforms(dbEntry, version)
      if (Object.keys(retiredPlatforms).length === 0) continue

      const enabledPlatforms = getVersionPlatforms(dbEntry, version)
      const releasedPlatforms = Object.keys(
        releases.databases[dbId]?.[version]?.platforms ?? {},
      )

      for (const platform of Object.keys(retiredPlatforms)) {
        if (enabledPlatforms.includes(platform as Platform)) {
          discrepancies.push({
            type: 'conflicting-retirement',
            database: dbId,
            version,
            platform,
            message: `Platform '${platform}' is listed in both platforms and retired_platforms for ${dbId} ${version}`,
          })
          continue
        }

        if (!releasedPlatforms.includes(platform)) {
          discrepancies.push({
            type: 'stale-retirement',
            database: dbId,
            version,
            platform,
            message: `Platform '${platform}' is marked retired for ${dbId} ${version} but has no release; drop the retired_platforms entry`,
          })
        }
      }
    }
  }

  return discrepancies
}

function findMissingChecksums(): Array<{
  database: string
  version: string
  platform: string
}> {
  const missing: Array<{
    database: string
    version: string
    platform: string
  }> = []
  const buildsDir = join(ROOT, 'builds')

  if (!existsSync(buildsDir)) {
    return missing
  }

  for (const database of readdirSync(buildsDir)) {
    const sourcesPath = join(buildsDir, database, 'sources.json')
    if (!existsSync(sourcesPath)) {
      continue
    }

    const enabledVersions = getEnabledVersions(database)

    try {
      const sources: SourcesJson = JSON.parse(
        readFileSync(sourcesPath, 'utf-8'),
      )

      for (const [version, platforms] of Object.entries(sources.versions)) {
        // Only check versions enabled in databases.json
        if (enabledVersions.size > 0 && !enabledVersions.has(version)) {
          continue
        }

        for (const [platform, entry] of Object.entries(platforms)) {
          // Only check entries with URLs (not build-required)
          // Accept either sha256 or sha3_256 (SQLite uses SHA3-256)
          const hasChecksum = entry.sha256 || entry.sha3_256
          if (entry.url && !hasChecksum) {
            missing.push({ database, version, platform })
          }
        }
      }
    } catch {
      logWarning(`Could not parse builds/${database}/sources.json`)
    }
  }

  return missing
}

async function main() {
  const args = process.argv.slice(2)
  const fix = args.includes('--fix')
  const checkOnly = args.includes('--check')

  if (args.includes('--help') || args.includes('-h')) {
    log(`
${colors.cyan}prep${colors.reset} - Pre-commit preparation script

${colors.yellow}Usage:${colors.reset}
  pnpm prep              # Run all checks
  pnpm prep --fix        # Run checks and auto-fix (format code)
  pnpm prep --check      # Check only, don't modify files (for CI)

${colors.yellow}Checks:${colors.reset}
  1. Generate databases.json from databases.yml
  2. Type checking (tsc --noEmit)
  3. Linting (eslint)
  4. Tests (node --test tests/*.test.ts — includes the defaults-sync snapshot)
  5. Workflow version sync (sync:versions --check)
  6. Missing checksums detection
  7. Build releases.json from GitHub releases
  8. Check for discrepancies between databases.json and releases.json
`)
    process.exit(0)
  }

  log('')
  log(`${colors.cyan}━━━ hostdb prep ━━━${colors.reset}`)
  log('')

  let allPassed = true

  // 1. Generate databases.json from databases.yml
  logStep('Generating databases.json from databases.yml')
  const jsonChanged = await generateDatabasesJson({ checkOnly })
  if (checkOnly && jsonChanged) {
    logError('databases.json is out of date with databases.yml. Run: pnpm prep')
    allPassed = false
  } else if (jsonChanged) {
    logSuccess('Generated databases.json from databases.yml')
  } else {
    logSuccess('databases.json is up to date')
  }

  // 2. Type checking
  if (!runCommand('pnpm tsc --noEmit', 'Type checking')) {
    allPassed = false
  }

  // 3. Linting (with optional fix)
  const lintCmd = fix ? 'pnpm eslint . --fix' : 'pnpm eslint .'
  if (!runCommand(lintCmd, fix ? 'Linting (with fixes)' : 'Linting')) {
    allPassed = false
  }

  // 4. Format (if --fix)
  if (fix) {
    runCommand('pnpm prettier --write .', 'Formatting', { allowFailure: true })
  }

  // 5. Tests (includes defaults-sync snapshot — catches policy changes
  // before they reach CI, e.g. when defaults block keys are repointed)
  if (!runCommand('pnpm test', 'Tests')) {
    allPassed = false
  }

  // 6. Sync workflow versions
  const syncCmd = checkOnly
    ? 'pnpm sync:versions --check'
    : 'pnpm sync:versions'
  if (!runCommand(syncCmd, 'Workflow version sync')) {
    allPassed = false
  }

  // 6. Check for missing checksums
  logStep('Checking for missing checksums')
  const missing = findMissingChecksums()

  if (missing.length > 0) {
    logWarning(`Found ${missing.length} missing checksum(s):`)
    for (const { database, version, platform } of missing) {
      log(`  ${colors.dim}- ${database}/${version}/${platform}${colors.reset}`)
    }
    log('')

    if (checkOnly) {
      logError(
        'Missing checksums found. Run: pnpm checksums:populate <database>',
      )
      allPassed = false
    } else {
      // Group by database and populate
      const databases = [...new Set(missing.map((m) => m.database))]
      for (const database of databases) {
        log(
          `${colors.dim}Populating checksums for ${database}...${colors.reset}`,
        )
        const result = spawnSync('pnpm', ['checksums:populate', database], {
          cwd: ROOT,
          stdio: 'inherit',
        })
        if (result.status !== 0) {
          logWarning(`Failed to populate some checksums for ${database}`)
        }
      }
    }
  } else {
    logSuccess('All checksums populated')
  }

  // 7. Rebuild releases.json from GitHub releases
  const buildReleasesCmd = checkOnly
    ? 'pnpm tsx scripts/build-releases-json.ts --check'
    : 'pnpm tsx scripts/build-releases-json.ts'
  if (!runCommand(buildReleasesCmd, 'Build releases.json')) {
    allPassed = false
  }

  // 8. Check for discrepancies between databases.json and releases.json
  logStep('Checking for discrepancies')
  const discrepancies = findDiscrepancies()

  if (discrepancies.length > 0) {
    const missingD = discrepancies.filter((d) => d.type.startsWith('missing-'))
    const orphaned = discrepancies.filter((d) => d.type.startsWith('orphaned-'))
    const retirements = discrepancies.filter((d) =>
      d.type.endsWith('-retirement'),
    )

    if (missingD.length > 0) {
      logWarning(`Found ${missingD.length} missing release(s):`)
      for (const d of missingD) {
        log(`  ${colors.dim}- ${d.message}${colors.reset}`)
      }
    }

    if (orphaned.length > 0) {
      logWarning(`Found ${orphaned.length} orphaned release(s):`)
      for (const d of orphaned) {
        log(`  ${colors.dim}- ${d.message}${colors.reset}`)
      }
    }

    if (retirements.length > 0) {
      logWarning(`Found ${retirements.length} stale platform retirement(s):`)
      for (const d of retirements) {
        log(`  ${colors.dim}- ${d.message}${colors.reset}`)
      }
    }

    log('')
    log(`${colors.yellow}To resolve:${colors.reset}`)
    if (missingD.length > 0) {
      log(`  - Run GitHub Actions to create missing releases`)
      log(`  - Or disable the version/platform in databases.json`)
    }
    if (orphaned.length > 0) {
      log(`  - Add the version to databases.json`)
      log(`  - Or delete the orphaned GitHub release`)
      log(
        `  - Or, if the platform was dropped on purpose, record it under retired_platforms in databases.yml`,
      )
    }
    if (retirements.length > 0) {
      log(`  - Remove the retired_platforms entry in databases.yml`)
    }
    log('')

    // Discrepancies are warnings, not failures (releases may be in progress)
    logWarning('Discrepancies found (may be expected if releases are pending)')
  } else {
    logSuccess('No discrepancies between databases.json and releases.json')
  }

  // Summary
  log('')
  log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━${colors.reset}`)

  if (allPassed) {
    logSuccess('All checks passed!')
    log('')
    process.exit(0)
  } else {
    logError('Some checks failed')
    log('')
    process.exit(1)
  }
}

main().catch((error) => {
  logError(String(error))
  process.exit(1)
})
