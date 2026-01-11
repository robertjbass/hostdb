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
import { getEnabledVersions } from './lib/databases.js'

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


function findMissingChecksums(): Array<{ database: string; version: string; platform: string }> {
  const missing: Array<{ database: string; version: string; platform: string }> = []
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
      const sources: SourcesJson = JSON.parse(readFileSync(sourcesPath, 'utf-8'))

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
  const syncCmd = checkOnly ? 'pnpm sync:versions --check' : 'pnpm sync:versions'
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
      logError('Missing checksums found. Run: pnpm checksums:populate <database>')
      allPassed = false
    } else {
      // Group by database and populate
      const databases = [...new Set(missing.map((m) => m.database))]
      for (const database of databases) {
        log(`${colors.dim}Populating checksums for ${database}...${colors.reset}`)
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
