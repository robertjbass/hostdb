/**
 * Defaults-sync test.
 *
 * For every engine, for every key that spindb's current `engines/<X>/version-maps.ts`
 * declares, the hostdb resolver must return the exact same full-version string.
 *
 * The snapshot below is the authoritative "spindb behavior at integration time"
 * captured from ~/dev/spindb on 2026-05-15. It's the contract that hostdb's
 * resolver + defaults block must satisfy *before* publishing to npm.
 *
 * If this test fails:
 *   - hostdb's `databases.yml` defaults block has drifted from spindb's behavior, OR
 *   - spindb's MAP encodes something the resolver can't express (real bug).
 *
 * In either case: don't publish. Decide whether to fix forward or update the
 * snapshot. Update only with explicit user ratification.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { resolveVersion } from '../lib/resolver.ts'

/**
 * Snapshot of every `_VERSION_MAP` entry in spindb's `engines/<X>/version-maps.ts`
 * as of 2026-05-15. Format: { engine: { input: expectedFullVersion } }.
 */
const SNAPSHOT: Record<string, Record<string, string>> = {
  clickhouse: {
    '25': '25.12.3.21',
    '25.12': '25.12.3.21',
    '25.12.3': '25.12.3.21',
    '25.12.3.21': '25.12.3.21',
  },
  cockroachdb: {
    '25': '25.4.2',
    '25.4': '25.4.2',
    '25.4.2': '25.4.2',
  },
  couchdb: {
    '3': '3.5.2',
    '3.5': '3.5.2',
    '3.5.1': '3.5.1',
    '3.5.2': '3.5.2',
  },
  duckdb: {
    '1': '1.5.5',
    '1.4': '1.4.4',
    '1.4.3': '1.4.3',
    '1.4.4': '1.4.4',
    '1.5': '1.5.5',
    '1.5.5': '1.5.5',
  },
  ferretdb: {
    '1': '1.24.2',
    '1.24': '1.24.2',
    '1.24.2': '1.24.2',
    '2': '2.7.0',
    '2.7': '2.7.0',
    '2.7.0': '2.7.0',
  },
  influxdb: {
    '3': '3.10.5',
    '3.8': '3.8.0',
    '3.10': '3.10.5',
    '3.8.0': '3.8.0',
    '3.10.5': '3.10.5',
  },
  libsql: {
    '0': '0.24.32',
    '0.24': '0.24.32',
    '0.24.32': '0.24.32',
  },
  mariadb: {
    '10': '10.11.16',
    '11': '11.8.8',
    '10.11': '10.11.16',
    '11.4': '11.4.10',
    '11.8': '11.8.8',
    '10.11.15': '10.11.15',
    '10.11.16': '10.11.16',
    '11.4.5': '11.4.5',
    '11.4.10': '11.4.10',
    '11.8.5': '11.8.5',
    '11.8.6': '11.8.6',
    '11.8.8': '11.8.8',
  },
  meilisearch: {
    '1': '1.52.0',
    '1.33': '1.33.1',
    '1.43': '1.43.1',
    '1.52': '1.52.0',
    '1.33.1': '1.33.1',
    '1.43.1': '1.43.1',
    '1.52.0': '1.52.0',
  },
  mongodb: {
    // '8' stays pinned to the 8.0 LTS line by the defaults block; without it a bare
    // '8' would prefix-match into 8.2.x.
    '7': '7.0.39',
    '8': '8.0.28',
    '7.0': '7.0.39',
    '8.0': '8.0.28',
    '8.2': '8.2.12',
    '7.0.28': '7.0.28',
    '7.0.34': '7.0.34',
    '7.0.39': '7.0.39',
    '8.0.17': '8.0.17',
    '8.0.23': '8.0.23',
    '8.0.28': '8.0.28',
    '8.2.3': '8.2.3',
    '8.2.9': '8.2.9',
    '8.2.12': '8.2.12',
  },
  mysql: {
    '8': '8.4.11',
    '9': '9.7.2',
    '8.0': '8.0.40',
    '8.4': '8.4.11',
    '9.1': '9.1.0',
    '9.5': '9.5.0',
    '9.6': '9.6.0',
    '9.7': '9.7.2',
    '8.0.40': '8.0.40',
    // 8.4.3 disabled (enabled: false) in 0.33.2 — superseded by 8.4.9; no longer resolvable.
    '8.4.9': '8.4.9',
    '8.4.11': '8.4.11',
    '9.1.0': '9.1.0',
    '9.5.0': '9.5.0',
    '9.6.0': '9.6.0',
    '9.7.2': '9.7.2',
  },
  postgresql: {
    '15': '15.18.0',
    '16': '16.14.0',
    '17': '17.10.0',
    '18': '18.4.0',
    '15.15': '15.15.0',
    '15.18': '15.18.0',
    '16.11': '16.11.0',
    '16.14': '16.14.0',
    '17.7': '17.7.0',
    '17.10': '17.10.0',
    '18.1': '18.1.0',
    '18.4': '18.4.0',
    '15.15.0': '15.15.0',
    '15.18.0': '15.18.0',
    '16.11.0': '16.11.0',
    '16.14.0': '16.14.0',
    '17.7.0': '17.7.0',
    '17.10.0': '17.10.0',
    '18.1.0': '18.1.0',
    '18.4.0': '18.4.0',
    // Prerelease: resolves only by exact string. '19' is intentionally absent —
    // it must NOT prefix-match into the beta (asserted in resolver.test.ts).
    '19.0.0-beta.1': '19.0.0-beta.1',
  },
  'postgresql-documentdb': {
    '17': '17-0.107.0',
    '17-0.107.0': '17-0.107.0',
  },
  qdrant: {
    '1': '1.18.3',
    '1.16': '1.16.3',
    '1.18': '1.18.3',
    '1.16.3': '1.16.3',
    '1.18.3': '1.18.3',
  },
  questdb: {
    '9': '9.4.3',
    '9.2': '9.2.3',
    '9.4': '9.4.3',
    '9.2.3': '9.2.3',
    '9.4.3': '9.4.3',
  },
  redis: {
    // 0.32.0 policy change: '7' now resolves to the 7.2.x line (BSD-3-Clause) instead of
    // 7.4.9 (RSALv2/SSPLv1) so managed-service consumers get the open-source line
    // by default. 7.4.x entries kept — deprecated versions still resolve.
    '7': '7.2.15',
    '8': '8.4.5',
    '7.2': '7.2.15',
    '7.4': '7.4.10',
    '8.4': '8.4.5',
    '7.2.14': '7.2.14',
    '7.2.15': '7.2.15',
    '7.4.7': '7.4.7',
    '7.4.9': '7.4.9',
    '7.4.10': '7.4.10',
    '8.4.0': '8.4.0',
    '8.4.5': '8.4.5',
  },
  sqlite: {
    '3': '3.53.4',
    '3.51': '3.51.2',
    '3.53': '3.53.4',
    '3.51.2': '3.51.2',
    '3.53.1': '3.53.1',
    '3.53.4': '3.53.4',
  },
  surrealdb: {
    '2': '2.3.2',
    '2.3': '2.3.2',
    '2.3.2': '2.3.2',
  },
  tigerbeetle: {
    '0': '0.16.70',
    '0.16': '0.16.70',
    '0.16.70': '0.16.70',
  },
  typedb: {
    '3': '3.12.1',
    '3.12': '3.12.1',
    '3.12.0': '3.12.0',
    '3.12.1': '3.12.1',
    '3.11': '3.11.5',
    '3.11.5': '3.11.5',
    '3.8': '3.8.0',
    '3.8.0': '3.8.0',
  },
  valkey: {
    '8': '8.0.10',
    '9': '9.0.5',
    '8.0': '8.0.10',
    '9.0': '9.0.5',
    '8.0.6': '8.0.6',
    '8.0.9': '8.0.9',
    '8.0.10': '8.0.10',
    '9.0.1': '9.0.1',
    '9.0.4': '9.0.4',
    '9.0.5': '9.0.5',
  },
  weaviate: {
    '1': '1.38.8',
    '1.35': '1.35.7',
    '1.38': '1.38.8',
    '1.35.7': '1.35.7',
    '1.38.8': '1.38.8',
  },
}

describe('defaults-sync — hostdb resolver matches spindb MAPs byte-for-byte', () => {
  for (const [engine, mappings] of Object.entries(SNAPSHOT)) {
    describe(engine, () => {
      for (const [input, expected] of Object.entries(mappings)) {
        test(`${engine}.resolveVersion('${input}') → '${expected}'`, () => {
          const actual = resolveVersion(engine, input)
          assert.equal(
            actual,
            expected,
            `${engine} '${input}' should resolve to '${expected}' but got '${actual}'`,
          )
        })
      }
    })
  }
})
