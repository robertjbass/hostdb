#!/usr/bin/env tsx
/**
 * Uploads GitHub Release assets to Cloudflare R2.
 *
 * Called by GitHub Actions after each release to mirror assets to R2.
 *
 * Usage:
 *   pnpm tsx scripts/upload-to-r2.ts --tag mysql-8.4.3
 *
 * Required env vars: GITHUB_TOKEN, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *                    R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { loadR2Config, createR2Client, uploadToR2, objectExists } from '../lib/r2.js'

type GitHubAsset = {
  id: number
  name: string
  size: number
}

type GitHubRelease = {
  tag_name: string
  assets: GitHubAsset[]
}

function parseArgs(): { tag: string } {
  const args = process.argv.slice(2)
  let tag = ''

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--tag':
        if (i + 1 >= args.length) {
          console.error('Error: --tag requires a value')
          process.exit(1)
        }
        tag = args[++i]
        break
      case '--':
        break
      case '--help':
      case '-h':
        console.log(`
Usage: pnpm tsx scripts/upload-to-r2.ts --tag <release-tag>

Options:
  --tag TAG   GitHub release tag (e.g., mysql-8.4.3)
  --help      Show this help

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

  if (!tag) {
    console.error('Error: --tag is required')
    process.exit(1)
  }

  return { tag }
}

async function fetchRelease(repo: string, tag: string): Promise<GitHubRelease> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for private repo access')
  }

  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'hostdb-r2-upload',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<GitHubRelease>
}

async function downloadAsset(repo: string, assetId: number): Promise<Buffer> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for private repo access')
  }

  const url = `https://api.github.com/repos/${repo}/releases/assets/${assetId}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'hostdb-r2-upload',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download asset ${assetId}: ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function main() {
  const { tag } = parseArgs()
  const repo = 'robertjbass/hostdb'

  console.log(`Uploading assets for release ${tag} to R2...\n`)

  const r2Config = loadR2Config()
  const client = createR2Client(r2Config)

  const release = await fetchRelease(repo, tag)
  console.log(`Found ${release.assets.length} assets in release ${tag}\n`)

  let uploaded = 0
  let skipped = 0

  for (const asset of release.assets) {
    const key = `${tag}/${asset.name}`

    const exists = await objectExists({
      client,
      bucket: r2Config.bucket,
      key,
    })

    if (exists) {
      console.log(`  skip: ${asset.name} (already exists)`)
      skipped++
      continue
    }

    console.log(`  uploading: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`)

    const data = await downloadAsset(repo, asset.id)

    const contentType = asset.name === 'checksums.txt'
      ? 'text/plain'
      : asset.name.endsWith('.zip')
        ? 'application/zip'
        : 'application/gzip'

    await uploadToR2({
      client,
      bucket: r2Config.bucket,
      key,
      body: data,
      contentType,
    })

    uploaded++
  }

  console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped`)
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
