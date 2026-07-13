/**
 * R2 orphan audit
 *
 * Lists every object on R2 and compares against what's referenced by the live
 * `releases.json`. Anything on R2 not referenced is an orphan — usually a
 * binary from an engine we no longer ship, or a deprecated version that's
 * been completely removed from the registry.
 *
 * Defaults to dry-run. Pass --delete to actually remove the orphans (asks
 * for explicit confirmation before destroying anything).
 *
 * Usage:
 *   pnpm audit:r2-orphans                        # dry-run, lists candidates
 *   pnpm audit:r2-orphans -- --engine clickhouse # restrict to one engine prefix
 *   pnpm audit:r2-orphans -- --delete            # actually delete (prompts first)
 *   pnpm audit:r2-orphans -- --json              # machine-readable output
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { loadR2Config, createR2Client, deleteFromR2 } from '../lib/r2.js'
import type { S3Client } from '@aws-sdk/client-s3'
import type { ReleasesJson } from '../lib/databases.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

type Args = {
  engine?: string
  delete: boolean
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { delete: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--engine':
        args.engine = argv[++i]
        break
      case '--delete':
        args.delete = true
        break
      case '--json':
        args.json = true
        break
      case '--help':
      case '-h':
        console.log(
          'Usage: pnpm audit:r2-orphans [--engine <name>] [--delete] [--json]',
        )
        process.exit(0)
        break
      case '--':
        break // ignore (pnpm forwards this)
      default:
        if (a.startsWith('--')) {
          console.error(`Unknown flag: ${a}`)
          process.exit(2)
        }
    }
  }
  return args
}

function loadReferencedKeys(): Set<string> {
  const releases = JSON.parse(
    readFileSync(join(ROOT, 'releases.json'), 'utf-8'),
  ) as ReleasesJson
  const keys = new Set<string>()
  for (const versions of Object.values(releases.databases)) {
    for (const versionRelease of Object.values(versions)) {
      for (const asset of Object.values(versionRelease.platforms)) {
        if (!asset) continue
        // Strip the base URL prefix to get the R2 object key
        try {
          const url = new URL(asset.url)
          // pathname starts with '/' — drop it
          keys.add(url.pathname.replace(/^\//, ''))
        } catch {
          // skip malformed
        }
      }
    }
  }
  // Also keep the top-level registry JSON files
  keys.add('releases.json')
  keys.add('databases.json')
  keys.add('downloads.json')
  return keys
}

/**
 * Companion artifacts that the release workflow uploads alongside binaries
 * but `releases.json` doesn't directly reference. They're not real orphans
 * (and not engine-binary dead weight) — `releases.json` embeds the sha256
 * inline per platform entry, and `scripts/build-releases-json.ts` reads
 * checksums from GitHub's CDN, not from R2. Excluded from the orphan list
 * so the audit focuses on what actually matters: stale binaries.
 *
 * If we ever delete these from R2 entirely, this filter becomes unnecessary.
 */
function isExpectedCompanionArtifact(key: string): boolean {
  // Per-release checksums files: <engine>-<version>/checksums.txt and
  // <engine>-<version>/checksums-macos.txt (PostgreSQL native macOS builds).
  return /\/checksums(-[a-z0-9]+)?\.txt$/.test(key)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const referenced = loadReferencedKeys()

  const config = loadR2Config()
  const client = createR2Client(config)
  const prefix = args.engine ? `${args.engine}-` : undefined

  const r2Objects = await listAllR2Objects(client, config.bucket, prefix)

  const orphans: { key: string; size?: number }[] = []
  const companions: { key: string; size?: number }[] = []
  let totalSize = 0
  let companionSize = 0
  for (const obj of r2Objects) {
    if (!obj.key) continue
    if (referenced.has(obj.key)) continue
    if (isExpectedCompanionArtifact(obj.key)) {
      companions.push({ key: obj.key, size: obj.size })
      if (obj.size) companionSize += obj.size
      continue
    }
    orphans.push({ key: obj.key, size: obj.size })
    if (obj.size) totalSize += obj.size
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          totalR2Objects: r2Objects.length,
          referenced: referenced.size,
          companions: companions.length,
          companionBytes: companionSize,
          orphans: orphans.length,
          orphanBytes: totalSize,
          orphanKeys: orphans.map((o) => o.key),
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`R2 objects: ${r2Objects.length}`)
    console.log(`Referenced by releases.json: ${referenced.size}`)
    console.log(
      `Companion artifacts (checksums.txt): ${companions.length} (${formatBytes(companionSize)}) — expected, not orphans`,
    )
    console.log(`True orphans: ${orphans.length} (${formatBytes(totalSize)})`)
    if (orphans.length > 0) {
      console.log('\nOrphan keys:')
      // Group by engine prefix for readability
      const byPrefix = new Map<string, typeof orphans>()
      for (const o of orphans) {
        const prefix = o.key.split('-')[0] || '(no-prefix)'
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
        byPrefix.get(prefix)!.push(o)
      }
      for (const [prefix, group] of [...byPrefix.entries()].sort()) {
        console.log(`\n  ${prefix} (${group.length} objects):`)
        for (const o of group.slice(0, 10)) {
          console.log(
            `    ${o.key}${o.size ? ` (${formatBytes(o.size)})` : ''}`,
          )
        }
        if (group.length > 10)
          console.log(`    ... and ${group.length - 10} more`)
      }
    }
  }

  if (args.delete && orphans.length > 0) {
    console.log(
      `\nAbout to DELETE ${orphans.length} orphan(s) from R2 (${formatBytes(totalSize)}).`,
    )
    console.log('This is IRREVERSIBLE. Type "yes" to confirm:')
    const answer = await readLine()
    if (answer !== 'yes') {
      console.log('Aborted.')
      process.exit(1)
    }
    for (const o of orphans) {
      await deleteFromR2({ client, bucket: config.bucket, key: o.key })
      console.log(`  deleted: ${o.key}`)
    }
    console.log(`\nDeleted ${orphans.length} orphans.`)
  } else if (orphans.length > 0 && !args.json) {
    console.log('\n(Dry-run. Pass --delete to actually remove orphans.)')
  }
}

async function listAllR2Objects(
  client: S3Client,
  bucket: string,
  prefix?: string,
): Promise<{ key: string; size?: number }[]> {
  const out: { key: string; size?: number }[] = []
  let continuationToken: string | undefined
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )
    for (const o of resp.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, size: o.Size })
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined
  } while (continuationToken)
  return out
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.once('data', (data) =>
      resolve(data.toString().trim().toLowerCase()),
    )
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
