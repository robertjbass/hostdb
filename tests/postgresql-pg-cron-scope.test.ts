/**
 * pg_cron ships inside the standard PostgreSQL build, scoped by
 * builds/postgresql/pg-cron.sh. The Dockerfile, build-local.sh and the release
 * workflow all ask that script, so its answer decides which published archives
 * carry the extension and which ones the release gate smoke-tests.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'builds', 'postgresql', 'pg-cron.sh')

function applies(version: string, platform: string): string {
  return execFileSync('bash', [SCRIPT, 'applies', version, platform], {
    encoding: 'utf-8',
  }).trim()
}

describe('pg-cron.sh applies', () => {
  test('includes pg_cron in the linux-x64 builds Cloud offers for new databases', () => {
    for (const version of ['18.6.0', '19.0.0-beta.3']) {
      assert.equal(applies(version, 'linux-x64'), 'yes', version)
    }
  })

  test('covers future 18+ versions so a new patch cannot silently drop pg_cron', () => {
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
    }
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

describe('pg_cron build wiring', () => {
  test('no build path pins pg_cron versions by name', () => {
    for (const file of [
      'builds/postgresql/Dockerfile',
      'builds/postgresql/build-local.sh',
      '.github/workflows/release-postgresql.yml',
    ]) {
      const content = readFileSync(join(ROOT, file), 'utf-8')
      assert.ok(
        !/-cron\.(\d|\*)/.test(content),
        `${file} still special-cases a -cron revision`,
      )
      assert.ok(
        !content.includes('codeload.github.com/citusdata'),
        `${file} duplicates the pg_cron source`,
      )
    }
  })

  test('the Dockerfile builds and verifies through pg-cron.sh', () => {
    const dockerfile = readFileSync(
      join(ROOT, 'builds/postgresql/Dockerfile'),
      'utf-8',
    )
    assert.match(dockerfile, /pg-cron\.sh install/)
    assert.match(dockerfile, /pg-cron\.sh verify/)
  })
})
