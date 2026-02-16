#!/usr/bin/env tsx
/**
 * Interactive CLI for deleting releases from GitHub and/or Cloudflare R2.
 *
 * Supports deleting entire releases or specific platforms from a release.
 *
 * Interactive usage:
 *   pnpm delete:releases
 *   pnpm delete:releases -- --dry-run
 *
 * Non-interactive usage:
 *   pnpm delete:releases -- --database mysql --version 8.0.40 --from both --yes
 *   pnpm delete:releases -- --database mysql --version 8.0.40 --platform linux-arm64 --from r2 --yes
 *   pnpm delete:releases -- --database mysql --version 8.0.40 --from both --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkbox, select, confirm } from '@inquirer/prompts'
import ora from 'ora'
import chalk from 'chalk'
import {
  loadR2Config,
  createR2Client,
  deleteFromR2,
  listR2Objects,
  publishReleasesJson,
} from '../lib/r2.js'
import type { S3Client } from '@aws-sdk/client-s3'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')

type Platform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'

type PlatformAsset = {
  url: string
  sha256: string
  size: number
}

type VersionRelease = {
  version: string
  releaseTag: string
  releasedAt: string
  platforms: Partial<Record<Platform, PlatformAsset>>
}

type ReleasesManifest = {
  $schema: string
  repository: string
  databases: Record<string, Record<string, VersionRelease>>
}

type DeleteTarget = 'both' | 'github' | 'r2'

type CliArgs = {
  database: string | null
  version: string | null
  platform: Platform[]
  from: DeleteTarget | null
  yes: boolean
  dryRun: boolean
  help: boolean
}

type ReleaseSelection = {
  database: string
  version: string
  releaseTag: string
  platformCount: number
}

type DeletionItem = {
  database: string
  version: string
  releaseTag: string
  platforms: Platform[] | 'all'
}

const ALL_PLATFORMS: Platform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
]

function isValidPlatform(value: string): value is Platform {
  return ALL_PLATFORMS.includes(value as Platform)
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = {
    database: null,
    version: null,
    platform: [],
    from: null,
    yes: false,
    dryRun: false,
    help: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--database': {
        if (i + 1 >= args.length) {
          console.error('Error: --database requires a value')
          process.exit(1)
        }
        result.database = args[++i]
        break
      }
      case '--version': {
        if (i + 1 >= args.length) {
          console.error('Error: --version requires a value')
          process.exit(1)
        }
        result.version = args[++i]
        break
      }
      case '--platform': {
        if (i + 1 >= args.length) {
          console.error('Error: --platform requires a value')
          process.exit(1)
        }
        const value = args[++i]
        if (!isValidPlatform(value)) {
          console.error(
            `Error: invalid platform "${value}". Valid: ${ALL_PLATFORMS.join(', ')}`,
          )
          process.exit(1)
        }
        result.platform.push(value)
        break
      }
      case '--from': {
        if (i + 1 >= args.length) {
          console.error('Error: --from requires a value (both, github, r2)')
          process.exit(1)
        }
        const value = args[++i]
        if (value !== 'both' && value !== 'github' && value !== 'r2') {
          console.error(
            `Error: --from must be one of: both, github, r2 (got "${value}")`,
          )
          process.exit(1)
        }
        result.from = value
        break
      }
      case '--yes':
      case '-y':
        result.yes = true
        break
      case '--dry-run':
        result.dryRun = true
        break
      case '--help':
      case '-h':
        result.help = true
        break
      case '--':
        break
    }
  }

  return result
}

function printHelp(): void {
  console.log(`
Usage: pnpm delete:releases [options]

Interactive mode (default):
  pnpm delete:releases
  pnpm delete:releases -- --dry-run

Non-interactive mode:
  pnpm delete:releases -- --database mysql --version 8.0.40 --from both --yes
  pnpm delete:releases -- --database mysql --version 8.0.40 --platform linux-arm64 --from r2 --yes
  pnpm delete:releases -- --database mysql --version 8.0.40 --platform linux-arm64 --platform darwin-x64 --yes

Options:
  --database NAME       Database to delete release from (e.g., mysql)
  --version VERSION     Version to delete (e.g., 8.0.40)
  --platform PLATFORM   Specific platform to delete (can be repeated)
                        If omitted, deletes the entire release
                        Valid: ${ALL_PLATFORMS.join(', ')}
  --from TARGET         Where to delete from: both, github, r2 (default: both)
  --yes, -y             Skip confirmation prompt
  --dry-run             Preview what would be deleted without actually deleting
  --help, -h            Show this help
`)
}

function loadReleases(): ReleasesManifest {
  const releasesPath = resolve(ROOT_DIR, 'releases.json')
  return JSON.parse(readFileSync(releasesPath, 'utf-8')) as ReleasesManifest
}

function buildSelectionList(releases: ReleasesManifest): ReleaseSelection[] {
  const selections: ReleaseSelection[] = []

  for (const [db, versions] of Object.entries(releases.databases)) {
    for (const [version, release] of Object.entries(versions)) {
      selections.push({
        database: db,
        version,
        releaseTag: release.releaseTag,
        platformCount: Object.keys(release.platforms).length,
      })
    }
  }

  selections.sort((a, b) => {
    const dbCmp = a.database.localeCompare(b.database)
    if (dbCmp !== 0) return dbCmp
    return a.version.localeCompare(b.version)
  })

  return selections
}

function formatTargetLabel(target: DeleteTarget): string {
  switch (target) {
    case 'both':
      return 'GitHub and R2'
    case 'github':
      return 'GitHub only'
    case 'r2':
      return 'R2 only'
  }
}

function formatDeletionSummary(items: DeletionItem[]): string {
  const lines: string[] = []
  for (const item of items) {
    if (item.platforms === 'all') {
      lines.push(`  - ${item.database} ${item.version} (all platforms)`)
    } else {
      lines.push(
        `  - ${item.database} ${item.version} [${item.platforms.join(', ')}]`,
      )
    }
  }
  return lines.join('\n')
}

type GitHubAsset = {
  id: number
  name: string
  size: number
}

type GitHubRelease = {
  id: number
  assets: GitHubAsset[]
}

function getGitHubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is required for GitHub operations. Set it via environment variable.',
    )
  }
  return {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'hostdb-delete-releases',
  }
}

async function fetchGitHubRelease(
  repo: string,
  tag: string,
): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  const response = await fetch(url, { headers: getGitHubHeaders() })

  if (response.status === 404) {
    throw new Error(`GitHub release not found for tag: ${tag}`)
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub release: ${response.status}`)
  }

  return response.json() as Promise<GitHubRelease>
}

async function deleteGitHubRelease(repo: string, tag: string): Promise<void> {
  const release = await fetchGitHubRelease(repo, tag)
  const url = `https://api.github.com/repos/${repo}/releases/${release.id}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: getGitHubHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Failed to delete GitHub release: ${response.status}`)
  }
}

async function deleteGitHubReleaseAssets(
  repo: string,
  tag: string,
  platforms: Platform[],
): Promise<number> {
  const release = await fetchGitHubRelease(repo, tag)
  let deleted = 0

  for (const asset of release.assets) {
    const matchesPlatform = platforms.some((p) => asset.name.includes(p))
    if (!matchesPlatform) continue

    const url = `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getGitHubHeaders(),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to delete asset ${asset.name}: ${response.status}`,
      )
    }
    deleted++
  }

  return deleted
}

async function deleteR2Release(options: {
  client: S3Client
  bucket: string
  tag: string
}): Promise<number> {
  const { client, bucket, tag } = options
  const keys = await listR2Objects({ client, bucket, prefix: `${tag}/` })

  for (const key of keys) {
    await deleteFromR2({ client, bucket, key })
  }

  return keys.length
}

async function deleteR2ReleasePlatforms(options: {
  client: S3Client
  bucket: string
  tag: string
  platforms: Platform[]
}): Promise<number> {
  const { client, bucket, tag, platforms } = options
  const keys = await listR2Objects({ client, bucket, prefix: `${tag}/` })
  let deleted = 0

  for (const key of keys) {
    const matchesPlatform = platforms.some((p) => key.includes(p))
    if (!matchesPlatform) continue

    await deleteFromR2({ client, bucket, key })
    deleted++
  }

  return deleted
}

async function countR2Files(options: {
  client: S3Client
  bucket: string
  tag: string
  platforms: Platform[] | 'all'
}): Promise<number> {
  const { client, bucket, tag, platforms } = options
  const keys = await listR2Objects({ client, bucket, prefix: `${tag}/` })

  if (platforms === 'all') return keys.length
  return keys.filter((key) => platforms.some((p) => key.includes(p))).length
}

async function runInteractive(
  releases: ReleasesManifest,
  dryRun: boolean,
): Promise<void> {
  const selections = buildSelectionList(releases)

  if (selections.length === 0) {
    console.log(chalk.yellow('No releases found in releases.json'))
    return
  }

  // Step 1: Select releases
  const selected = await checkbox<ReleaseSelection>({
    message: 'Select releases to delete:',
    choices: selections.map((s) => ({
      name: `${s.database} ${s.version} (${s.platformCount} platform${s.platformCount === 1 ? '' : 's'})`,
      value: s,
    })),
  })

  if (selected.length === 0) {
    console.log(chalk.yellow('No releases selected'))
    return
  }

  // Step 2: Scope — entire release or specific platforms?
  const scope = await select<'all' | 'specific'>({
    message: 'Delete scope:',
    choices: [
      {
        name: 'Entire releases (all platforms)',
        value: 'all' as const,
      },
      {
        name: 'Specific platforms',
        value: 'specific' as const,
      },
    ],
  })

  // Step 3: If specific platforms, pick per release
  const items: DeletionItem[] = []

  if (scope === 'all') {
    for (const s of selected) {
      items.push({
        database: s.database,
        version: s.version,
        releaseTag: s.releaseTag,
        platforms: 'all',
      })
    }
  } else {
    for (const s of selected) {
      const release = releases.databases[s.database]?.[s.version]
      if (!release) continue

      const availablePlatforms = Object.keys(release.platforms) as Platform[]

      const chosen = await checkbox<Platform>({
        message: `${s.database} ${s.version} — select platforms to delete:`,
        choices: availablePlatforms.map((p) => ({
          name: p,
          value: p,
        })),
      })

      if (chosen.length === 0) continue

      // If they selected all available platforms, treat as full release deletion
      const isAll = chosen.length === availablePlatforms.length
      items.push({
        database: s.database,
        version: s.version,
        releaseTag: s.releaseTag,
        platforms: isAll ? 'all' : chosen,
      })
    }
  }

  if (items.length === 0) {
    console.log(chalk.yellow('No platforms selected'))
    return
  }

  // Step 4: Delete target
  const target = await select<DeleteTarget>({
    message: 'Delete from:',
    choices: [
      {
        name: 'Both GitHub and R2 (recommended)',
        value: 'both' as const,
      },
      { name: 'GitHub only', value: 'github' as const },
      { name: 'R2 only', value: 'r2' as const },
    ],
  })

  await executeDelete({ releases, items, target, dryRun })
}

async function runNonInteractive(
  releases: ReleasesManifest,
  args: CliArgs,
): Promise<void> {
  if (!args.database || !args.version) {
    console.error(
      'Error: --database and --version are required in non-interactive mode',
    )
    process.exit(1)
  }

  const target = args.from ?? 'both'
  const db = releases.databases[args.database]

  if (!db) {
    console.error(
      `Error: Database "${args.database}" not found in releases.json`,
    )
    process.exit(1)
  }

  const release = db[args.version]
  if (!release) {
    console.error(
      `Error: Version "${args.version}" not found for ${args.database} in releases.json`,
    )
    process.exit(1)
  }

  // Validate requested platforms exist in the release
  if (args.platform.length > 0) {
    const available = Object.keys(release.platforms) as Platform[]
    for (const p of args.platform) {
      if (!available.includes(p)) {
        console.error(
          `Error: Platform "${p}" not found in ${args.database} ${args.version}. Available: ${available.join(', ')}`,
        )
        process.exit(1)
      }
    }
  }

  const platforms: Platform[] | 'all' =
    args.platform.length > 0 ? args.platform : 'all'

  const item: DeletionItem = {
    database: args.database,
    version: args.version,
    releaseTag: release.releaseTag,
    platforms,
  }

  if (!args.yes && !args.dryRun) {
    const label =
      platforms === 'all'
        ? `${args.database} ${args.version} (all platforms)`
        : `${args.database} ${args.version} [${platforms.join(', ')}]`
    const proceed = await confirm({
      message: `Delete ${label} from ${formatTargetLabel(target)}?`,
      default: false,
    })

    if (!proceed) {
      console.log(chalk.yellow('Cancelled'))
      return
    }
  }

  await executeDelete({
    releases,
    items: [item],
    target,
    dryRun: args.dryRun,
    skipConfirm: args.yes,
  })
}

async function executeDelete(options: {
  releases: ReleasesManifest
  items: DeletionItem[]
  target: DeleteTarget
  dryRun: boolean
  skipConfirm?: boolean
}): Promise<void> {
  const { releases, items, target, dryRun, skipConfirm } = options
  const prefix = dryRun ? chalk.cyan('[dry-run] ') : ''

  // Show summary
  console.log('')
  if (dryRun) {
    console.log(chalk.cyan('DRY RUN — no changes will be made\n'))
  }

  const totalLabel = items.reduce((n, item) => {
    return n + (item.platforms === 'all' ? 1 : item.platforms.length)
  }, 0)

  console.log(
    chalk.yellow(
      `⚠ This will delete ${items.length} release${items.length === 1 ? '' : 's'} (${totalLabel} target${totalLabel === 1 ? '' : 's'}):`,
    ),
  )
  console.log(formatDeletionSummary(items))
  console.log(`  From: ${formatTargetLabel(target)}`)
  console.log('')

  if (!dryRun && !skipConfirm) {
    const proceed = await confirm({
      message: 'Proceed?',
      default: false,
    })

    if (!proceed) {
      console.log(chalk.yellow('Cancelled'))
      return
    }
    console.log('')
  }

  // Initialize clients as needed
  let r2Client: S3Client | null = null
  let r2Bucket = ''
  const needsR2 = target === 'both' || target === 'r2'
  const needsGitHub = target === 'both' || target === 'github'

  if (needsR2 && !dryRun) {
    const r2Config = loadR2Config()
    r2Client = createR2Client(r2Config)
    r2Bucket = r2Config.bucket
  }

  if (needsGitHub && !dryRun && !process.env.GITHUB_TOKEN) {
    console.error(
      chalk.red('Error: GITHUB_TOKEN is required for GitHub release deletion'),
    )
    process.exit(1)
  }

  // Track failures
  const failures: string[] = []

  // Delete each item
  for (const item of items) {
    const isFullDelete = item.platforms === 'all'
    const label = isFullDelete
      ? `${item.database} ${item.version}`
      : `${item.database} ${item.version} [${(item.platforms as Platform[]).join(', ')}]`

    // Delete from GitHub
    if (needsGitHub) {
      const spinner = ora(`${prefix}Deleting ${label} from GitHub...`).start()
      try {
        if (item.platforms === 'all') {
          if (dryRun) {
            spinner.succeed(
              `${prefix}Would delete GitHub release ${item.releaseTag}`,
            )
          } else {
            await deleteGitHubRelease(releases.repository, item.releaseTag)
            spinner.succeed(`Deleted GitHub release ${item.releaseTag}`)
          }
        } else {
          if (dryRun) {
            spinner.succeed(
              `${prefix}Would delete ${item.platforms.length} asset${item.platforms.length === 1 ? '' : 's'} from GitHub release ${item.releaseTag}`,
            )
          } else {
            const count = await deleteGitHubReleaseAssets(
              releases.repository,
              item.releaseTag,
              item.platforms,
            )
            spinner.succeed(
              `Deleted ${count} asset${count === 1 ? '' : 's'} from GitHub release ${item.releaseTag}`,
            )
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        spinner.fail(`Failed to delete from GitHub: ${msg}`)
        failures.push(`GitHub: ${item.releaseTag}`)
      }
    }

    // Delete from R2
    if (needsR2) {
      const spinner = ora(`${prefix}Deleting ${label} from R2...`).start()
      try {
        if (dryRun) {
          if (r2Client) {
            const count = await countR2Files({
              client: r2Client,
              bucket: r2Bucket,
              tag: item.releaseTag,
              platforms: item.platforms,
            })
            spinner.succeed(
              `${prefix}Would delete ${count} file${count === 1 ? '' : 's'} from R2`,
            )
          } else {
            spinner.succeed(
              `${prefix}Would delete files from R2 (skipped listing — no credentials)`,
            )
          }
        } else if (item.platforms === 'all') {
          const count = await deleteR2Release({
            client: r2Client!,
            bucket: r2Bucket,
            tag: item.releaseTag,
          })
          spinner.succeed(
            `Deleted ${count} file${count === 1 ? '' : 's'} from R2`,
          )
        } else {
          const count = await deleteR2ReleasePlatforms({
            client: r2Client!,
            bucket: r2Bucket,
            tag: item.releaseTag,
            platforms: item.platforms,
          })
          spinner.succeed(
            `Deleted ${count} file${count === 1 ? '' : 's'} from R2`,
          )
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        spinner.fail(`Failed to delete from R2: ${msg}`)
        failures.push(`R2: ${item.releaseTag}`)
      }
    }
  }

  // If any deletions failed, don't update releases.json
  if (failures.length > 0) {
    console.log('')
    console.log(
      chalk.red(
        `${failures.length} deletion${failures.length === 1 ? '' : 's'} failed:`,
      ),
    )
    for (const f of failures) {
      console.log(chalk.red(`  - ${f}`))
    }
    console.log(chalk.red('\nreleases.json was NOT updated due to failures.'))
    process.exit(1)
  }

  // Update releases.json
  const releasesPath = resolve(ROOT_DIR, 'releases.json')
  let removedEntries = 0
  let removedPlatforms = 0

  for (const item of items) {
    const db = releases.databases[item.database]
    if (!db) continue

    if (item.platforms === 'all') {
      delete db[item.version]
      removedEntries++
      if (Object.keys(db).length === 0) {
        delete releases.databases[item.database]
      }
    } else {
      const release = db[item.version]
      if (!release) continue
      for (const p of item.platforms) {
        if (release.platforms[p]) {
          delete release.platforms[p]
          removedPlatforms++
        }
      }
      // If no platforms remain, remove the entire version
      if (Object.keys(release.platforms).length === 0) {
        delete db[item.version]
        removedEntries++
        if (Object.keys(db).length === 0) {
          delete releases.databases[item.database]
        }
      }
    }
  }

  const summaryParts: string[] = []
  if (removedEntries > 0) {
    summaryParts.push(
      `removed ${removedEntries} release${removedEntries === 1 ? '' : 's'}`,
    )
  }
  if (removedPlatforms > 0) {
    summaryParts.push(
      `removed ${removedPlatforms} platform${removedPlatforms === 1 ? '' : 's'}`,
    )
  }
  const summary = summaryParts.join(', ')

  if (dryRun) {
    console.log(`\n${prefix}Would update releases.json (${summary})`)
  } else {
    writeFileSync(releasesPath, JSON.stringify(releases, null, 2) + '\n')
    console.log(chalk.green(`\n✓ Updated releases.json (${summary})`))
  }

  // Publish updated releases.json to R2
  if (needsR2 && r2Client) {
    if (dryRun) {
      console.log(`${prefix}Would publish releases.json to R2`)
    } else {
      const publishSpinner = ora('Publishing releases.json to R2...').start()
      try {
        await publishReleasesJson({
          client: r2Client,
          bucket: r2Bucket,
          rootDir: ROOT_DIR,
        })
        publishSpinner.succeed('Published releases.json to R2')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        publishSpinner.fail(`Failed to publish releases.json to R2: ${msg}`)
      }
    }
  }
}

async function main() {
  const args = parseArgs()

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const releases = loadReleases()
  const isInteractive = !args.database && !args.version

  if (isInteractive) {
    await runInteractive(releases, args.dryRun)
  } else {
    await runNonInteractive(releases, args)
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
