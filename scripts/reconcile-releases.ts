#!/usr/bin/env tsx
/**
 * Reconciles releases.json with actual GitHub releases
 *
 * Usage:
 *   pnpm tsx scripts/reconcile-releases.ts [--dry-run]
 *
 * This script fetches all releases from GitHub and:
 * - Removes entries from releases.json that no longer exist on GitHub
 * - Adds entries for GitHub releases that are missing from releases.json
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

const PLATFORMS: Platform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
]

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

type GitHubAsset = {
  name: string
  browser_download_url: string
  size: number
}

type GitHubRelease = {
  tag_name: string
  published_at: string
  assets: GitHubAsset[]
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
  --dry-run   Show what would be changed without making changes
  --help      Show this help
`)
        process.exit(0)
        break
    }
  }

  return { dryRun }
}

// Parse release tag to extract database and version
// Format: {database}-{version} e.g., "clickhouse-25.12.3.21", "mysql-8.4.3"
function parseReleaseTag(tag: string): { database: string; version: string } | null {
  // Find the first hyphen followed by a digit (start of version)
  const match = tag.match(/^(.+?)-(\d.*)$/)
  if (!match) {
    return null
  }
  return { database: match[1], version: match[2] }
}

// Extract platform from asset filename
function extractPlatform(filename: string): Platform | null {
  for (const platform of PLATFORMS) {
    if (filename.includes(platform)) {
      return platform
    }
  }
  return null
}

// Sort releases manifest for deterministic output
function sortReleasesManifest(releases: ReleasesManifest): ReleasesManifest {
  const sortedDatabases: Record<string, Record<string, VersionRelease>> = {}

  // Sort databases alphabetically
  const dbKeys = Object.keys(releases.databases).sort()

  for (const db of dbKeys) {
    const versions = releases.databases[db]
    const sortedVersions: Record<string, VersionRelease> = {}

    // Sort versions by semver descending (newest first)
    const versionKeys = Object.keys(versions).sort((a, b) => {
      const partsA = a.split('.').map((p) => parseInt(p, 10) || 0)
      const partsB = b.split('.').map((p) => parseInt(p, 10) || 0)
      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const diff = (partsB[i] || 0) - (partsA[i] || 0)
        if (diff !== 0) return diff
      }
      return 0
    })

    for (const version of versionKeys) {
      const release = versions[version]

      // Sort platforms alphabetically
      const sortedPlatforms: Partial<Record<Platform, PlatformAsset>> = {}
      const platformKeys = (Object.keys(release.platforms) as Platform[]).sort()

      for (const platform of platformKeys) {
        sortedPlatforms[platform] = release.platforms[platform]
      }

      sortedVersions[version] = {
        ...release,
        platforms: sortedPlatforms,
      }
    }

    sortedDatabases[db] = sortedVersions
  }

  return {
    ...releases,
    databases: sortedDatabases,
  }
}

// Fetch checksums.txt from a release
async function fetchChecksums(
  repo: string,
  tag: string,
): Promise<Record<string, string>> {
  const url = `https://github.com/${repo}/releases/download/${tag}/checksums.txt`
  const response = await fetch(url)

  if (!response.ok) {
    return {}
  }

  const content = await response.text()
  const checksums: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/)
    if (match) {
      checksums[match[2]] = match[1]
    }
  }

  return checksums
}

// Fetch all releases from GitHub API (handles pagination)
async function fetchAllReleases(repo: string): Promise<Map<string, GitHubRelease>> {
  const releases = new Map<string, GitHubRelease>()
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

    const releaseList = (await response.json()) as GitHubRelease[]

    if (releaseList.length === 0) {
      break
    }

    for (const release of releaseList) {
      releases.set(release.tag_name, release)
    }

    console.log(`  Fetched page ${page}: ${releaseList.length} releases`)

    if (releaseList.length < perPage) {
      break
    }

    page++
  }

  console.log(`  Total releases found: ${releases.size}`)
  return releases
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
  const githubReleases = await fetchAllReleases(releases.repository)

  // Build set of existing release tags in releases.json
  const existingTags = new Set<string>()
  for (const versions of Object.values(releases.databases)) {
    for (const release of Object.values(versions)) {
      existingTags.add(release.releaseTag)
    }
  }

  // Track removals (entries in releases.json but not on GitHub)
  const removals: Array<{ database: string; version: string; tag: string }> = []

  // Check each entry in releases.json
  for (const [database, versions] of Object.entries(releases.databases)) {
    for (const [version, release] of Object.entries(versions)) {
      if (!githubReleases.has(release.releaseTag)) {
        removals.push({
          database,
          version,
          tag: release.releaseTag,
        })
      }
    }
  }

  // Track additions (releases on GitHub but not in releases.json)
  const additions: Array<{ database: string; version: string; tag: string }> = []

  for (const [tag, _release] of githubReleases) {
    if (existingTags.has(tag)) {
      continue
    }

    const parsed = parseReleaseTag(tag)
    if (!parsed) {
      console.warn(`  Warning: Could not parse tag format: ${tag}`)
      continue
    }

    additions.push({
      database: parsed.database,
      version: parsed.version,
      tag,
    })
  }

  // Report findings
  let hasChanges = false

  if (removals.length > 0) {
    hasChanges = true
    console.log(`\nFound ${removals.length} stale entries to remove:\n`)
    for (const { database, version, tag } of removals) {
      console.log(`  - ${database}/${version} (${tag})`)
    }
  }

  if (additions.length > 0) {
    hasChanges = true
    console.log(`\nFound ${additions.length} missing releases to add:\n`)
    for (const { database, version, tag } of additions) {
      console.log(`  + ${database}/${version} (${tag})`)
    }
  }

  // Always sort for deterministic output, even if no additions/removals
  const sortedReleases = sortReleasesManifest(releases)
  const currentContent = readFileSync(releasesPath, 'utf-8')
  const sortedContent = JSON.stringify(sortedReleases, null, 2) + '\n'
  const needsReorder = currentContent !== sortedContent

  if (!hasChanges && !needsReorder) {
    console.log('\n✓ releases.json is in sync with GitHub releases')
    return
  }

  if (needsReorder && !hasChanges) {
    console.log('\nRe-ordering releases.json for consistent output...')
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

  // Add missing entries
  for (const { database, version, tag } of additions) {
    const githubRelease = githubReleases.get(tag)
    if (!githubRelease) continue

    console.log(`\nProcessing ${tag}...`)

    // Fetch checksums for this release
    const checksums = await fetchChecksums(releases.repository, tag)
    if (Object.keys(checksums).length === 0) {
      console.warn(`  Warning: No checksums.txt found for ${tag}, skipping`)
      continue
    }

    // Build version release entry
    const versionRelease: VersionRelease = {
      version,
      releaseTag: tag,
      releasedAt: githubRelease.published_at,
      platforms: {},
    }

    // Process assets
    let platformCount = 0
    for (const asset of githubRelease.assets) {
      // Skip checksums.txt
      if (asset.name === 'checksums.txt') continue

      const platform = extractPlatform(asset.name)
      if (!platform) {
        continue
      }

      const sha256 = checksums[asset.name]
      if (!sha256) {
        console.warn(`  Warning: No checksum found for ${asset.name}`)
        continue
      }

      versionRelease.platforms[platform] = {
        url: asset.browser_download_url,
        sha256,
        size: asset.size,
      }
      platformCount++
    }

    if (platformCount === 0) {
      console.warn(`  Warning: No valid platform assets found for ${tag}, skipping`)
      continue
    }

    // Add to releases
    if (!releases.databases[database]) {
      releases.databases[database] = {}
    }
    releases.databases[database][version] = versionRelease

    console.log(`  Added ${platformCount} platforms: ${Object.keys(versionRelease.platforms).join(', ')}`)
  }

  releases.lastUpdated = new Date().toISOString()

  // Sort for deterministic output and write
  const finalReleases = sortReleasesManifest(releases)
  writeFileSync(releasesPath, JSON.stringify(finalReleases, null, 2) + '\n')

  console.log('\n✓ Updated releases.json')
  if (removals.length > 0) {
    console.log(`  Removed ${removals.length} stale entries`)
  }
  if (additions.length > 0) {
    console.log(`  Added ${additions.length} missing releases`)
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
