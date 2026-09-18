/**
 * MariaDB bundled-plugin exclusion matcher.
 *
 * The official MariaDB bintar started shipping a gamma-maturity DuckDB storage
 * engine (11.8.9 / 12.3.3 / 13.0.2) and the HTTP-calling VIDEX engine
 * (12.3.3 / 13.0.2 on linux-x64, plus the win32-x64 zip). `download.ts` strips
 * both on repack so the two official-archive platforms match the source
 * builds, which pass -DPLUGIN_DUCKDB=NO -DPLUGIN_VIDEX=NO.
 *
 * The matcher is the whole safety story: it must strip exactly the listed
 * paths, leave every other plugin alone, and refuse rather than guess when a
 * future version puts a stripped plugin somewhere new.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BUNDLED_PLUGIN_EXCLUSIONS,
  classifyArchivePath,
  normalizeArchivePath,
} from '../builds/mariadb/plugin-exclusions.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('classifyArchivePath', () => {
  test('strips every listed exclusion path', () => {
    for (const exclusion of BUNDLED_PLUGIN_EXCLUSIONS) {
      assert.equal(
        classifyArchivePath(exclusion.path),
        'strip',
        `${exclusion.path} should be stripped`,
      )
    }
  })

  test('strips the linux-x64 and win32-x64 plugin binaries', () => {
    assert.equal(classifyArchivePath('lib/plugin/ha_duckdb.so'), 'strip')
    assert.equal(classifyArchivePath('lib/plugin/ha_videx.so'), 'strip')
    assert.equal(classifyArchivePath('lib/plugin/ha_videx.dll'), 'strip')
  })

  test('strips the bundled test suites recursively', () => {
    assert.equal(
      classifyArchivePath('mariadb-test/plugin/duckdb/duckdb/t/ha_duckdb.test'),
      'strip',
    )
    assert.equal(
      classifyArchivePath('mariadb-test/plugin/videx/videx/suite.pm'),
      'strip',
    )
  })

  test('keeps the plugins the archive is supposed to carry', () => {
    const kept = [
      'bin/mariadbd',
      'bin/mariadb-dump',
      'lib/plugin/ha_archive.so',
      'lib/plugin/ha_connect.dll',
      'lib/plugin/ha_rocksdb.so',
      'lib/plugin/ha_federatedx.so',
      'lib/plugin/daemon_example.ini',
      'lib/plugin/auth_pam_tool_dir/auth_pam_tool',
      'mariadb-test/plugin/type_inet/suite.opt',
      'mariadb-test/include/default_my.cnf',
      'support-files/wsrep.cnf',
      'share/english/errmsg.sys',
      '.hostdb-metadata.json',
    ]
    for (const path of kept) {
      assert.equal(classifyArchivePath(path), 'keep', `${path} should be kept`)
    }
  })

  test('reports a stripped plugin found outside its listed path', () => {
    const surprises = [
      'lib/plugin/ha_duckdb.so.debug',
      'lib/ha_duckdb.so',
      'lib/private/libduckdb.so',
      'share/duckdb/extensions/json.duckdb_extension',
      'bin/mariadb-videx-helper',
      'etc/conf.d/videx.cnf',
    ]
    for (const path of surprises) {
      assert.equal(
        classifyArchivePath(path),
        'unexpected',
        `${path} should be reported, not deleted`,
      )
    }
  })

  test('does not treat a sibling directory as part of an exclusion', () => {
    assert.equal(
      classifyArchivePath('mariadb-test/plugin/duckdb_extra/t/x.test'),
      'unexpected',
    )
    assert.equal(
      classifyArchivePath('mariadb-test/plugin/index/t/x.test'),
      'keep',
    )
  })

  test('is a no-op for an archive that carries neither plugin', () => {
    const tenEleven = [
      'bin/mariadbd',
      'lib/plugin/ha_s3.so',
      'mariadb-test/plugin/versioning/suite.opt',
    ]
    for (const path of tenEleven) {
      assert.equal(classifyArchivePath(path), 'keep')
    }
  })
})

/**
 * The source builds (linux-arm64 via Docker, both darwin platforms natively)
 * pass -DPLUGIN_DUCKDB=NO -DPLUGIN_VIDEX=NO, which stops the engines from being
 * built - but `make install` still copies their mariadb-test suites. Both
 * packaging steps delete those two directories by hand, because neither a
 * Dockerfile RUN nor a workflow shell step can call the module above. These
 * assertions are what keeps the hand-written copies honest: add a directory
 * exclusion and this fails until both packaging steps carry it.
 */
describe('source-build packaging strips the same directories', () => {
  const directoryExclusions = BUNDLED_PLUGIN_EXCLUSIONS.filter(
    (exclusion) => exclusion.kind === 'directory',
  )

  const packagingSteps = [
    {
      label: 'builds/mariadb/Dockerfile',
      text: readFileSync(
        join(ROOT, 'builds', 'mariadb', 'Dockerfile'),
        'utf-8',
      ),
    },
    {
      label: '.github/workflows/release-mariadb.yml (macOS packaging)',
      text: readFileSync(
        join(ROOT, '.github', 'workflows', 'release-mariadb.yml'),
        'utf-8',
      ),
    },
  ]

  /** Every `rm -rf ...` command in the file, backslash continuations joined. */
  function removalCommands(text: string): string {
    const joined = text.replace(/\\\n\s*/g, ' ')
    return joined
      .split('\n')
      .filter((line) => line.includes('rm -rf'))
      .join('\n')
  }

  test('the module lists the two directories the packaging steps remove', () => {
    assert.deepEqual(
      directoryExclusions.map((exclusion) => exclusion.path),
      ['mariadb-test/plugin/duckdb', 'mariadb-test/plugin/videx'],
    )
  })

  for (const step of packagingSteps) {
    test(`${step.label} removes every directory exclusion`, () => {
      const removals = removalCommands(step.text)
      for (const exclusion of directoryExclusions) {
        assert.ok(
          removals.includes(`/${exclusion.path}`),
          `${step.label} should rm -rf ${exclusion.path}`,
        )
      }
    })

    test(`${step.label} points at the exclusion module`, () => {
      assert.ok(
        step.text.includes('builds/mariadb/plugin-exclusions.ts'),
        `${step.label} should name the module its paths are mirrored from`,
      )
    })
  }
})

describe('normalizeArchivePath', () => {
  test('normalizes separators and stray slashes', () => {
    assert.equal(
      normalizeArchivePath('lib\\plugin\\ha_videx.dll'),
      'lib/plugin/ha_videx.dll',
    )
    assert.equal(
      normalizeArchivePath('./mariadb-test/plugin/duckdb/'),
      'mariadb-test/plugin/duckdb',
    )
    assert.equal(
      normalizeArchivePath('/lib/plugin/ha_duckdb.so'),
      'lib/plugin/ha_duckdb.so',
    )
  })

  test('classifies a Windows-separated path the same as a POSIX one', () => {
    assert.equal(classifyArchivePath('lib\\plugin\\ha_videx.dll'), 'strip')
  })
})
