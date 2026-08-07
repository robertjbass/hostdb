/**
 * Retired-platform bookkeeping.
 *
 * A platform can be released and later dropped: ferretdb 2.7.0 and
 * postgresql-documentdb 17-0.107.0 both shipped win32-x64 in January 2026,
 * then lost Windows support in February when it became clear the DocumentDB
 * extension has no Windows build. R2 URLs are immutable, so those two release
 * entries are permanent; `retired_platforms` in databases.yml is how the
 * registry records that they are expected rather than an oversight.
 *
 * `pnpm prep` reports the same facts, but its discrepancy output is warn-only.
 * These tests are the enforcement: a new unaccounted-for release platform, or
 * a retirement that stops describing reality, fails CI instead of becoming
 * another warning everyone learns to scroll past.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  loadDatabasesJson,
  loadReleasesJson,
  getVersionPlatforms,
  getRetiredPlatforms,
  type Platform,
} from '../lib/databases.ts'

const databases = loadDatabasesJson()
const releases = loadReleasesJson()

type Retirement = {
  database: string
  version: string
  platform: Platform
  reason: string
}

function allRetirements(): Retirement[] {
  const found: Retirement[] = []

  for (const [database, entry] of Object.entries(databases.databases)) {
    for (const version of Object.keys(entry.versions)) {
      for (const [platform, reason] of Object.entries(
        getRetiredPlatforms(entry, version),
      )) {
        found.push({
          database,
          version,
          platform: platform as Platform,
          reason: reason as string,
        })
      }
    }
  }

  return found
}

describe('retired platforms', () => {
  test('every released platform is either supported or explicitly retired', () => {
    const unaccounted: string[] = []

    for (const [database, versions] of Object.entries(releases.databases)) {
      const entry = databases.databases[database]
      if (!entry) continue

      for (const [version, release] of Object.entries(versions)) {
        if (!entry.versions[version]) continue

        const supported = getVersionPlatforms(entry, version)
        const retired = getRetiredPlatforms(entry, version)

        for (const platform of Object.keys(release.platforms) as Platform[]) {
          if (supported.includes(platform)) continue
          if (retired[platform]) continue
          unaccounted.push(`${database} ${version} ${platform}`)
        }
      }
    }

    assert.deepEqual(
      unaccounted,
      [],
      `Released platforms missing from both platforms and retired_platforms: ${unaccounted.join(', ')}. Either enable the platform or record why it was dropped under retired_platforms in databases.yml.`,
    )
  })

  test('each retirement still has the release it describes', () => {
    for (const { database, version, platform } of allRetirements()) {
      const released = releases.databases[database]?.[version]?.platforms
      assert.ok(
        released && platform in released,
        `${database} ${version} marks ${platform} retired but no such release exists. Drop the retired_platforms entry.`,
      )
    }
  })

  test('a retired platform is not also a supported one', () => {
    for (const { database, version, platform } of allRetirements()) {
      const supported = getVersionPlatforms(
        databases.databases[database],
        version,
      )
      assert.ok(
        !supported.includes(platform),
        `${database} ${version} lists ${platform} in both platforms and retired_platforms.`,
      )
    }
  })

  test('each retirement explains itself', () => {
    for (const { database, version, platform, reason } of allRetirements()) {
      assert.ok(
        typeof reason === 'string' && reason.trim().length >= 40,
        `${database} ${version} ${platform} needs a real reason for retirement, not "${reason}".`,
      )
    }
  })

  test('the two Windows retirements are declared', () => {
    const declared = allRetirements().map(
      (r) => `${r.database} ${r.version} ${r.platform}`,
    )

    for (const expected of [
      'ferretdb 2.7.0 win32-x64',
      'postgresql-documentdb 17-0.107.0 win32-x64',
    ]) {
      assert.ok(
        declared.includes(expected),
        `Expected ${expected} to stay declared as retired (its R2 artifact is permanent).`,
      )
    }
  })
})
