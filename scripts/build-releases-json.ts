#!/usr/bin/env tsx
/**
 * Build releases.json from GitHub releases
 *
 * This is the single source of truth for building releases.json.
 * It fetches all releases from the GitHub API, builds the complete
 * manifest, writes it to disk, and optionally uploads to R2.
 *
 * Usage:
 *   pnpm tsx scripts/build-releases-json.ts              # Rebuild releases.json
 *   pnpm tsx scripts/build-releases-json.ts --upload-r2   # Rebuild and upload to R2
 *   pnpm tsx scripts/build-releases-json.ts --dry-run     # Show what would change
 *   pnpm tsx scripts/build-releases-json.ts --check       # Exit 1 if out of date
 *
 * Called by:
 *   - GitHub Actions (after each release build)
 *   - pnpm prep (local development)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseChecksums } from '../lib/checksums.js'
import { getDownloadUrl } from '../lib/registry.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')

const REPO = 'robertjbass/hostdb'

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
  databases: Record<string, Record<string, VersionRelease>>
}

type GitHubAsset = {
  id: number
  name: string
  browser_download_url: string
  size: number
}

type GitHubRelease = {
  tag_name: string
  published_at: string
  assets: GitHubAsset[]
}

type Args = {
  uploadR2: boolean
  dryRun: boolean
  check: boolean
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let uploadR2 = false
  let dryRun = false
  let check = false

  for (const arg of args) {
    switch (arg) {
      case '--upload-r2':
        uploadR2 = true
        break
      case '--dry-run':
        dryRun = true
        break
      case '--check':
        check = true
        break
      case '--':
        break
      case '--help':
      case '-h':
        console.log(`
Usage: pnpm tsx scripts/build-releases-json.ts [options]

Options:
  --upload-r2   Upload releases.json to R2 after building
  --dry-run     Show what would change without writing
  --check       Exit 1 if releases.json is out of date
  --help        Show this help
`)
        process.exit(0)
        break
    }
  }

  return { uploadR2, dryRun, check }
}

/** Parse release tag to extract database and version */
function parseReleaseTag(
  tag: string,
): { database: string; version: string } | null {
  const match = tag.match(/^(.+?)-(\d.*)$/)
  if (!match) return null
  return { database: match[1], version: match[2] }
}

/** Extract platform from asset filename */
function extractPlatform(filename: string): Platform | null {
  for (const platform of PLATFORMS) {
    if (filename.includes(platform)) return platform
  }
  return null
}

/** Sort releases manifest for deterministic output */
function sortManifest(releases: ReleasesManifest): ReleasesManifest {
  const sortedDatabases: Record<string, Record<string, VersionRelease>> = {}

  for (const db of Object.keys(releases.databases).sort()) {
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
      const sortedPlatforms: Partial<Record<Platform, PlatformAsset>> = {}
      for (const platform of (
        Object.keys(release.platforms) as Platform[]
      ).sort()) {
        sortedPlatforms[platform] = release.platforms[platform]
      }
      sortedVersions[version] = { ...release, platforms: sortedPlatforms }
    }

    sortedDatabases[db] = sortedVersions
  }

  return { ...releases, databases: sortedDatabases }
}

