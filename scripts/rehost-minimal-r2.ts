#!/usr/bin/env tsx
/**
 * Re-host a pre-built "minimal" binary over its canonical R2 key.
 *
 * Why this exists: spindb builds binary download URLs from a fixed template
 * (registry.layerbase.host/{engine}-{ver}/{engine}-{ver}-{platform}.tar.gz) and
 * never reads the per-asset `url` from releases.json, nor verifies sha256/size.
 * So the ONLY way to deliver a smaller binary without a spindb release is to
 * replace the object sitting at that canonical key. This does it safely:
 *
 *   1. (default) back up the existing canonical object to `_backup/<key>`,
 *      but only if no backup exists yet - so the TRUE original is preserved
 *      even if this script is run multiple times.
 *   2. upload the new (minimal) file over the canonical key (immutable cache).
 *   3. purge the Cloudflare CDN cache for that URL.
 *
 * Reverse it with --restore: copies `_backup/<key>` back over `<key>` + purges.
 *
 * Usage:
 *   pnpm tsx scripts/rehost-minimal-r2.ts --tag mysql-8.4.9 \
 *     --file ./dist/mysql-8.4.9-linux-x64.tar.gz
 *   pnpm tsx scripts/rehost-minimal-r2.ts --tag mysql-8.4.9 --file ... --no-backup
 *   pnpm tsx scripts/rehost-minimal-r2.ts --tag mysql-8.4.9 \
 *     --filename mysql-8.4.9-linux-x64.tar.gz --restore
 *   pnpm tsx scripts/rehost-minimal-r2.ts --tag mysql-8.4.9 --file ... --dry-run
 *
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *               R2_BUCKET_NAME
 * Optional env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID (for CDN purge)
 */

import { statSync, readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import {
  loadR2Config,
  createR2Client,
  uploadToR2,
  objectExists,
  copyR2Object,
  purgeCloudflareCache,
} from '../lib/r2.js'
import { getDownloadUrl } from '../lib/registry.js'

// Refuse to overwrite the canonical key with anything larger than this. A
// minimal linux-x64 MySQL tarball is ~135-140 MB; a FULL one is ~870 MB+. This
// guards against accidentally re-hosting a full build (e.g. if sources.json was
// reverted) over the canonical key.
const DEFAULT_MAX_SIZE_MB = 400

const BACKUP_PREFIX = '_backup'

type Args = {
  tag: string
  file: string | null
  filename: string | null
  restore: boolean
  noBackup: boolean
  dryRun: boolean
  maxSizeMb: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {
    tag: '',
    file: null,
    filename: null,
    restore: false,
    noBackup: false,
    dryRun: false,
    maxSizeMb: DEFAULT_MAX_SIZE_MB,
  }

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--tag':
        args.tag = argv[++i] ?? ''
        break
      case '--file':
        args.file = argv[++i] ?? null
        break
      case '--filename':
        args.filename = argv[++i] ?? null
        break
      case '--restore':
        args.restore = true
        break
      case '--no-backup':
        args.noBackup = true
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--max-size-mb':
        args.maxSizeMb = Number(argv[++i])
        break
      case '--':
        break
      case '--help':
      case '-h':
        console.log(
          `Usage: rehost-minimal-r2.ts --tag <tag> (--file <path> | --filename <name>) [options]\n\n` +
            `Options:\n` +
            `  --tag TAG          Release tag / R2 folder (e.g. mysql-8.4.9)\n` +
            `  --file PATH        Local artifact to upload (re-host mode)\n` +
            `  --filename NAME    Asset name (defaults to basename of --file)\n` +
            `  --restore          Restore _backup/<key> over <key> instead of uploading\n` +
            `  --no-backup        Skip backing up the existing object (re-host mode)\n` +
            `  --max-size-mb N    Reject uploads larger than N MB (default ${DEFAULT_MAX_SIZE_MB})\n` +
            `  --dry-run          Print actions without touching R2\n`,
        )
        process.exit(0)
    }
  }

  if (!args.tag) {
    console.error('Error: --tag is required')
    process.exit(1)
  }
  if (!args.restore && !args.file) {
    console.error('Error: --file is required (or use --restore)')
    process.exit(1)
  }
  if (!args.filename && !args.file) {
    console.error('Error: --filename is required when --file is omitted')
    process.exit(1)
  }
  if (!Number.isFinite(args.maxSizeMb) || args.maxSizeMb <= 0) {
    console.error('Error: --max-size-mb must be a positive number')
    process.exit(1)
  }

  return args
}

