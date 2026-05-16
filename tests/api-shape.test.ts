/**
 * API shape snapshot.
 *
 * Locks the public surface of the `hostdb` npm package. Accidental rename
 * or removal of an exported name breaks this test — and breaks downstream
 * consumers, so the failure here is the right signal.
 *
 * Intentional renames: update the snapshot below and bump a semver-major.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as pkg from '../lib/index.ts'

/**
 * Snapshot of the exported names from `hostdb`.
 *
 * Keep this sorted alphabetically.
 */
const EXPECTED_EXPORTS = [
  'ALL_PLATFORMS',
  'compareVersions',
  'getAvailablePlatforms',
  'getCliTools',
  'getDatabaseEntry',
  'getEnabledVersions',
  'getEngineDefaults',
  'getMajorDefault',
  'getReleaseInfo',
  'getSupportedMajorVersions',
  'isVersionDeprecated',
  'isVersionEnabled',
  'listEngines',
  'listVersions',
  'loadDatabasesJson',
  'loadDownloadsJson',
  'loadReleasesJson',
  'normalizeVersion',
  'resolveVersion',
] as const

test('public exports of hostdb match the snapshot', () => {
  const actual = Object.keys(pkg).sort()
  const expected = [...EXPECTED_EXPORTS].sort()
  assert.deepEqual(
    actual,
    expected,
    `Public surface drifted. Added: ${actual.filter((x) => !expected.includes(x as never)).join(', ') || '(none)'}; Removed: ${expected.filter((x) => !actual.includes(x)).join(', ') || '(none)'}.`,
  )
})

test('every snapshotted export is a function (no broken re-exports)', () => {
  for (const name of EXPECTED_EXPORTS) {
    const v = (pkg as Record<string, unknown>)[name]
    if (name === 'ALL_PLATFORMS') {
      assert.ok(Array.isArray(v), `${name} should be an array`)
      continue
    }
    assert.equal(
      typeof v,
      'function',
      `${name} should be a function, got ${typeof v}`,
    )
  }
})
