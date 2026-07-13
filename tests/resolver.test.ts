/**
 * Resolver unit tests.
 *
 * Run with: pnpm test
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveVersion,
  normalizeVersion,
  listEngines,
  listVersions,
  getSupportedMajorVersions,
  getMajorDefault,
  getEngineDefaults,
  getReleaseInfo,
  getAvailablePlatforms,
  isVersionDeprecated,
  getReleaseType,
  isVersionPrerelease,
  getPrereleaseVersions,
  getDatabaseEntry,
  compareVersions,
} from '../lib/resolver.ts'

// ─── compareVersions ─────────────────────────────────────────────────────────

describe('compareVersions', () => {
  test('standard semver', () => {
    assert.ok(compareVersions('1.2.3', '1.2.2') > 0)
    assert.ok(compareVersions('1.2.2', '1.2.3') < 0)
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  })

  test('different lengths — missing segments treated as 0', () => {
    assert.equal(compareVersions('1.2', '1.2.0'), 0)
    assert.equal(compareVersions('25', '25.0.0'), 0)
    // ClickHouse 4-part
    assert.ok(compareVersions('25.12.3.21', '25.12.3.20') > 0)
    assert.ok(compareVersions('25.12.3.21', '25.12.3') > 0)
  })

  test('compound format like postgresql-documentdb 17-0.107.0', () => {
    assert.ok(compareVersions('17-0.107.0', '17-0.106.0') > 0)
    assert.ok(compareVersions('17-0.107.0', '16-0.107.0') > 0)
    assert.ok(compareVersions('17', '17-0.107.0') < 0) // suffix-less sorts before
  })
})

// ─── listEngines ─────────────────────────────────────────────────────────────

describe('listEngines', () => {
  test('returns 22 engines after the May 2026 wave', () => {
    const engines = listEngines()
    assert.equal(engines.length, 22)
    assert.ok(engines.includes('postgresql'))
    assert.ok(engines.includes('mongodb'))
    assert.ok(engines.includes('postgresql-documentdb'))
  })

  test('result is sorted', () => {
    const engines = listEngines()
    const sorted = [...engines].sort()
    assert.deepEqual(engines, sorted)
  })
})

// ─── resolveVersion identity ─────────────────────────────────────────────────

describe('resolveVersion — identity', () => {
  test('full semver returns itself', () => {
    assert.equal(resolveVersion('postgresql', '17.10.0'), '17.10.0')
    assert.equal(resolveVersion('mongodb', '8.0.23'), '8.0.23')
    assert.equal(resolveVersion('mariadb', '11.4.10'), '11.4.10')
  })

  test('unknown full semver returns null', () => {
    assert.equal(resolveVersion('postgresql', '99.99.99'), null)
    assert.equal(resolveVersion('mongodb', '7.0.99'), null)
  })

  test('unknown engine returns null', () => {
    assert.equal(resolveVersion('made-up-engine', '1.0.0'), null)
  })
})

// ─── resolveVersion via defaults ─────────────────────────────────────────────

describe('resolveVersion — defaults policy', () => {
  // Multi-track engines where default differs from latest
  test('MongoDB 8 → 8.0.23 (LTS, NOT latest 8.2.9)', () => {
    assert.equal(resolveVersion('mongodb', '8'), '8.0.23')
  })

  test('MariaDB 11 → 11.8.6 (latest, NOT LTS 11.4)', () => {
    assert.equal(resolveVersion('mariadb', '11'), '11.8.6')
  })

  test('MySQL 8 → 8.4.9 (LTS, NOT 8.0.40)', () => {
    assert.equal(resolveVersion('mysql', '8'), '8.4.9')
  })

  test('FerretDB 1 / 2 dispatch to right tracks', () => {
    assert.equal(resolveVersion('ferretdb', '1'), '1.24.2')
    assert.equal(resolveVersion('ferretdb', '2'), '2.7.0')
  })

  test('PostgreSQL each major → its single track default', () => {
    assert.equal(resolveVersion('postgresql', '15'), '15.18.0')
    assert.equal(resolveVersion('postgresql', '16'), '16.14.0')
    assert.equal(resolveVersion('postgresql', '17'), '17.10.0')
    assert.equal(resolveVersion('postgresql', '18'), '18.4.0')
  })

  test('postgresql-documentdb 17 → compound version', () => {
    assert.equal(resolveVersion('postgresql-documentdb', '17'), '17-0.107.0')
  })
})

// ─── resolveVersion via major.minor prefix ──────────────────────────────────

describe('resolveVersion — major.minor prefix', () => {
  test('PostgreSQL 17.7 → highest 17.7.x', () => {
    assert.equal(resolveVersion('postgresql', '17.7'), '17.7.0')
  })

  test('PostgreSQL 17.10 → 17.10.0', () => {
    assert.equal(resolveVersion('postgresql', '17.10'), '17.10.0')
  })

  test('MariaDB 11.4 → 11.4.10', () => {
    assert.equal(resolveVersion('mariadb', '11.4'), '11.4.10')
  })

  test('MongoDB 8.2 → 8.2.9 (latest in 8.2 even though 8 default is 8.0)', () => {
    assert.equal(resolveVersion('mongodb', '8.2'), '8.2.9')
  })

  test('Unknown major.minor returns null', () => {
    assert.equal(resolveVersion('postgresql', '99.99'), null)
  })
})

// ─── normalizeVersion ────────────────────────────────────────────────────────

describe('normalizeVersion', () => {
  test('returns input unchanged on unknown', () => {
    assert.equal(normalizeVersion('postgresql', '99.99.99'), '99.99.99')
    assert.equal(normalizeVersion('mongodb', '99'), '99')
    assert.equal(normalizeVersion('made-up-engine', 'foo'), 'foo')
  })

  test('returns resolved version on known', () => {
    assert.equal(normalizeVersion('postgresql', '17'), '17.10.0')
    assert.equal(normalizeVersion('mongodb', '8'), '8.0.23')
  })
})

// ─── listVersions ────────────────────────────────────────────────────────────

describe('listVersions', () => {
  test('format=full returns all full versions sorted descending', () => {
    const pg = listVersions('postgresql', { format: 'full' })
    assert.ok(pg.includes('18.4.0'))
    assert.ok(pg.includes('15.15.0'))
    assert.equal(pg[0], '18.4.0') // highest first
  })

  test('format=major-minor returns unique X.Y prefixes', () => {
    const pg = listVersions('postgresql', { format: 'major-minor' })
    assert.deepEqual(pg, [
      '18.4',
      '18.1',
      '17.10',
      '17.7',
      '16.14',
      '16.11',
      '15.18',
      '15.15',
    ])
  })

  test('format=major returns unique X prefixes', () => {
    const pg = listVersions('postgresql', { format: 'major' })
    assert.deepEqual(pg, ['18', '17', '16', '15'])
  })

  test('default format is full', () => {
    const a = listVersions('sqlite')
    const b = listVersions('sqlite', { format: 'full' })
    assert.deepEqual(a, b)
  })
})

// ─── getSupportedMajorVersions ───────────────────────────────────────────────

describe('getSupportedMajorVersions', () => {
  test('uses defaults block when present', () => {
    assert.deepEqual(getSupportedMajorVersions('postgresql'), [
      '18',
      '17',
      '16',
      '15',
    ])
    assert.deepEqual(getSupportedMajorVersions('mongodb'), ['8', '7'])
    assert.deepEqual(getSupportedMajorVersions('mariadb'), ['11', '10'])
  })

  test('every engine returns at least one major', () => {
    for (const engine of listEngines()) {
      assert.ok(
        getSupportedMajorVersions(engine).length > 0,
        `${engine} returned 0 majors`,
      )
    }
  })
})

// ─── getMajorDefault ─────────────────────────────────────────────────────────

describe('getMajorDefault', () => {
  test('returns explicit default', () => {
    assert.equal(getMajorDefault('mongodb', '8'), '8.0.23')
    assert.equal(getMajorDefault('mariadb', '11'), '11.8.6')
  })

  test('returns null for undeclared major', () => {
    assert.equal(getMajorDefault('postgresql', '99'), null)
  })
})

// ─── getEngineDefaults ───────────────────────────────────────────────────────

describe('getEngineDefaults', () => {
  test('default differs from latest for MongoDB (LTS policy)', () => {
    const d = getEngineDefaults('mongodb')
    assert.equal(d.defaultVersion, '8.0.23') // LTS
    assert.equal(d.latestVersion, '8.2.9') // newest
  })

  test('default equals latest for single-track engines', () => {
    const d = getEngineDefaults('postgresql')
    assert.equal(d.defaultVersion, '18.4.0')
    assert.equal(d.latestVersion, '18.4.0')
  })
})

// ─── isVersionDeprecated ─────────────────────────────────────────────────────

describe('isVersionDeprecated', () => {
  test('returns false for current versions', () => {
    assert.equal(isVersionDeprecated('postgresql', '18.4.0'), false)
  })

  test('returns false for unknown versions', () => {
    assert.equal(isVersionDeprecated('postgresql', '99.99.99'), false)
  })
})

// ─── getReleaseInfo ──────────────────────────────────────────────────────────

describe('getReleaseInfo', () => {
  test('returns asset info for known version+platform', () => {
    const info = getReleaseInfo('postgresql', '18.4.0', 'linux-x64')
    assert.ok(info)
    assert.ok(info.url.includes('postgresql-18.4.0-linux-x64'))
    assert.ok(info.sha256.length > 0)
    assert.ok(info.size > 0)
  })

  test('returns null for unknown version', () => {
    assert.equal(getReleaseInfo('postgresql', '99.99.99', 'linux-x64'), null)
  })

  test('returns null for unsupported platform', () => {
    assert.equal(getReleaseInfo('clickhouse', '25.12.3.21', 'win32-x64'), null)
  })
})

// ─── getAvailablePlatforms ───────────────────────────────────────────────────

describe('getAvailablePlatforms', () => {
  test('ClickHouse omits win32-x64', () => {
    const platforms = getAvailablePlatforms('clickhouse', '25.12.3.21')
    assert.ok(platforms.includes('linux-x64'))
    assert.ok(!platforms.includes('win32-x64'))
  })
})

// ─── prerelease support ──────────────────────────────────────────────────────
//
// These cases depend on postgresql's `19.0.0-beta.1` entry (releaseType: beta),
// added to databases.yml by the coordinating agent. Until databases.json is
// regenerated (pnpm prep) they will fail — that's expected.

describe('prerelease — postgresql 19.0.0-beta.1', () => {
  test('exact version resolves to itself', () => {
    assert.equal(resolveVersion('postgresql', '19.0.0-beta.1'), '19.0.0-beta.1')
  })

  test("'19' does not prefix-match into the beta", () => {
    assert.equal(resolveVersion('postgresql', '19'), null)
  })

  test("'19.0' does not prefix-match into the beta", () => {
    assert.equal(resolveVersion('postgresql', '19.0'), null)
  })

  test('listVersions excludes the beta by default', () => {
    assert.ok(!listVersions('postgresql').includes('19.0.0-beta.1'))
  })

  test('listVersions includes the beta with includePrerelease', () => {
    assert.ok(
      listVersions('postgresql', { includePrerelease: true }).includes(
        '19.0.0-beta.1',
      ),
    )
  })

  test('getEngineDefaults still returns GA 18.4.0 for both fields', () => {
    const d = getEngineDefaults('postgresql')
    assert.equal(d.defaultVersion, '18.4.0')
    assert.equal(d.latestVersion, '18.4.0')
  })

  test("getSupportedMajorVersions does not include '19'", () => {
    assert.ok(!getSupportedMajorVersions('postgresql').includes('19'))
  })

  test('getReleaseType / isVersionPrerelease / getPrereleaseVersions', () => {
    assert.equal(getReleaseType('postgresql', '19.0.0-beta.1'), 'beta')
    assert.equal(isVersionPrerelease('postgresql', '19.0.0-beta.1'), true)
    assert.ok(getPrereleaseVersions('postgresql').includes('19.0.0-beta.1'))
  })

  test('getReleaseType is ga for a GA version and null for unknown', () => {
    assert.equal(getReleaseType('postgresql', '18.4.0'), 'ga')
    assert.equal(isVersionPrerelease('postgresql', '18.4.0'), false)
    assert.equal(getReleaseType('postgresql', '99.99.99'), null)
  })
})

// ─── getDatabaseEntry ────────────────────────────────────────────────────────

describe('getDatabaseEntry', () => {
  test('returns full entry for known engine', () => {
    const e = getDatabaseEntry('postgresql')
    assert.ok(e)
    assert.equal(e.displayName, 'PostgreSQL')
    assert.ok(e.defaults)
  })

  test('returns null for unknown engine', () => {
    assert.equal(getDatabaseEntry('not-real'), null)
  })
})
