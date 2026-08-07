/**
 * Platform-coverage test.
 *
 * `builds/common/check-platform-coverage.sh` is the release-time gate that
 * turns "a requested platform produced no artifact" from a silent skip into a
 * hard failure. weaviate 1.38.8 shipped 2 of 5 platforms green because every
 * engine's download.ts counts a failed build as a skip and still exits 0.
 *
 * The distinction the gate has to keep straight, and what these tests pin:
 *   - a platform the engine DECLARES (databases.json + builds/<db>/sources.json)
 *     that produced nothing is a failure, and
 *   - a platform the engine does not declare is a legitimate skip, even when
 *     the workflow asked for "all".
 *
 * The tests run against real registry data rather than fixtures so the two
 * declaration sources stay wired up: weaviate declares all five platforms,
 * libsql declares four (no win32 build by design). Only the artifact directory
 * is synthetic - the script reads filenames, never archive contents.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'builds', 'common', 'check-platform-coverage.sh')

type Platform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'

const ALL: Platform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
]

function withAssets(
  database: string,
  version: string,
  platforms: Platform[],
  run: (assetsDir: string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), 'hostdb-coverage-'))
  try {
    for (const platform of platforms) {
      const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
      writeFileSync(join(dir, `${database}-${version}-${platform}.${ext}`), '')
    }
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function checkCoverage(options: {
  database: string
  version: string
  requested: string
  built: Platform[]
}): { status: number; output: string } {
  let result = { status: -1, output: '' }

  withAssets(options.database, options.version, options.built, (assetsDir) => {
    const proc = spawnSync(
      'bash',
      [SCRIPT, options.database, options.version, options.requested, assetsDir],
      { encoding: 'utf-8' },
    )
    result = {
      status: proc.status ?? -1,
      output: `${proc.stdout ?? ''}${proc.stderr ?? ''}`,
    }
  })

  return result
}

describe('check-platform-coverage.sh', () => {
  test('passes when every requested platform produced an artifact', () => {
    const { status } = checkCoverage({
      database: 'weaviate',
      version: '1.38.8',
      requested: 'all',
      built: ALL,
    })

    assert.equal(status, 0)
  })

  test('fails when a requested, declared platform produced no artifact', () => {
    // The weaviate 1.38.8 incident: 2 of 5 platforms, release still green.
    const { status, output } = checkCoverage({
      database: 'weaviate',
      version: '1.38.8',
      requested: 'all',
      built: ['linux-x64', 'darwin-arm64'],
    })

    assert.equal(status, 1)
    assert.match(output, /Platform coverage check failed/)
    for (const missing of ['linux-arm64', 'darwin-x64', 'win32-x64']) {
      assert.match(output, new RegExp(missing))
    }
  })

  test('passes when an undeclared platform is missing (no win32 by design)', () => {
    // libsql declares four platforms; "all" must not expect a win32 build.
    const { status } = checkCoverage({
      database: 'libsql',
      version: '0.24.32',
      requested: 'all',
      built: ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'],
    })

    assert.equal(status, 0)
  })

  test('fails on a missing platform from an explicit request list', () => {
    const { status, output } = checkCoverage({
      database: 'weaviate',
      version: '1.38.8',
      requested: 'linux-x64,linux-arm64',
      built: ['linux-x64'],
    })

    assert.equal(status, 1)
    assert.match(output, /linux-arm64/)
  })

  test('handles compound versions like postgresql-documentdb 17-0.107.0', () => {
    const { status } = checkCoverage({
      database: 'postgresql-documentdb',
      version: '17-0.107.0',
      requested: 'all',
      built: ALL,
    })

    assert.equal(status, 0)
  })
})