/** Fetch all releases from GitHub API with pagination */
async function fetchAllReleases(): Promise<Map<string, GitHubRelease>> {
  const releases = new Map<string, GitHubRelease>()
  let page = 1
  const perPage = 100

  console.log(`Fetching releases from GitHub for ${REPO}...`)

  while (true) {
    const url = `https://api.github.com/repos/${REPO}/releases?per_page=${perPage}&page=${page}`
    const response = await fetch(url, { headers: githubHeaders() })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch releases (page ${page}): ${response.status}`,
      )
    }

    const batch = (await response.json()) as GitHubRelease[]
    if (batch.length === 0) break

    for (const release of batch) {
      releases.set(release.tag_name, release)
    }

    console.log(`  Page ${page}: ${batch.length} releases`)

    if (batch.length < perPage) break
    page++
  }

  console.log(`  Total: ${releases.size} releases`)
  return releases
}

/** GitHub API auth headers */
function githubHeaders(
  accept = 'application/vnd.github.v3+json',
): Record<string, string> {
  return {
    Accept: accept,
    'User-Agent': 'hostdb-build-releases',
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  }
}

/**
 * Download checksums.txt directly from a release's assets.
 * Uses the asset data we already have to avoid extra API calls.
 * Falls back to browser_download_url (CDN, no rate limit) first,
 * then API asset download if needed.
 */
async function downloadChecksums(
  checksumAsset: GitHubAsset,
): Promise<Record<string, string>> {
  // Try browser_download_url first — goes to CDN, no API rate limit
  const cdnResponse = await fetch(checksumAsset.browser_download_url, {
    headers: { 'User-Agent': 'hostdb-build-releases' },
    redirect: 'follow',
  })

  if (cdnResponse.ok) {
    return parseChecksums(await cdnResponse.text())
  }

  // Fallback: API asset download (counts against rate limit but handles private repos)
  const apiUrl = `https://api.github.com/repos/${REPO}/releases/assets/${checksumAsset.id}`
  const apiResponse = await fetch(apiUrl, {
    headers: githubHeaders('application/octet-stream'),
    redirect: 'follow',
  })

  if (apiResponse.ok) {
    return parseChecksums(await apiResponse.text())
  }

  return {}
}

/** Build a VersionRelease entry from a GitHub release */
async function buildVersionRelease(
  ghRelease: GitHubRelease,
  tag: string,
  version: string,
): Promise<VersionRelease | null> {
  const checksumAsset = ghRelease.assets.find(
    (a) => a.name === 'checksums.txt',
  )
  if (!checksumAsset) {
    console.warn(`  Warning: No checksums.txt in ${tag}, skipping`)
    return null
  }

  const checksums = await downloadChecksums(checksumAsset)
  if (Object.keys(checksums).length === 0) {
    console.warn(`  Warning: Failed to download checksums for ${tag}, skipping`)
    return null
  }

  const versionRelease: VersionRelease = {
    version,
    releaseTag: tag,
    releasedAt: ghRelease.published_at,
    platforms: {},
  }

  for (const asset of ghRelease.assets) {
    if (asset.name === 'checksums.txt') continue

    const platform = extractPlatform(asset.name)
    if (!platform) continue

    const sha256 = checksums[asset.name]
    if (!sha256) {
      console.warn(`  Warning: No checksum for ${asset.name}`)
      continue
    }

    versionRelease.platforms[platform] = {
      url: getDownloadUrl(tag, asset.name),
      sha256,
      size: asset.size,
    }
  }

  if (Object.keys(versionRelease.platforms).length === 0) {
    console.warn(`  Warning: No valid platform assets for ${tag}, skipping`)
    return null
  }

  return versionRelease
}

async function main() {
  const { uploadR2, dryRun, check } = parseArgs()

  if (dryRun) {
    console.log('Dry-run mode: no files will be written\n')
  }

  // Fetch all GitHub releases
  const ghReleases = await fetchAllReleases()

  // Build the complete manifest from scratch
  const manifest: ReleasesManifest = {
    $schema: './schemas/releases.schema.json',
    repository: REPO,
    databases: {},
  }

  // Process each release
  let processed = 0
  let skipped = 0

  for (const [tag, ghRelease] of ghReleases) {
    const parsed = parseReleaseTag(tag)
    if (!parsed) {
      console.warn(`  Skipping unparseable tag: ${tag}`)
      skipped++
      continue
    }

    const { database, version } = parsed
    const entry = await buildVersionRelease(ghRelease, tag, version)

    if (!entry) {
      skipped++
      continue
    }

    if (!manifest.databases[database]) {
      manifest.databases[database] = {}
    }
    manifest.databases[database][version] = entry
    processed++
  }

  console.log(`\nProcessed ${processed} releases (${skipped} skipped)`)

  // Sort for deterministic output
  const sorted = sortManifest(manifest)
  const newContent = JSON.stringify(sorted, null, 2) + '\n'

  // Compare with existing
  const releasesPath = resolve(ROOT_DIR, 'releases.json')
  let currentContent = ''
  if (existsSync(releasesPath)) {
    currentContent = readFileSync(releasesPath, 'utf-8')
  }

  if (currentContent === newContent) {
    console.log('\n✓ releases.json is already up to date')
  } else if (check) {
    console.log('\n✗ releases.json is out of date. Run: pnpm build:releases')
    process.exit(1)
  } else if (dryRun) {
    console.log('\nDry run: releases.json would be updated')
  } else {
    writeFileSync(releasesPath, newContent)
    console.log('\n✓ Updated releases.json')
  }

  // Stats
  const dbCount = Object.keys(sorted.databases).length
  const versionCount = Object.values(sorted.databases).reduce(
    (sum, versions) => sum + Object.keys(versions).length,
    0,
  )
  console.log(`  ${dbCount} databases, ${versionCount} versions`)

  // Upload to R2 if requested
  if (uploadR2 && !dryRun && !check) {
    // Regenerate databases.json from databases.yml to ensure it's fresh
    const { generateDatabasesJson } = await import('../lib/databases.js')
    const dbChanged = generateDatabasesJson({ rootDir: ROOT_DIR })
    if (dbChanged) {
      console.log('\n✓ Regenerated databases.json from databases.yml')
    }

    const { loadR2Config, createR2Client, publishJsonToR2 } = await import(
      '../lib/r2.js'
    )
    const config = loadR2Config()
    const client = createR2Client(config)
    const r2Opts = { client, bucket: config.bucket, rootDir: ROOT_DIR }

    const files = ['releases.json', 'databases.json', 'downloads.json']
    for (const filename of files) {
      console.log(`\nUploading ${filename} to R2...`)
      await publishJsonToR2({ ...r2Opts, filename })
      console.log(`✓ Published ${filename} to R2`)
    }
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
