/**
 * Partial-platform re-release tests.
 *
 * On 2026-09-09 postgresql 18.6.0 and 18.4.0 were re-released with
 * `platforms: linux-x64` to ship a binary rebuilt with uuid-ossp. Each run
 * assembled a one-line checksums.txt and handed it to action-gh-release, which
 * REPLACES the release asset rather than merging. build-releases-json.ts skips
 * any release asset with no checksum line, so both versions lost darwin-x64,
 * darwin-arm64, linux-arm64 and win32-x64 from releases.json even though the
 * tarballs were untouched on the release and in R2.
 *
 * Two defenses are pinned here:
 *   1. builds/common/merge-release-checksums.sh merges the release's existing
 *      checksums.txt under the freshly built one before upload, and
 *   2. checksumsFromPublishedPlatforms() lets the manifest builder fall back to
 *      an already-published checksum for an asset the release's checksums.txt
 *      failed to cover - but only when the asset is byte-identical (same size).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseChecksums,
  checksumsFromPublishedPlatforms,
} from '../lib/checksums.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'builds', 'common', 'merge-release-checksums.sh')

const SHA_OLD_LINUX_X64 =
  'ecf135f6cfd3655e8fb1c41cf18811997ac18dbc63222191eb29abcceae57a58'
const SHA_NEW_LINUX_X64 =
  'c4136806f89cb8bb9adcc981060c5eb30a721c07150c4b13e7d85c600847d0b9'
const SHA_DARWIN_ARM64 =
  '6e497d5cafb8796d723ba49b0a5f26ab99ba6cb892ccc5bb4d69b5f305fa7f30'
const SHA_LINUX_ARM64 =
  'b01260c126a882c89e8e43452fa97731f3be3d44026d6a725bed2105d2dab612'

const EXISTING_RELEASE_CHECKSUMS = [
  `${SHA_DARWIN_ARM64}  postgresql-18.6.0-darwin-arm64.tar.gz`,
  `${SHA_LINUX_ARM64}  postgresql-18.6.0-linux-arm64.tar.gz`,
  `${SHA_OLD_LINUX_X64}  postgresql-18.6.0-linux-x64.tar.gz`,
  '',
].join('\n')

/**
 * Run the merge script with a stub `gh` on PATH. `existing` is what
 * `gh release download` should produce, or null to simulate a release that has
 * no checksums.txt yet (a brand new tag).
 */
