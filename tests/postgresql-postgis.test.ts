/**
 * PostGIS ships inside the standard PostgreSQL build, scoped by
 * builds/postgresql/postgis.sh. The Dockerfile, build-local.sh, the release
 * workflow and the smoke gate all ask that script, so its answers decide which
 * published archives carry PostGIS, which pinned sources they are built from,
 * and which source tarballs get mirrored.
 *
 * The release workflow also has a dry-run mode for proving a recipe on a
 * branch. Its upload job overwrites the live archive (`upload-to-r2.ts
 * --force`), so every publishing job must be gated on it; these tests parse the
 * real workflow to keep that true.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import {
  isSourceMirrorTag,
  SOURCE_MIRROR_TAG_PREFIX,
} from '../lib/github-releases.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'builds', 'postgresql', 'postgis.sh')
const WORKFLOW = join(ROOT, '.github', 'workflows', 'release-postgresql.yml')

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
    for (const version of ['18.6.0', '19.0.0-beta.3']) {
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
  test('PostgreSQL 18 gets released PostGIS 3.6.4', () => {
    assert.deepEqual(pins('18.6.0'), {
      POSTGIS: '3.6.4',
      GEOS: '3.14.1',
      PROJ: '9.8.1',
      MIRROR_TAG: 'sources-postgis-3.6.4',
    })
  })

  test('the PostgreSQL 19 beta gets PostGIS 3.7.0rc2', () => {
    assert.deepEqual(pins('19.0.0-beta.3'), {
      POSTGIS: '3.7.0rc2',
      GEOS: '3.14.1',
      PROJ: '9.8.1',
      MIRROR_TAG: 'sources-postgis-3.7.0rc2',
    })
  })

  test('every pinned source carries a 64-hex sha256 in the script itself', () => {
    const script = readFileSync(SCRIPT, 'utf-8')
    for (const name of [
      'GEOS_SHA256',
      'PROJ_SHA256',
      'POSTGIS_36_SHA256',
      'POSTGIS_37_SHA256',
    ]) {
      assert.match(
        script,
        new RegExp(`^${name}="[0-9a-f]{64}"$`, 'm'),
        `${name} is not a pinned sha256`,
      )
    }
    const gmp = script.match(/GMP_SOURCE_FILES=\(([^)]*)\)/)
    assert.ok(gmp, 'GMP_SOURCE_FILES is missing')
    const entries = gmp[1].trim().split('\n')
    assert.equal(entries.length, 3)
    for (const entry of entries) {
      assert.match(entry.trim(), /^"\S+ [0-9a-f]{64}"$/)
    }
  })

  test('mirror tags are source-mirror tags the manifest skips', () => {
    for (const version of ['18.6.0', '19.0.0-beta.3']) {
      assert.ok(isSourceMirrorTag(pins(version).MIRROR_TAG))
    }
    assert.equal(SOURCE_MIRROR_TAG_PREFIX, 'sources-')
    assert.ok(!isSourceMirrorTag('postgresql-18.6.0'))
    assert.ok(isSourceMirrorTag('sources-postgis-3.6.4/geos-3.14.1.tar.bz2'))
  })
})

describe('PostGIS build wiring', () => {
  test('only postgis.sh names the PostGIS, GEOS and PROJ sources', () => {
    for (const file of [
      'builds/postgresql/Dockerfile',
      'builds/postgresql/build-local.sh',
      'builds/postgresql/smoke-postgis.sh',
      '.github/workflows/release-postgresql.yml',
    ]) {
      const content = readFileSync(join(ROOT, file), 'utf-8')
      assert.ok(
        !content.includes('download.osgeo.org'),
        `${file} duplicates a PostGIS source URL`,
      )
      assert.ok(
        !/\b3\.6\.4\b|3\.7\.0rc2|\b3\.14\.1\b|\b9\.8\.1\b/.test(content),
        `${file} hard-codes a PostGIS, GEOS or PROJ version`,
      )
    }
  })

  test('the Dockerfile installs and verifies through postgis.sh', () => {
    const dockerfile = readFileSync(
      join(ROOT, 'builds/postgresql/Dockerfile'),
      'utf-8',
    )
    assert.match(dockerfile, /postgis\.sh install/)
    assert.match(dockerfile, /postgis\.sh verify/)
    const install = dockerfile.indexOf('postgis.sh install')
    const packager = dockerfile.indexOf('AS packager')
    const verify = dockerfile.indexOf('postgis.sh verify')
    assert.ok(install < packager, 'PostGIS must be installed in the builder')
    assert.ok(
      verify > dockerfile.indexOf('patchelf --set-rpath', packager),
      'PostGIS must be verified after the RPATH rewrite',
    )
  })

  test('verify and the smoke gate never swallow a failure', () => {
    for (const file of [
      'builds/postgresql/postgis.sh',
      'builds/postgresql/smoke-postgis.sh',
    ]) {
      const content = readFileSync(join(ROOT, file), 'utf-8')
      assert.ok(!content.includes('|| true'), `${file} contains || true`)
    }
  })

  test('the smoke gate runs with PROJ_DATA unset against a relocated archive', () => {
    const smoke = readFileSync(
      join(ROOT, 'builds/postgresql/smoke-postgis.sh'),
      'utf-8',
    )
    assert.match(smoke, /unset PROJ_DATA PROJ_LIB LD_LIBRARY_PATH/)
    const workflow = readFileSync(WORKFLOW, 'utf-8')
    assert.match(workflow, /dst=\/relocated\/postgresql/)
    assert.match(workflow, /smoke-postgis\.sh \/relocated\/postgresql/)
  })
})

type Job = {
  needs?: string | string[]
  if?: string
  steps?: { run?: string }[]
}

describe('release-postgresql.yml dry run', () => {
  const workflow = parse(readFileSync(WORKFLOW, 'utf-8')) as {
    on: {
      workflow_dispatch: {
        inputs: Record<string, { type?: string; default?: unknown }>
      }
    }
    jobs: Record<string, Job>
  }
  const jobs = workflow.jobs

  test('offers a boolean dry_run input that defaults to a real release', () => {
    const input = workflow.on.workflow_dispatch.inputs.dry_run
    assert.ok(input, 'dry_run input is missing')
    assert.equal(input.type, 'boolean')
    assert.equal(input.default, false)
  })

  test('every publishing job is gated on !inputs.dry_run', () => {
    for (const name of [
      'mirror-postgis-sources',
      'release',
      'upload-to-r2',
      'update-releases',
    ]) {
      assert.ok(jobs[name], `${name} job is missing`)
      assert.equal(
        jobs[name].if,
        '${{ !inputs.dry_run }}',
        `${name} must carry if: \${{ !inputs.dry_run }}`,
      )
    }
  })

  test('any job that can write to GitHub releases, R2 or the manifest is gated', () => {
    const publishing =
      /publish-release\.sh|upload-to-r2\.ts|build-releases-json\.ts|gh release (create|upload|edit|delete)|git push/
    for (const [name, job] of Object.entries(jobs)) {
      const writes = (job.steps ?? []).some((step) =>
        publishing.test(step.run ?? ''),
      )
      if (!writes) continue
      assert.equal(
        job.if,
        '${{ !inputs.dry_run }}',
        `${name} publishes but is not gated on the dry run`,
      )
    }
  })

  test('the dry-run report job runs only on a dry run', () => {
    assert.equal(jobs['dry-run-checks']?.if, '${{ inputs.dry_run }}')
  })

  test('sources are mirrored before the release is published', () => {
    const needs = jobs.release.needs
    assert.ok(Array.isArray(needs) && needs.includes('mirror-postgis-sources'))
    const mirrorRuns = (jobs['mirror-postgis-sources'].steps ?? [])
      .map((step) => step.run ?? '')
      .join('\n')
    assert.match(mirrorRuns, /postgis\.sh fetch-sources/)
    assert.ok(
      !/upload-to-r2\.ts[^\n]*--force/.test(mirrorRuns),
      'source mirrors must never be overwritten',
    )
  })
})
