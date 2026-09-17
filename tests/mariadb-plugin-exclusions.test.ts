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

import {
  BUNDLED_PLUGIN_EXCLUSIONS,
  classifyArchivePath,
  normalizeArchivePath,
} from '../builds/mariadb/plugin-exclusions.ts'

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
