/**
 * PostGIS ships inside the standard PostgreSQL build, scoped by
 * builds/postgresql/postgis.sh. The Dockerfile, build-local.sh, the release
 * workflow and the smoke gate all ask that script, so its answers decide which
 * published archives carry PostGIS, which pinned sources they are built from,
 * and which source tarballs get mirrored.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isSourceMirrorTag } from '../lib/github-releases.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'builds', 'postgresql', 'postgis.sh')

function run(...args: string[]): string {
  return execFileSync('bash', [SCRIPT, ...args], { encoding: 'utf-8' }).trim()
}

function applies(version: string, platform: string): string {
  return run('applies', version, platform)
}

function pins(version: string): Record<string, string> {
  return Object.fromEntries(
    run('pins', version)
      .split('\n')
      .map((line) => line.split('=') as [string, string]),
  )
}

describe('postgis.sh applies', () => {
  test('includes PostGIS in the linux-x64 builds Cloud offers for new databases', () => {
    for (const version of ['18.6.0', '19.0.0-beta.3', '19.0.0-rc.2']) {
      assert.equal(applies(version, 'linux-x64'), 'yes', version)
    }
  })

  test('covers future 18 and 19 versions so a rebuild cannot silently drop PostGIS', () => {
    assert.equal(applies('18.7.0', 'linux-x64'), 'yes')
    assert.equal(applies('19.0.0', 'linux-x64'), 'yes')
  })

  test('leaves PostgreSQL 15, 16 and 17 unchanged', () => {
    for (const version of ['15.19.0', '16.15.0', '17.11.0']) {
      assert.equal(applies(version, 'linux-x64'), 'no', version)
    }
  })

  test('leaves unqualified platforms unchanged', () => {
    for (const platform of [
      'linux-arm64',
      'darwin-x64',
      'darwin-arm64',
      'win32-x64',
    ]) {
      assert.equal(applies('18.6.0', platform), 'no', platform)
      assert.equal(applies('19.0.0-beta.3', platform), 'no', platform)
    }
  })

  test('refuses a new in-scope major that has no PostGIS line yet', () => {
    const result = spawnSync(
      'bash',
      [SCRIPT, 'applies', '20.0.0', 'linux-x64'],
      {
        encoding: 'utf-8',
      },
    )
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /no PostGIS line/)
  })

  test('fails loudly on a version it cannot read', () => {
    const result = spawnSync(
      'bash',
      [SCRIPT, 'applies', 'latest', 'linux-x64'],
      {
        encoding: 'utf-8',
      },
    )
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  })
})

describe('postgis.sh pins', () => {
  test('mirror tags are source-mirror tags the manifest skips', () => {
    for (const version of ['18.6.0', '19.0.0-beta.3', '19.0.0-rc.2']) {
      assert.ok(isSourceMirrorTag(pins(version).MIRROR_TAG))
    }
    assert.ok(!isSourceMirrorTag('postgresql-18.6.0'))
    assert.ok(isSourceMirrorTag('sources-postgis-3.6.4/geos-3.14.1.tar.bz2'))
  })
})
