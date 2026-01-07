#!/usr/bin/env tsx
/**
 * Populate SHA256 checksums in sources.json
 *
 * Downloads each source URL and computes its SHA256, then updates sources.json.
 * This should be run once when adding new versions, then committed.
 *
 * By default, only processes versions enabled in databases.json.
 *
 * Usage:
 *   pnpm checksums:populate mariadb           # Populate null checksums for enabled versions
 *   pnpm checksums:populate mariadb --all     # Populate for ALL versions in sources.json
 *   pnpm checksums:populate mariadb --force   # Re-compute all checksums
 *   pnpm checksums:populate mariadb --verify  # Verify existing checksums
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function logSuccess(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function logError(message: string) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

function logInfo(message: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`)
}

function logWarning(message: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

type SourceEntry = {
  url?: string
  format?: string
  sourceType: string
  sha256?: string | null
}

type SourcesJson = {
  $schema: string
  database: string
  versions: Record<string, Record<string, SourceEntry>>
  notes: Record<string, string>
}

type DatabaseEntry = {
  versions: Record<string, boolean>
}

type DatabasesJson = {
  databases: Record<string, DatabaseEntry>
}

function loadDatabasesJson(): DatabasesJson {
  const filePath = join(ROOT, 'databases.json')
  return JSON.parse(readFileSync(filePath, 'utf-8')) as DatabasesJson
}

function getEnabledVersions(database: string): Set<string> {
  try {
    const data = loadDatabasesJson()
    const dbEntry = data.databases[database]
    if (!dbEntry) return new Set()

    return new Set(
      Object.entries(dbEntry.versions)
        .filter(([, enabled]) => enabled === true)
        .map(([version]) => version)
    )
  } catch {
    return new Set()
  }
}

const FETCH_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes for large files

async function computeSha256(url: string): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
    }

    reader = response.body?.getReader()
    if (!reader) {
      throw new Error(`No response body for ${url}`)
    }

    const hash = createHash('sha256')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
    }

    return hash.digest('hex')
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`)
    }
    throw error
  } finally {
    try {
      await reader?.cancel()
    } catch {
      // Ignore cleanup errors
    }
    clearTimeout(timeoutId)
  }
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    log(`
${colors.cyan}populate-checksums${colors.reset} - Compute and store SHA256 checksums in sources.json

${colors.yellow}Usage:${colors.reset}
  pnpm checksums:populate <database>           # Populate null checksums (enabled versions only)
  pnpm checksums:populate <database> --all     # Populate for ALL versions in sources.json
  pnpm checksums:populate <database> --force   # Re-compute all checksums
  pnpm checksums:populate <database> --verify  # Verify existing checksums

${colors.yellow}Examples:${colors.reset}
  pnpm checksums:populate mariadb
  pnpm checksums:populate mysql --all
  pnpm checksums:populate postgresql --verify
`)
    process.exit(0)
  }

  const database = args[0]
  const force = args.includes('--force')
  const verify = args.includes('--verify')
  const processAll = args.includes('--all')

  // Get enabled versions from databases.json
  const enabledVersions = getEnabledVersions(database)

  const sourcesPath = join(ROOT, 'builds', database, 'sources.json')

  let sources: SourcesJson
  try {
    sources = JSON.parse(readFileSync(sourcesPath, 'utf-8')) as SourcesJson
  } catch {
    logError(`Could not read builds/${database}/sources.json`)
    process.exit(1)
  }

  log('')
  log(`${colors.cyan}${verify ? 'Verifying' : 'Populating'} checksums for ${database}${colors.reset}`)
  log('='.repeat(50))

  if (!processAll && enabledVersions.size > 0) {
    log(`${colors.dim}Only processing enabled versions: ${[...enabledVersions].join(', ')}${colors.reset}`)
    log(`${colors.dim}Use --all to process all versions in sources.json${colors.reset}`)
  }
  log('')

  let updated = 0
  let verified = 0
  let failed = 0
  let skipped = 0

  for (const [version, platforms] of Object.entries(sources.versions)) {
    // Skip versions not enabled in databases.json (unless --all)
    if (!processAll && enabledVersions.size > 0 && !enabledVersions.has(version)) {
      continue
    }

    for (const [platform, entry] of Object.entries(platforms)) {
      // Skip entries without URLs (build-required)
      if (!entry.url) {
        continue
      }

      const label = `${version}/${platform}`

      // Skip if already has checksum and not forcing
      if (entry.sha256 && !force && !verify) {
        logInfo(`${label}: already has checksum (skipping)`)
        skipped++
        continue
      }

      log(`${colors.dim}Downloading ${label}...${colors.reset}`)

      try {
        const computed = await computeSha256(entry.url)

        if (verify) {
          if (!entry.sha256) {
            logWarning(`${label}: no checksum stored`)
            skipped++
          } else if (entry.sha256 === computed) {
            logSuccess(`${label}: checksum verified`)
            verified++
          } else {
            logError(`${label}: CHECKSUM MISMATCH!`)
            logError(`  Expected: ${entry.sha256}`)
            logError(`  Computed: ${computed}`)
            failed++
          }
        } else {
          if (entry.sha256 !== computed) {
            entry.sha256 = computed
            logSuccess(`${label}: ${computed.substring(0, 16)}...`)
            updated++
          } else {
            logInfo(`${label}: unchanged`)
            skipped++
          }
        }
      } catch (error) {
        logError(`${label}: ${error instanceof Error ? error.message : String(error)}`)
        failed++
      }
    }
  }

  log('')
  log('='.repeat(50))

  if (verify) {
    log(`Verified: ${verified}, Skipped: ${skipped}, Failed: ${failed}`)
    if (failed > 0) {
      process.exit(1)
    }
  } else {
    if (updated > 0) {
      writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + '\n')
      logSuccess(`Updated ${updated} checksums in builds/${database}/sources.json`)
      log('')
      log(`${colors.yellow}Don't forget to commit the changes:${colors.reset}`)
      log(`  git add builds/${database}/sources.json`)
      log(`  git commit -m "chore: populate checksums for ${database}"`)
    } else {
      logInfo('No checksums updated')
    }
    log(`Skipped: ${skipped}, Failed: ${failed}`)
  }

  log('')
}

main().catch((error) => {
  logError(String(error))
  process.exit(1)
})
