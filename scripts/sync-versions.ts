#!/usr/bin/env tsx
/**
 * Sync workflow version dropdowns with databases.json
 *
 * Usage:
 *   pnpm sync:versions           # Sync all workflows
 *   pnpm sync:versions mysql     # Sync specific database
 *   pnpm sync:versions --check   # Check if sync needed (for CI)
 *
 * This script updates the version dropdown options in GitHub Actions
 * workflows to match the enabled versions in databases.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify, parseDocument } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Colors for terminal output
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

type DatabaseConfig = {
  displayName: string
  versions: Record<string, boolean>
  status: string
}

type DatabasesJson = {
  databases: Record<string, DatabaseConfig>
}

function loadDatabases(): DatabasesJson {
  const path = join(ROOT, 'databases.json')
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content) as DatabasesJson
}

function getEnabledVersions(db: DatabaseConfig): string[] {
  return Object.entries(db.versions)
    .filter(([, enabled]) => enabled)
    .map(([version]) => version)
    .sort((a, b) => {
      // Sort by semantic version, newest first
      const aParts = a.split('.').map((p) => parseInt(p.replace(/\D/g, ''), 10) || 0)
      const bParts = b.split('.').map((p) => parseInt(p.replace(/\D/g, ''), 10) || 0)
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0
        const bVal = bParts[i] || 0
        if (bVal !== aVal) return bVal - aVal
      }
      return 0
    })
}

function updateWorkflowVersions(
  dbKey: string,
  versions: string[],
  checkOnly: boolean,
): { updated: boolean; reason?: string } {
  const workflowPath = join(ROOT, '.github', 'workflows', `release-${dbKey}.yml`)

  if (!existsSync(workflowPath)) {
    return { updated: false, reason: 'workflow file not found' }
  }

  const content = readFileSync(workflowPath, 'utf-8')

  // Parse the YAML document while preserving structure
  const doc = parseDocument(content)

  // Navigate to inputs.version
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = doc.get('on') as any
  if (!on) return { updated: false, reason: 'no "on" key found' }

  const workflowDispatch = on.get('workflow_dispatch')
  if (!workflowDispatch) return { updated: false, reason: 'no workflow_dispatch trigger' }

  const inputs = workflowDispatch.get('inputs')
  if (!inputs) return { updated: false, reason: 'no inputs defined' }

  const versionInput = inputs.get('version')
  if (!versionInput) return { updated: false, reason: 'no version input' }

  // Check current type
  const inputType = versionInput.get('type')

  // Get current options if they exist
  const currentOptions = versionInput.get('options')
  const currentVersions: string[] = currentOptions
    ? (currentOptions.toJSON() as string[])
    : []

  // Check if versions match
  const versionsMatch =
    currentVersions.length === versions.length &&
    currentVersions.every((v, i) => v === versions[i])

  if (inputType === 'choice' && versionsMatch) {
    return { updated: false, reason: 'already in sync' }
  }

  if (checkOnly) {
    return { updated: true, reason: 'needs sync' }
  }

  // Update to choice type with options
  versionInput.set('type', 'choice')
  versionInput.set('options', versions)

  // Set default to first (newest) version
  if (versions.length > 0) {
    versionInput.set('default', versions[0])
  }

  // Update description to remove the "must be enabled" note since we have a dropdown
  const currentDesc = versionInput.get('description') as string
  if (currentDesc && currentDesc.includes('must be enabled')) {
    const dbName = currentDesc.split(' ')[0] // Get "MySQL", "PostgreSQL", etc.
    versionInput.set('description', `${dbName} version`)
  }

  // Write back
  const newContent = stringify(doc, {
    lineWidth: 0, // Don't wrap lines
    singleQuote: true,
  })

  writeFileSync(workflowPath, newContent)
  return { updated: true }
}

function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const specificDb = args.find((arg) => !arg.startsWith('--'))

  if (args.includes('--help') || args.includes('-h')) {
    log(`
${colors.cyan}sync-versions${colors.reset} - Sync workflow version dropdowns with databases.json

${colors.yellow}Usage:${colors.reset}
  pnpm sync:versions           # Sync all workflows
  pnpm sync:versions mysql     # Sync specific database
  pnpm sync:versions --check   # Check if sync needed (for CI)

${colors.yellow}What it does:${colors.reset}
  Updates the version dropdown options in .github/workflows/release-*.yml
  to match the enabled versions in databases.json.
`)
    process.exit(0)
  }

  const databases = loadDatabases()

  log('')
  log(`${colors.cyan}Syncing workflow version dropdowns${colors.reset}`)
  log('='.repeat(50))
  log('')

  let hasChanges = false
  let errorCount = 0

  // Get databases to process
  const dbsToProcess = specificDb
    ? [[specificDb, databases.databases[specificDb]] as const]
    : Object.entries(databases.databases).filter(
        ([, db]) => db.status === 'in-progress' || db.status === 'completed',
      )

  for (const [dbKey, db] of dbsToProcess) {
    if (!db) {
      logError(`Database '${dbKey}' not found in databases.json`)
      errorCount++
      continue
    }

    const versions = getEnabledVersions(db)

    if (versions.length === 0) {
      logWarning(`${dbKey}: no enabled versions`)
      continue
    }

    const result = updateWorkflowVersions(dbKey, versions, checkOnly)

    if (result.updated) {
      hasChanges = true
      if (checkOnly) {
        logWarning(`${dbKey}: ${result.reason} (${versions.join(', ')})`)
      } else {
        logSuccess(`${dbKey}: updated versions (${versions.join(', ')})`)
      }
    } else {
      logInfo(`${dbKey}: ${result.reason}`)
    }
  }

  log('')

  if (checkOnly && hasChanges) {
    logError('Workflows need version sync. Run: pnpm sync:versions')
    process.exit(1)
  }

  if (errorCount > 0) {
    process.exit(1)
  }

  if (hasChanges && !checkOnly) {
    logSuccess('Workflows updated!')
  } else if (!checkOnly) {
    logInfo('All workflows already in sync')
  }
}

main()
