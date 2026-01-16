#!/usr/bin/env tsx
/**
 * Updates releases.json with information from a GitHub Release
 *
 * Usage:
 *   pnpm tsx scripts/update-releases.ts --database mysql --version 8.4.3 --tag mysql-8.4.3
 *
 * This script is typically called by GitHub Actions after a release is created.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

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

// Parse CLI arguments
function parseArgs(): { database: string; version: string; tag: string } {
  const args = process.argv.slice(2)
  let database = ''
  let version = ''
  let tag = ''

  function getArgValue(flag: string, index: number): string {
    if (index + 1 >= args.length) {
      console.error(`Error: ${flag} requires a value`)
      process.exit(1)
    }
    const value = args[index + 1]
    if (value.startsWith('-')) {
      console.error(`Error: ${flag} requires a value, got "${value}"`)
      process.exit(1)
    }
    return value
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--database':
        database = getArgValue('--database', i)
        i++
        break
      case '--version':
        version = getArgValue('--version', i)
        i++
        break
      case '--tag':
        tag = getArgValue('--tag', i)
        i++
        break
      case '--help':
      case '-h':
        console.log(`
Usage: pnpm tsx scripts/update-releases.ts [options]

Options:
  --database NAME   Database name (e.g., mysql)
  --version VERSION Version string (e.g., 8.4.3)
  --tag TAG         GitHub release tag (e.g., mysql-8.4.3)
  --help            Show this help
`)
        process.exit(0)
    }
  }

  if (!database || !version || !tag) {
    console.error('Error: --database, --version, and --tag are required')
    process.exit(1)
  }

  return { database, version, tag }
}

// Fetch release info from GitHub API
async function fetchReleaseInfo(
  repo: string,
  tag: string,
): Promise<{
  assets: Array<{ name: string; browser_download_url: string; size: number }>
  published_at: string
}> {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'hostdb-release-updater',
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch release: ${response.status}`)
  }

  return response.json() as Promise<{
    assets: Array<{ name: string; browser_download_url: string; size: number }>
    published_at: string
  }>
}

// Parse checksums.txt content
async function fetchChecksums(
  repo: string,
  tag: string,
): Promise<Record<string, string>> {
  const url = `https://github.com/${repo}/releases/download/${tag}/checksums.txt`
  const response = await fetch(url)

  if (!response.ok) {
    console.warn('Warning: Could not fetch checksums.txt')
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

// Extract platform from filename
function extractPlatform(filename: string): Platform | null {
  const platforms: Platform[] = [
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
    'win32-x64',
  ]

  for (const platform of platforms) {
    if (filename.includes(platform)) {
      return platform
    }
  }

  return null
}

async function main() {
  const { database, version, tag } = parseArgs()

  console.log(`Updating releases.json for ${database} ${version} (${tag})`)

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

  // Fetch release info from GitHub
  console.log('Fetching release info from GitHub...')
  const releaseInfo = await fetchReleaseInfo(releases.repository, tag)

  // Fetch checksums
  console.log('Fetching checksums...')
  const checksums = await fetchChecksums(releases.repository, tag)

  // Build version release entry
  const versionRelease: VersionRelease = {
    version,
    releaseTag: tag,
    releasedAt: releaseInfo.published_at,
    platforms: {},
  }

  // Process assets
  for (const asset of releaseInfo.assets) {
    // Skip checksums.txt
    if (asset.name === 'checksums.txt') continue

    const platform = extractPlatform(asset.name)
    if (!platform) {
      console.warn(`Warning: Could not determine platform for ${asset.name}`)
      continue
    }

    const sha256 = checksums[asset.name]
    if (!sha256) {
      console.warn(`Warning: No checksum found for ${asset.name}`)
      continue
    }

    versionRelease.platforms[platform] = {
      url: asset.browser_download_url,
      sha256,
      size: asset.size,
    }

    console.log(`  ${platform}: ${asset.name}`)
  }

  // Update releases.json
  if (!releases.databases[database]) {
    releases.databases[database] = {}
  }

  releases.databases[database][version] = versionRelease
  releases.lastUpdated = new Date().toISOString()

  // Write updated releases.json
  writeFileSync(releasesPath, JSON.stringify(releases, null, 2) + '\n')

  console.log(`\nUpdated releases.json`)
  console.log(
    `  Platforms: ${Object.keys(versionRelease.platforms).join(', ')}`,
  )

  // Run reconciliation to remove any stale entries
  console.log('\nRunning reconciliation to validate releases...')
  try {
    execSync('pnpm tsx scripts/reconcile-releases.ts', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    })
  } catch {
    console.warn('Warning: Reconciliation failed, but release was updated')
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