function runMerge({
  freshChecksums,
  existing,
  failingStub,
}: {
  freshChecksums: string
  existing: string | null
  /**
   * Replaces the stub body entirely, to drive a failure that is NOT a
   * not-found: an auth error, a 5xx, a network blip. `$STATE_FILE` is a scratch
   * path the stub can use to count its own invocations.
   */
  failingStub?: string
}): { status: number; stdout: string; merged: string } {
  const dir = mkdtempSync(join(tmpdir(), 'hostdb-merge-'))
  try {
    const binDir = join(dir, 'bin')
    const freshPath = join(dir, 'checksums.txt')
    const existingPath = join(dir, 'existing-fixture.txt')

    writeFileSync(freshPath, freshChecksums)
    if (existing !== null) writeFileSync(existingPath, existing)

    // Stub gh: `gh release download <tag> --pattern checksums.txt --output X`.
    // Copies the fixture to whatever path follows --output, or reports the
    // not-found the real gh reports when the release has no checksums.txt.
    spawnSync('mkdir', ['-p', binDir])
    const notFoundStub = [
      '#!/usr/bin/env bash',
      'echo "release not found" >&2',
      'exit 1',
      '',
    ].join('\n')
    const stub =
      failingStub !== undefined
        ? failingStub
        : existing === null
          ? notFoundStub
          : [
              '#!/usr/bin/env bash',
              'out=""',
              'while [[ $# -gt 0 ]]; do',
              '  if [[ "$1" == "--output" ]]; then out="$2"; shift; fi',
              '  shift',
              'done',
              `cp ${JSON.stringify(existingPath)} "$out"`,
              '',
            ].join('\n')
    const ghPath = join(binDir, 'gh')
    writeFileSync(ghPath, stub)
    chmodSync(ghPath, 0o755)

    const result = spawnSync('bash', [SCRIPT, 'postgresql-18.6.0', freshPath], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        STATE_FILE: join(dir, 'attempts.txt'),
        // Exercise the retry path without waiting out the real backoff.
        MERGE_RETRY_DELAYS: '0 0',
      },
    })

    return {
      status: result.status ?? 1,
      stdout: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      merged: readFileSync(freshPath, 'utf-8'),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('merge-release-checksums.sh', () => {
  test('a one-platform rebuild keeps the platforms it did not build', () => {
    const { status, merged } = runMerge({
      freshChecksums: `${SHA_NEW_LINUX_X64}  postgresql-18.6.0-linux-x64.tar.gz\n`,
      existing: EXISTING_RELEASE_CHECKSUMS,
    })

    assert.equal(status, 0)
    const checksums = parseChecksums(merged)
    assert.deepEqual(checksums, {
      // rebuilt: the new checksum wins over the one already on the release
      'postgresql-18.6.0-linux-x64.tar.gz': SHA_NEW_LINUX_X64,
      // untouched: carried over instead of being dropped
      'postgresql-18.6.0-darwin-arm64.tar.gz': SHA_DARWIN_ARM64,
      'postgresql-18.6.0-linux-arm64.tar.gz': SHA_LINUX_ARM64,
    })
  })

  test('binary-mode lines ("hash *name") are matched, not duplicated', () => {
    const { merged } = runMerge({
      freshChecksums: `${SHA_NEW_LINUX_X64} *postgresql-18.6.0-linux-x64.tar.gz\n`,
      existing: EXISTING_RELEASE_CHECKSUMS,
    })

    const lines = merged.trim().split('\n')
    assert.equal(lines.length, 3)
    assert.equal(
      parseChecksums(merged)['postgresql-18.6.0-linux-x64.tar.gz'],
      SHA_NEW_LINUX_X64,
    )
  })

  test('an all-platform rebuild replaces every checksum', () => {
    const fresh = [
      `${SHA_NEW_LINUX_X64}  postgresql-18.6.0-linux-x64.tar.gz`,
      `${SHA_DARWIN_ARM64}  postgresql-18.6.0-darwin-arm64.tar.gz`,
      `${SHA_LINUX_ARM64}  postgresql-18.6.0-linux-arm64.tar.gz`,
      '',
    ].join('\n')

    const { merged } = runMerge({
      freshChecksums: fresh,
      existing: EXISTING_RELEASE_CHECKSUMS,
    })

    assert.equal(
      parseChecksums(merged)['postgresql-18.6.0-linux-x64.tar.gz'],
      SHA_NEW_LINUX_X64,
    )
    assert.equal(merged.trim().split('\n').length, 3)
  })

  test('a brand new release with no existing checksums.txt is untouched', () => {
    const fresh = `${SHA_NEW_LINUX_X64}  postgresql-18.6.0-linux-x64.tar.gz\n`
    const { status, merged } = runMerge({
      freshChecksums: fresh,
      existing: null,
    })

    assert.equal(status, 0)
    assert.deepEqual(parseChecksums(merged), {
      'postgresql-18.6.0-linux-x64.tar.gz': SHA_NEW_LINUX_X64,
    })
  })

  test('an asset-level not-found is also treated as nothing to merge', () => {
    const { status, stdout } = runMerge({
      freshChecksums: `${SHA_NEW_LINUX_X64}  postgresql-18.6.0-linux-x64.tar.gz\n`,
      existing: null,
      failingStub: [
        '#!/usr/bin/env bash',
        'echo "no assets match the file pattern" >&2',
        'exit 1',
        '',
      ].join('\n'),
    })

    assert.equal(status, 0)
    assert.match(stdout, /nothing to merge/)
  })

  test('a non-not-found failure fails the step instead of dropping platforms', () => {
    const { status, stdout, merged } = runMerge({
      freshChecksums: `${SHA_NEW_LINUX_X64}  postgresql-18.6.0-linux-x64.tar.gz\n`,
      existing: null,
      failingStub: [
        '#!/usr/bin/env bash',
        'echo "HTTP 401: Bad credentials" >&2',
        'exit 1',
        '',
      ].join('\n'),
    })

    assert.notEqual(status, 0)
    assert.match(stdout, /could not read the existing checksums\.txt/)
    // two retries before giving up, so a blip is not mistaken for a new release
    assert.equal(stdout.match(/retrying in/g)?.length, 2)
    // the freshly built file is left exactly as it was, never half-merged
    assert.deepEqual(parseChecksums(merged), {
      'postgresql-18.6.0-linux-x64.tar.gz': SHA_NEW_LINUX_X64,
    })
  })

  test('a transient failure that clears on retry still merges', () => {
    const { status, merged } = runMerge({
      freshChecksums: `${SHA_NEW_LINUX_X64}  postgresql-18.6.0-linux-x64.tar.gz\n`,
      existing: EXISTING_RELEASE_CHECKSUMS,
      failingStub: [
        '#!/usr/bin/env bash',
        'attempts="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"',
        'attempts=$((attempts + 1))',
        'echo "$attempts" >"$STATE_FILE"',
        'if [[ "$attempts" -eq 1 ]]; then',
        '  echo "HTTP 502: Bad gateway" >&2',
        '  exit 1',
        'fi',
        'out=""',
        'while [[ $# -gt 0 ]]; do',
        '  if [[ "$1" == "--output" ]]; then out="$2"; shift; fi',
        '  shift',
        'done',
        `cat >"$out" <<'EXISTING'
${EXISTING_RELEASE_CHECKSUMS}EXISTING`,
        '',
      ].join('\n'),
    })

    assert.equal(status, 0)
    assert.deepEqual(parseChecksums(merged), {
      'postgresql-18.6.0-linux-x64.tar.gz': SHA_NEW_LINUX_X64,
      'postgresql-18.6.0-darwin-arm64.tar.gz': SHA_DARWIN_ARM64,
      'postgresql-18.6.0-linux-arm64.tar.gz': SHA_LINUX_ARM64,
    })
  })
})

describe('checksumsFromPublishedPlatforms', () => {
  const published = {
    'linux-x64': {
      url: 'https://registry.layerbase.host/postgresql-18.6.0/postgresql-18.6.0-linux-x64.tar.gz',
      sha256: SHA_OLD_LINUX_X64,
      size: 12278732,
    },
    'linux-arm64': {
      url: 'https://registry.layerbase.host/postgresql-18.6.0/postgresql-18.6.0-linux-arm64.tar.gz',
      sha256: SHA_LINUX_ARM64,
      size: 12111299,
    },
  }

  test('preserves a checksum for an asset that is still byte-identical', () => {
    const preserved = checksumsFromPublishedPlatforms(published, {
      'postgresql-18.6.0-linux-arm64.tar.gz': 12111299,
    })

    assert.deepEqual(preserved, {
      'postgresql-18.6.0-linux-arm64.tar.gz': SHA_LINUX_ARM64,
    })
  })

  test('drops a stale checksum when the asset was re-uploaded (size changed)', () => {
    const preserved = checksumsFromPublishedPlatforms(published, {
      // the rebuilt linux-x64 tarball: same name, different size
      'postgresql-18.6.0-linux-x64.tar.gz': 12280612,
    })

    assert.deepEqual(preserved, {})
  })

  test('drops a checksum for an asset no longer on the release', () => {
    assert.deepEqual(checksumsFromPublishedPlatforms(published, {}), {})
  })
})
