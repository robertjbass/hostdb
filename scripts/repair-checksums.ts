#!/usr/bin/env tsx
/**
 * Repair incomplete checksums.txt files on GitHub releases
 *
 * Scans all releases and fixes any that have binaries without checksums.
 *
 * Usage:
 *   pnpm tsx scripts/repair-checksums.ts [--dry-run]
 *   pnpm tsx scripts/repair-checksums.ts --release valkey-9.0.1
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs'
import { fetchChecksums } from '../lib/checksums.js'

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

const REPO = 'robertjbass/hostdb'

// Validate release tag format (alphanumeric, dots, hyphens, underscores only)
const VALID_TAG_PATTERN = /^[A-Za-z0-9_.-]+$/

function parseArgs(): { dryRun: boolean; releaseTag: string | null } {
  const args = process.argv.slice(2)
  let dryRun = false
  let releaseTag: string | null = null

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        dryRun = true
        break
      case '--release': {
        const nextArg = args[i + 1]
        if (!nextArg || nextArg.startsWith('-')) {
          console.error(
            'Error: --release requires a tag argument (e.g., --release valkey-9.0.1)',
          )
          process.exit(1)
        }
        if (!VALID_TAG_PATTERN.test(nextArg)) {
          console.error(`Error: Invalid release tag format: ${nextArg}`)
          console.error(
            'Tags must contain only alphanumeric characters, dots, hyphens, and underscores',
          )
          process.exit(1)
        }
        releaseTag = nextArg
        i++
        break
      }
      case '--help':
      case '-h':
        console.log(`
Usage: pnpm tsx scripts/repair-checksums.ts [options]

Options:
  --dry-run           Show what would be fixed without making changes
  --release <tag>     Only check/fix a specific release (e.g., valkey-9.0.1)
  --help              Show this help
`)
        process.exit(0)
    }
  }

  return { dryRun, releaseTag }
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

// Compute SHA256 of a remote file by streaming
async function computeRemoteSha256(url: string): Promise<string> {
  console.log(`    Downloading and computing SHA256...`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error(`No response body for ${url}`)
  }

  const hash = createHash('sha256')
  let bytesRead = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
    bytesRead += value.length
  }

  console.log(`    Downloaded ${(bytesRead / 1024 / 1024).toFixed(1)} MB`)
  return hash.digest('hex')
}

// Fetch all releases from GitHub API
async function fetchAllReleases(): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const url = `https://api.github.com/repos/${REPO}/releases?per_page=${perPage}&page=${page}`
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'hostdb-checksum-repair',
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch releases: ${response.status}`)
    }

    const releaseList = (await response.json()) as GitHubRelease[]

    if (releaseList.length === 0) break

    releases.push(...releaseList)

    if (releaseList.length < perPage) break
    page++
  }

  return releases
}

// Upload new checksums.txt to a release using gh CLI
function uploadChecksums(tag: string, checksums: Map<string, string>): void {
  // Build checksums.txt content
  const lines: string[] = []
  const sortedKeys = [...checksums.keys()].sort()
  for (const filename of sortedKeys) {
    lines.push(`${checksums.get(filename)}  ${filename}`)
  }
  const content = lines.join('\n') + '\n'

  // Write to temp file named checksums.txt
  const tmpDir = `/tmp/hostdb-checksums-${Date.now()}`
  const tmpFile = `${tmpDir}/checksums.txt`
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(tmpFile, content)

  // Delete existing checksums.txt if present
  try {
    execFileSync(
      'gh',
      [
        'release',
        'delete-asset',
        tag,
        'checksums.txt',
        '--repo',
        REPO,
        '--yes',
      ],
      {
        stdio: 'pipe',
      },
    )
    console.log(`    Deleted old checksums.txt`)
  } catch {
    // Asset might not exist
  }

  // Also delete any incorrectly named checksum files from previous runs
  try {
    execFileSync(
      'gh',
      [
        'release',
        'delete-asset',
        tag,
        `checksums-${tag}.txt`,
        '--repo',
        REPO,
        '--yes',
      ],
      {
        stdio: 'pipe',
      },
    )
    console.log(`    Deleted incorrectly named checksums-${tag}.txt`)
  } catch {
    // Asset might not exist
  }

  // Upload new checksums.txt (file must be named checksums.txt for gh to use that name)
  execFileSync('gh', ['release', 'upload', tag, tmpFile, '--repo', REPO], {
    stdio: 'inherit',
  })

  // Cleanup
  unlinkSync(tmpFile)
  rmdirSync(tmpDir)
}

async function main() {
  const { dryRun, releaseTag } = parseArgs()

  if (dryRun) {
    console.log('Running in dry-run mode (no changes will be made)\n')
  }

  console.log(`Fetching releases from ${REPO}...`)
  let releases = await fetchAllReleases()
  console.log(`Found ${releases.length} releases\n`)

  // Filter to specific release if requested
  if (releaseTag) {
    releases = releases.filter((r) => r.tag_name === releaseTag)
    if (releases.length === 0) {
      console.error(`Release '${releaseTag}' not found`)
      process.exit(1)
    }
  }

  let fixedCount = 0
  let hasErrors = false

  for (const release of releases) {
    const tag = release.tag_name

    // Get binary assets (exclude checksums.txt)
    const binaryAssets = release.assets.filter(
      (a) => a.name !== 'checksums.txt' && extractPlatform(a.name) !== null,
    )

    if (binaryAssets.length === 0) {
      continue // No platform binaries in this release
    }

    // Fetch existing checksums (shared module returns Record, convert to Map)
    const existingChecksumsRecord = await fetchChecksums(REPO, tag)
    const existingChecksums = new Map(Object.entries(existingChecksumsRecord))

    // Find missing checksums
    const missingAssets = binaryAssets.filter(
      (a) => !existingChecksums.has(a.name),
    )

    if (missingAssets.length === 0) {
      continue // All checksums present
    }

    console.log(`\n${tag}: missing ${missingAssets.length} checksum(s)`)
    for (const asset of missingAssets) {
      console.log(`  - ${asset.name}`)
    }

    if (dryRun) {
      continue
    }

    // Compute missing checksums, tracking any failures
    const updatedChecksums = new Map(existingChecksums)
    const failedAssets: string[] = []

    for (const asset of missingAssets) {
      console.log(`  Computing checksum for ${asset.name}...`)
      try {
        const sha256 = await computeRemoteSha256(asset.browser_download_url)
        updatedChecksums.set(asset.name, sha256)
        console.log(`    ${sha256}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`    Error: ${message}`)
        failedAssets.push(asset.name)
      }
    }

    // Abort upload if any checksum computation failed
    if (failedAssets.length > 0) {
      console.error(
        `  Skipping upload due to ${failedAssets.length} failed checksum(s):`,
      )
      for (const name of failedAssets) {
        console.error(`    - ${name}`)
      }
      hasErrors = true
      continue
    }

    // Upload updated checksums.txt
    console.log(`  Uploading updated checksums.txt...`)
    uploadChecksums(tag, updatedChecksums)
    console.log(`  Done!`)
    fixedCount++
  }

  console.log('')
  if (dryRun) {
    console.log(`Dry run complete. Run without --dry-run to fix.`)
  } else if (fixedCount > 0) {
    console.log(`Fixed ${fixedCount} release(s)`)
  } else {
    console.log('All releases have complete checksums')
  }

  if (hasErrors) {
    console.error(
      '\nSome releases had checksum computation failures and were skipped.',
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
