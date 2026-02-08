#!/usr/bin/env tsx
/**
 * Pre-commit preparation script
 *
 * Runs all checks and updates required before committing:
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
  getEnabledVersions,
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
        entry.status === 'in-progress' || entry.status === 'completed',
    )
    .map(([id]) => id)

  // Check for databases in databases.json but not in releases.json
  for (const dbId of activeDatabases) {
    const dbEntry = databases.databases[dbId]
    const enabledVersions = Object.entries(dbEntry.versions)
      .filter(([_, enabled]) => enabled === true)
      .map(([version]) => version)
    const enabledPlatforms = Object.entries(dbEntry.platforms ?? {})
      .filter(([_, enabled]) => enabled === true)
      .map(([platform]) => platform) as Platform[]

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
        discrepancies.push({
          type: 'missing-version',
          database: dbId,
          version,
          message: `Version '${version}' is enabled but not released`,
        })
        continue
      }

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

      // Check for orphaned platforms
      for (const platform of Object.keys(release.platforms)) {
        if (!dbEntry.platforms?.[platform]) {
          discrepancies.push({
            type: 'orphaned-platform',
            database: dbId,
            version,
            platform,
            message: `Platform '${platform}' is released but not enabled in databases.json`,
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
  1. Type checking (tsc --noEmit)
  2. Linting (eslint)
  3. Workflow version sync (sync:versions --check)
  4. Missing checksums detection
  5. Reconcile releases.json with GitHub releases
  6. Check for discrepancies between databases.json and releases.json
`)
    process.exit(0)
  }

  log('')
  log(`${colors.cyan}━━━ hostdb prep ━━━${colors.reset}`)
  log('')

  let allPassed = true

  // 1. Type checking
  if (!runCommand('pnpm tsc --noEmit', 'Type checking')) {
    allPassed = false
  }

  // 2. Linting (with optional fix)
  const lintCmd = fix ? 'pnpm eslint . --fix' : 'pnpm eslint .'
  if (!runCommand(lintCmd, fix ? 'Linting (with fixes)' : 'Linting')) {
    allPassed = false
  }

  // 3. Format (if --fix)
  if (fix) {
    runCommand('pnpm prettier --write .', 'Formatting', { allowFailure: true })
  }

  // 4. Sync workflow versions
  const syncCmd = checkOnly
    ? 'pnpm sync:versions --check'
    : 'pnpm sync:versions'
  if (!runCommand(syncCmd, 'Workflow version sync')) {
    allPassed = false
  }

  // 5. Check for missing checksums
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

  // 6. Reconcile releases.json with GitHub releases
  const reconcileCmd = checkOnly
    ? 'pnpm tsx scripts/reconcile-releases.ts --dry-run'
    : 'pnpm tsx scripts/reconcile-releases.ts'
  if (!runCommand(reconcileCmd, 'Reconcile releases.json')) {
    allPassed = false
  }

  // 7. Check for discrepancies between databases.json and releases.json
  logStep('Checking for discrepancies')
  const discrepancies = findDiscrepancies()

  if (discrepancies.length > 0) {
    const missing = discrepancies.filter((d) => d.type.startsWith('missing-'))
    const orphaned = discrepancies.filter((d) => d.type.startsWith('orphaned-'))

    if (missing.length > 0) {
      logWarning(`Found ${missing.length} missing release(s):`)
      for (const d of missing) {
        log(`  ${colors.dim}- ${d.message}${colors.reset}`)
      }
    }

    if (orphaned.length > 0) {
      logWarning(`Found ${orphaned.length} orphaned release(s):`)
      for (const d of orphaned) {
        log(`  ${colors.dim}- ${d.message}${colors.reset}`)
      }
    }

    log('')
    log(`${colors.yellow}To resolve:${colors.reset}`)
    if (missing.length > 0) {
      log(`  - Run GitHub Actions to create missing releases`)
      log(`  - Or disable the version/platform in databases.json`)
    }
    if (orphaned.length > 0) {
      log(`  - Add the version to databases.json`)
      log(`  - Or delete the orphaned GitHub release`)
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
