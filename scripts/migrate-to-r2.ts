#!/usr/bin/env tsx
/**
 * One-time bulk migration of GitHub Release binaries to Cloudflare R2.
 *
 * Reads releases.json, downloads each asset from GitHub, uploads to R2,
 * then rewrites all URLs to point to the R2 registry.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-to-r2.ts [--dry-run] [--database mysql] [--concurrency 3]
 *
 * Required env vars: GITHUB_TOKEN, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *                    R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadR2Config, createR2Client, uploadToR2, objectExists } from '../lib/r2.js'
import { getDownloadUrl } from '../lib/registry.js'
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

type MigrateArgs = {
  dryRun: boolean
  database: string | null
  concurrency: number
}

function parseArgs(): MigrateArgs {
  const args = process.argv.slice(2)
  let dryRun = false
  let database: string | null = null
  let concurrency = 3

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        dryRun = true
        break
      case '--database':
        if (i + 1 >= args.length) {
          console.error('Error: --database requires a value')
          process.exit(1)
        }
        database = args[++i]
        break
      case '--concurrency':
        if (i + 1 >= args.length) {
          console.error('Error: --concurrency requires a value')
          process.exit(1)
        }
        concurrency = parseInt(args[++i], 10)
        if (isNaN(concurrency) || concurrency < 1) {
          console.error('Error: --concurrency must be a positive integer')
          process.exit(1)
        }
        break
      case '--':
        break
      case '--help':
      case '-h':
        console.log(`
Usage: pnpm tsx scripts/migrate-to-r2.ts [options]

Options:
  --dry-run           Preview what would be migrated (no uploads or writes)
  --database NAME     Migrate only a specific database (e.g., mysql)
  --concurrency N     Parallel uploads (default: 3)
  --help              Show this help

Required env vars:
  GITHUB_TOKEN         GitHub token for API access (private repo)
  R2_ACCOUNT_ID        Cloudflare account ID
  R2_ACCESS_KEY_ID     R2 API token access key
  R2_SECRET_ACCESS_KEY R2 API token secret key
  R2_BUCKET_NAME       R2 bucket name
`)
        process.exit(0)
        break // unreachable, but required for no-fallthrough rule
    }
  }

  return { dryRun, database, concurrency }
}

type GitHubAsset = {
  id: number
  name: string
  size: number
}

type GitHubRelease = {
  tag_name: string
  assets: GitHubAsset[]
}

async function fetchGitHubRelease(
  repo: string,
  tag: string,
): Promise<GitHubRelease | null> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for private repo access')
  }

  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'hostdb-r2-migrate',
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${response.status}`)
  }

  return response.json() as Promise<GitHubRelease>
}

async function downloadGitHubAsset(
  repo: string,
  assetId: number,
): Promise<Buffer> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const url = `https://api.github.com/repos/${repo}/releases/assets/${assetId}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'hostdb-r2-migrate',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download asset ${assetId}: ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

type UploadTask = {
  tag: string
  assetName: string
  assetId: number
  sizeMB: string
}

async function processUploadBatch(
  batch: UploadTask[],
  options: {
    repo: string
    client: S3Client
    bucket: string
    dryRun: boolean
  },
): Promise<{ uploaded: number; skipped: number; failed: number }> {
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const task of batch) {
    const key = `${task.tag}/${task.assetName}`

    if (options.dryRun) {
      console.log(`  [dry-run] would upload: ${key} (${task.sizeMB} MB)`)
      uploaded++
      continue
    }

    try {
      const exists = await objectExists({
        client: options.client,
        bucket: options.bucket,
        key,
      })

      if (exists) {
        console.log(`  skip: ${key} (already exists)`)
        skipped++
        continue
      }

      console.log(`  uploading: ${key} (${task.sizeMB} MB)...`)
      const data = await downloadGitHubAsset(options.repo, task.assetId)

      const contentType = task.assetName === 'checksums.txt'
        ? 'text/plain'
        : task.assetName.endsWith('.zip')
          ? 'application/zip'
          : 'application/gzip'

      await uploadToR2({
        client: options.client,
        bucket: options.bucket,
        key,
        body: data,
        contentType,
      })

      uploaded++
    } catch (error) {
      console.error(`  FAILED: ${key}: ${error instanceof Error ? error.message : error}`)
      failed++
    }
  }

  return { uploaded, skipped, failed }
}

async function main() {
  const { dryRun, database, concurrency } = parseArgs()

  if (dryRun) {
    console.log('Running in dry-run mode (no uploads or writes)\n')
  }

  // Load releases.json
  const releasesPath = resolve(ROOT_DIR, 'releases.json')
  const releases = JSON.parse(
    readFileSync(releasesPath, 'utf-8'),
  ) as ReleasesManifest

  const repo = releases.repository

  // Initialize R2 (skip in dry-run if env vars not set)
  let r2Config: ReturnType<typeof loadR2Config> | null = null
  let client: S3Client | null = null

  if (!dryRun) {
    r2Config = loadR2Config()
    client = createR2Client(r2Config)
  }

  // Collect all unique release tags to process
  const tagsToProcess = new Map<string, string[]>() // tag -> [db/version, ...]

  for (const [db, versions] of Object.entries(releases.databases)) {
    if (database && db !== database) continue

    for (const [version, release] of Object.entries(versions)) {
      const tag = release.releaseTag
      if (!tagsToProcess.has(tag)) {
        tagsToProcess.set(tag, [])
      }
      tagsToProcess.get(tag)!.push(`${db}/${version}`)
    }
  }

  console.log(`Found ${tagsToProcess.size} release tags to process\n`)

  let totalUploaded = 0
  let totalSkipped = 0
  let totalFailed = 0

  // Process tags in batches
  const tagEntries = [...tagsToProcess.entries()]

  for (let i = 0; i < tagEntries.length; i += concurrency) {
    const batch = tagEntries.slice(i, i + concurrency)

    const batchPromises = batch.map(async ([tag, entries]) => {
      console.log(`\n[${tag}] (${entries.join(', ')})`)

      // Fetch GitHub release to get asset IDs
      const ghRelease = await fetchGitHubRelease(repo, tag)
      if (!ghRelease) {
        console.warn(`  Warning: Release ${tag} not found on GitHub, skipping`)
        return { uploaded: 0, skipped: 0, failed: 0 }
      }

      const uploadTasks: UploadTask[] = ghRelease.assets.map((asset) => ({
        tag,
        assetName: asset.name,
        assetId: asset.id,
        sizeMB: (asset.size / 1024 / 1024).toFixed(1),
      }))

      return processUploadBatch(uploadTasks, {
        repo,
        client: client!,
        bucket: r2Config?.bucket ?? '',
        dryRun,
      })
    })

    const results = await Promise.all(batchPromises)
    for (const result of results) {
      totalUploaded += result.uploaded
      totalSkipped += result.skipped
      totalFailed += result.failed
    }
  }

  console.log(`\nUpload summary: ${totalUploaded} uploaded, ${totalSkipped} skipped, ${totalFailed} failed`)

  // Rewrite URLs in releases.json
  if (totalFailed > 0 && !dryRun) {
    console.error('\nSome uploads failed. Fix errors and re-run before rewriting URLs.')
    process.exit(1)
  }

  console.log('\nRewriting URLs in releases.json...')

  let urlsRewritten = 0
  for (const [db, versions] of Object.entries(releases.databases)) {
    if (database && db !== database) continue

    for (const [, release] of Object.entries(versions)) {
      for (const [platform, asset] of Object.entries(release.platforms)) {
        if (!asset) continue

        // Extract filename from existing URL
        const urlParts = asset.url.split('/')
        const filename = urlParts[urlParts.length - 1]
        const newUrl = getDownloadUrl(release.releaseTag, filename)

        if (asset.url !== newUrl) {
          if (dryRun) {
            console.log(`  [dry-run] ${db}/${release.version}/${platform}: ${asset.url} -> ${newUrl}`)
          }
          asset.url = newUrl
          urlsRewritten++
        }
      }
    }
  }

  if (urlsRewritten === 0) {
    console.log('  No URLs needed rewriting (already up to date)')
  } else if (dryRun) {
    console.log(`\n  Would rewrite ${urlsRewritten} URLs`)
  } else {
    writeFileSync(releasesPath, JSON.stringify(releases, null, 2) + '\n')
    console.log(`  Rewrote ${urlsRewritten} URLs in releases.json`)
  }

  console.log('\nDone.')
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
