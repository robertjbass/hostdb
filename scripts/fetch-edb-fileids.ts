#!/usr/bin/env tsx
/**
 * Fetches PostgreSQL Windows binary file IDs from EDB's download page
 *
 * Usage:
 *   pnpm tsx scripts/fetch-edb-fileids.ts
 *   pnpm tsx scripts/fetch-edb-fileids.ts --update  # Update sources.json
 *
 * EDB uses non-predictable file IDs for their downloads, so we need to scrape
 * the download page to get the current file IDs for each version.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EDB_BINARIES_URL = 'https://www.enterprisedb.com/download-postgresql-binaries'

type VersionFileIds = Record<
  string,
  {
    windows?: string
    macos?: string
  }
>

// Regex patterns for parsing EDB download page
const LINK_PATTERN =
  /<a\s+href="https:\/\/sbp\.enterprisedb\.com\/getfile\.jsp\?fileid=(\d+)"[^>]*>.*?<img\s+alt="([^"]+)"/gs
const VERSION_PATTERN = /Version\s*(?:<!--.*?-->\s*)?(\d+\.\d+(?:\.\d+)?)/

async function fetchEdbPage(): Promise<string> {
  console.log(`Fetching ${EDB_BINARIES_URL}...`)
  const response = await fetch(EDB_BINARIES_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch EDB page: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

function parseFileIds(html: string): VersionFileIds {
  const results: VersionFileIds = {}

  // Split by version sections
  const sections = html.split(/Binaries from installer/)

  for (const section of sections) {
    // Find version in this section
    const versionMatch = section.match(VERSION_PATTERN)
    if (!versionMatch) continue

    const version = versionMatch[1]

    // Skip unsupported versions
    if (section.includes('Not supported')) continue

    // Find all links in this section
    const links = [...section.matchAll(LINK_PATTERN)]

    const fileIds: { windows?: string; macos?: string } = {}

    for (const [, fileId, platform] of links) {
      if (platform === 'Windows x86-64') {
        fileIds.windows = fileId
      } else if (platform === 'Mac OS X') {
        fileIds.macos = fileId
      }
    }

    if (fileIds.windows || fileIds.macos) {
      results[version] = fileIds
    }
  }

  return results
}

function updateSourcesJson(fileIds: VersionFileIds): boolean {
  const sourcesPath = join(import.meta.dirname, '..', 'builds', 'postgresql', 'sources.json')
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf-8'))

  let updated = false

  for (const [version, ids] of Object.entries(fileIds)) {
    // Convert 2-part version to 3-part (18.1 -> 18.1.0)
    const parts = version.split('.')
    const version3Part = parts.length >= 3 ? version : `${version}.0`

    if (!sources.versions[version3Part]) {
      console.log(`  Skipping ${version} - not in sources.json`)
      continue
    }

    if (ids.windows) {
      const currentUrl = sources.versions[version3Part]['win32-x64']?.url
      const newUrl = `https://sbp.enterprisedb.com/getfile.jsp?fileid=${ids.windows}`

      if (currentUrl !== newUrl) {
        console.log(`  Updating ${version3Part}/win32-x64: fileid=${ids.windows}`)
        sources.versions[version3Part]['win32-x64'] = {
          url: newUrl,
          format: 'zip',
          sourceType: 'official',
          sha256: null, // Will be populated by checksums:populate
        }
        updated = true
      }
    }
  }

  if (updated) {
    writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + '\n')
    console.log(`\nUpdated ${sourcesPath}`)
    console.log('Run "pnpm checksums:populate postgresql" to fetch checksums')
  }

  return updated
}

async function main() {
  const shouldUpdate = process.argv.includes('--update')

  try {
    const html = await fetchEdbPage()
    const fileIds = parseFileIds(html)

    console.log('\nEDB PostgreSQL Windows Binary File IDs:')
    console.log('========================================')

    const sortedVersions = Object.keys(fileIds).sort((a, b) => {
      const [aMajor, aMinor] = a.split('.').map(Number)
      const [bMajor, bMinor] = b.split('.').map(Number)
      return bMajor - aMajor || bMinor - aMinor
    })

    for (const version of sortedVersions) {
      const ids = fileIds[version]
      console.log(`  ${version}:`)
      if (ids.windows) {
        console.log(`    Windows x64: https://sbp.enterprisedb.com/getfile.jsp?fileid=${ids.windows}`)
      }
      if (ids.macos) {
        console.log(`    macOS:       https://sbp.enterprisedb.com/getfile.jsp?fileid=${ids.macos}`)
      }
    }

    if (shouldUpdate) {
      console.log('\nUpdating sources.json...')
      const updated = updateSourcesJson(fileIds)
      if (!updated) {
        console.log('No updates needed - all file IDs are current')
      }
    } else {
      console.log('\nRun with --update to update sources.json')
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