function contentTypeFor(name: string): string {
  return name.endsWith('.zip') ? 'application/zip' : 'application/gzip'
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

async function main() {
  const args = parseArgs()
  const assetName = args.filename ?? basename(args.file as string)
  const key = `${args.tag}/${assetName}`
  const backupKey = `${BACKUP_PREFIX}/${key}`
  const url = getDownloadUrl(args.tag, assetName)
  const contentType = contentTypeFor(assetName)

  console.log(`Mode:        ${args.restore ? 'RESTORE' : 're-host'}`)
  console.log(`Canonical:   ${key}`)
  console.log(`Backup:      ${backupKey}`)
  console.log(`URL:         ${url}`)

  // Size guard / preview (re-host mode) - done before any R2 access so a bad
  // input fails fast and --dry-run is usable without credentials.
  let body: Buffer | null = null
  if (!args.restore) {
    const file = args.file as string
    if (!existsSync(file)) {
      console.error(`Error: file not found: ${file}`)
      process.exit(1)
    }
    const sizeMb = statSync(file).size / 1024 / 1024
    console.log(`File:        ${file} (${sizeMb.toFixed(1)} MB)`)
    if (sizeMb > args.maxSizeMb) {
      console.error(
        `Error: ${sizeMb.toFixed(1)} MB exceeds --max-size-mb ${args.maxSizeMb}. ` +
          `Refusing to overwrite the canonical key - is this actually the minimal build? ` +
          `(check builds/mysql/sources.json points linux-x64 at the -minimal tarball)`,
      )
      process.exit(1)
    }
    body = readFileSync(file)
  }

  if (args.dryRun) {
    console.log('\n[dry-run] would:')
    if (args.restore) {
      console.log(`  - copy ${backupKey} -> ${key} (immutable cache)`) // restore
    } else {
      if (!args.noBackup) {
        console.log(`  - copy ${key} -> ${backupKey} (only if backup absent)`)
      }
      console.log(`  - put  ${key} (overwrite, immutable cache, ${contentType})`)
    }
    console.log(`  - purge CDN: ${url}`)
    return
  }

  const config = loadR2Config()
  const client = createR2Client(config)
  const bucket = config.bucket

  if (args.restore) {
    const hasBackup = await objectExists({ client, bucket, key: backupKey })
    if (!hasBackup) {
      console.error(
        `Error: no backup at ${backupKey} - nothing to restore. ` +
          `(Backups are only created when re-hosting without --no-backup.)`,
      )
      process.exit(1)
    }
    console.log(`\nRestoring ${backupKey} -> ${key} ...`)
    await copyR2Object({
      client,
      bucket,
      sourceKey: backupKey,
      destKey: key,
      cacheControl: IMMUTABLE_CACHE,
      contentType,
    })
    console.log('  restored.')
  } else {
    if (!args.noBackup) {
      const canonicalExists = await objectExists({ client, bucket, key })
      if (!canonicalExists) {
        console.log('\nNo existing canonical object - nothing to back up.')
      } else {
        const backupExists = await objectExists({
          client,
          bucket,
          key: backupKey,
        })
        if (backupExists) {
          console.log(
            `\nBackup already exists at ${backupKey} - leaving the original original intact.`,
          )
        } else {
          console.log(`\nBacking up ${key} -> ${backupKey} ...`)
          await copyR2Object({ client, bucket, sourceKey: key, destKey: backupKey })
          console.log('  backed up.')
        }
      }
    }

    console.log(`\nUploading minimal -> ${key} (overwrite) ...`)
    await uploadToR2({
      client,
      bucket,
      key,
      body: body as Buffer,
      contentType,
      cacheControl: IMMUTABLE_CACHE,
    })
    console.log('  uploaded.')
  }

  console.log(`\nPurging CDN cache for ${url} ...`)
  const { purged, count } = await purgeCloudflareCache([url])
  if (purged) {
    console.log(`  purged ${count} URL.`)
  } else {
    console.log(
      '  CDN purge SKIPPED (CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID not set). ' +
        'The old binary may stay cached for up to a year - set those secrets to purge.',
    )
  }

  console.log('\nDone.')
  if (!args.restore && !args.noBackup) {
    console.log(
      `Revert with: pnpm tsx scripts/rehost-minimal-r2.ts --tag ${args.tag} --filename ${assetName} --restore`,
    )
    console.log(
      `Note: the ${BACKUP_PREFIX}/ backup is not referenced by releases.json, so ` +
        `do NOT run 'pnpm audit:r2-orphans --delete' while you rely on it for revert.`,
    )
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
