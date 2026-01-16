#!/usr/bin/env tsx
/**
 * Reconciles releases.json with actual GitHub releases
 *
 * Usage:
 *   pnpm tsx scripts/reconcile-releases.ts [--dry-run]
 *
 * This script fetches all releases from GitHub and removes any entries
 * from releases.json that no longer exist in the repository.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  lastUpdated: string | null
  databases: Record<string, Record<string, VersionRelease>>
}

type GitHubRelease = {
  tag_name: string
  published_at: string
}

// Parse CLI arguments
function parseArgs(): { dryRun: boolean } {
  const args = process.argv.slice(2)
  let dryRun = false

  for (const arg of args) {
    switch (arg) {
      case '--dry-run':
        dryRun = true
        break
      case '--help':
      case '-h':
        console.log(`
Usage: pnpm tsx scripts/reconcile-releases.ts [options]

Options:
  --dry-run   Show what would be removed without making changes
  --help      Show this help
`)
        process.exit(0)
    }
  }

  return { dryRun }
}

// Fetch all releases from GitHub API (handles pagination)
async function fetchAllReleases(repo: string): Promise<Set<string>> {
  const releaseTags = new Set<string>()
  let page = 1
  const perPage = 100

  console.log(`Fetching releases from GitHub for ${repo}...`)

  while (true) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=${perPage}&page=${page}`
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'hostdb-release-reconciler',
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch releases: ${response.status}`)
    }

    const releases = (await response.json()) as GitHubRelease[]

    if (releases.length === 0) {
      break
    }

    for (const release of releases) {
      releaseTags.add(release.tag_name)
    }

    console.log(`  Fetched page ${page}: ${releases.length} releases`)

    if (releases.length < perPage) {
      break
    }

    page++
  }

  console.log(`  Total releases found: ${releaseTags.size}`)
  return releaseTags
}

async function main() {
  const { dryRun } = parseArgs()

  if (dryRun) {
    console.log('Running in dry-run mode (no changes will be made)\n')
  }

  // Load current releases.json
  const releasesPath = resolve(ROOT_DIR, 'releases.json')
  let releases: ReleasesManifest
  try {
    const content = readFileSync(releasesPath, 'utf-8')
    releases = JSON.parse(content) as ReleasesManifest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: Failed to parse ${releasesPath}: ${message}`)
    process.exit(1)
  }

  // Fetch all releases from GitHub
  const githubTags = await fetchAllReleases(releases.repository)

  // Track removals
  const removals: Array<{ database: string; version: string; tag: string }> = []

  // Check each entry in releases.json
  for (const [database, versions] of Object.entries(releases.databases)) {
    for (const [version, release] of Object.entries(versions)) {
      if (!githubTags.has(release.releaseTag)) {
        removals.push({
          database,
          version,
          tag: release.releaseTag,
        })
      }
    }
  }

  // Report findings
  if (removals.length === 0) {
    console.log(
      '\n✓ All entries in releases.json have matching GitHub releases',
    )
    return
  }

  console.log(`\nFound ${removals.length} stale entries:\n`)
  for (const { database, version, tag } of removals) {
    console.log(`  - ${database}/${version} (${tag})`)
  }

  if (dryRun) {
    console.log('\nDry run complete. No changes made.')
    return
  }

  // Remove stale entries
  for (const { database, version } of removals) {
    delete releases.databases[database][version]

    // Remove database key if empty
    if (Object.keys(releases.databases[database]).length === 0) {
      delete releases.databases[database]
    }
  }

  releases.lastUpdated = new Date().toISOString()

  // Write updated releases.json
  writeFileSync(releasesPath, JSON.stringify(releases, null, 2) + '\n')

  console.log(`\n✓ Removed ${removals.length} stale entries from releases.json`)
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
