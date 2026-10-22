#!/usr/bin/env node
// Native qualification only. MONGODB_MODULE_PATH points to the official driver
// installed by the caller. No services, data, or credentials outside mkdtemp.
import assert from 'node:assert/strict'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import type { MongoClient as MongoClientType } from 'mongodb'
import { randomBytes } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  openSync,
  closeSync,
  rmSync,
} from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'

const bundle = resolve(process.argv[2] || '')
assert.ok(
  process.argv[2],
  'Usage: MONGODB_MODULE_PATH=/path/to/node_modules/mongodb node smoke-test.mjs /path/to/relocated/documentdb',
)
assert.ok(
  process.env.MONGODB_MODULE_PATH,
  'Install the official mongodb driver and set MONGODB_MODULE_PATH',
)
const { MongoClient } = createRequire(import.meta.url)(
  process.env.MONGODB_MODULE_PATH,
) as typeof import('mongodb')
const metadata = JSON.parse(
  readFileSync(join(bundle, '.hostdb-metadata.json'), 'utf8'),
)
assert.equal(metadata.version, '1.0.0')
assert.equal(metadata.sourceCommit, 'b0cb0dae85e8746f4e0b79c847894179b2f80d64')
const root = mkdtempSync(join(tmpdir(), 'docdb-native-'))
const data = join(root, 'data')
const socket = join(root, 'socket')
const configFile = join(root, 'gateway.json')
const username = userInfo().username
assert.match(username, /^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/)
mkdirSync(socket, { mode: 0o700 })
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (/^(PG|DOCUMENTDB_|OTEL_)/.test(key)) delete env[key]
}
Object.assign(env, {
  PGHOST: socket,
  PGPORT: '5432',
  PGUSER: 'postgres',
  DOCUMENTDB_TLS_STATE_DIR: join(root, 'tls'),
})
function run(tool: string, args: string[], input?: string) {
  return execFileSync(join(bundle, 'bin', tool), args, {
    env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  })
}
function sql(input: string) {
  return run(
    'psql',
    ['-X', '-tA', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    input,
  ).trim()
}
let gateway: ChildProcess | undefined
let postgresStarted = false
let client: MongoClientType | undefined
const log = openSync(join(root, 'gateway.log'), 'a', 0o600)
const server = net.createServer()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
assert.ok(address && typeof address !== 'string')
const port = address.port
await new Promise((resolve) => server.close(() => resolve(undefined)))
const password = randomBytes(24).toString('hex')
const mongoUser = 'qualification'
function uri(pwd = password) {
  return `mongodb://${mongoUser}:${pwd}@127.0.0.1:${port}/proof?authSource=admin&directConnection=true`
}
async function startGateway() {
  gateway = spawn(
    join(bundle, 'bin', 'documentdb_gateway'),
    ['run', '--config', configFile],
    { env, stdio: ['ignore', log, log] },
  )
  let spawnFailure: Error | undefined
  gateway.on('error', (error) => {
    spawnFailure = error
  })
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnFailure) throw spawnFailure
    assert.equal(
      gateway.exitCode,
      null,
      'Gateway exited before authentication succeeded',
    )
    client = new MongoClient(uri(), {
      timeoutMS: 10000,
      serverSelectionTimeoutMS: 500,
      connectTimeoutMS: 500,
    })
    try {
      await client.connect()
      await client!.db('admin').command({ ping: 1 })
      return
    } catch {
      await client!.close()
    }
    await delay(500)
  }
  throw new Error(
    'Gateway did not accept authenticated MongoDB queries within 60 seconds',
  )
}
async function stopGateway() {
  if (!gateway || gateway.exitCode !== null) return
  const exited = new Promise((resolve) => gateway!.once('exit', resolve))
  gateway.kill('SIGTERM')
  await Promise.race([exited, delay(10000)])
  if (gateway.exitCode === null && gateway.signalCode === null) {
    gateway.kill('SIGKILL')
    await exited
  }
}
try {
  assert.match(run('documentdb_gateway', ['--version']), /1\.0\.0/)
  run('initdb', [
    '-D',
    data,
    '-U',
    'postgres',
    '--encoding=UTF8',
    '--no-locale',
    '--auth=peer',
  ])
  writeFileSync(
    join(data, 'postgresql.conf'),
    [
      "listen_addresses = ''",
      'port = 5432',
      `unix_socket_directories = '${socket}'`,
      'unix_socket_permissions = 0700',
      `documentdb.localhost_connection_string = 'host=${socket}'`,
      "shared_preload_libraries = 'pg_cron,pg_documentdb_core,pg_documentdb,pg_documentdb_extended_rum'",
      "cron.database_name = 'postgres'",
      'cron.launch_active_jobs = off',
      "log_statement = 'none'",
      "log_min_error_statement = 'panic'",
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(data, 'pg_hba.conf'),
    'local all all peer map=qualification\n',
  )
  writeFileSync(
    join(data, 'pg_ident.conf'),
    [
      'postgres',
      'spindb_gateway',
      'documentdb_bg_worker_role',
      '+documentdb_admin_role',
      '+documentdb_readwrite_role',
      '+documentdb_readonly_role',
    ]
      .map((role) => `qualification ${username} ${role}`)
      .join('\n') + '\n',
  )
  run('pg_ctl', [
    'start',
    '-D',
    data,
    '-l',
    join(root, 'postgres.log'),
    '-w',
    '-t',
    '30',
  ])
  postgresStarted = true
  sql(
    'CREATE EXTENSION documentdb CASCADE; CREATE EXTENSION documentdb_extended_rum;',
  )
  assert.equal(
    sql("SELECT extversion FROM pg_extension WHERE extname='documentdb';"),
    '1.0-0',
  )
  sql(
    'CREATE ROLE spindb_gateway LOGIN; GRANT documentdb_admin_role, documentdb_readwrite_role, documentdb_readonly_role TO spindb_gateway;',
  )
  const userCommand = JSON.stringify({
    createUser: mongoUser,
    pwd: password,
    roles: [
      { role: 'readWriteAnyDatabase', db: 'admin' },
      { role: 'clusterAdmin', db: 'admin' },
    ],
    $db: 'admin',
  })
  sql(
    `SELECT documentdb_api.create_user('${userCommand.replaceAll("'", "''")}'::documentdb_core.bson);`,
  )
  execFileSync(
    '/bin/bash',
    [
      join(bundle, 'share/documentdb/documentdb_install_getparameter_stub.sh'),
      '5432',
      join(bundle, 'bin/psql'),
    ],
    { env, stdio: 'pipe', timeout: 30000 },
  )
  writeFileSync(
    configFile,
    JSON.stringify({
      NodeHostName: 'localhost',
      BlockedRolePrefixes: [
        'documentdb',
        'citus',
        'pg',
        'internal_role',
        'spindb_',
      ],
      PostgresSystemUser: 'spindb_gateway',
      PostgresDataUser: 'spindb_gateway',
      PostgresHostName: socket,
      PostgresPort: 5432,
      PostgresDatabase: 'postgres',
      GatewayListenPort: port,
      UseLocalHost: true,
      EnforceTls: false,
      EnableV2Runtime: true,
      AsyncRuntimeWorkerThreads: 2,
      CertificateOptions: { CertType: 'PemAutoGenerated' },
      TelemetryOptions: {
        ServiceName: 'documentdb_gateway',
        Metrics: { Enabled: false },
        Tracing: { Enabled: false },
      },
    }),
    { mode: 0o600 },
  )
  await startGateway()
  const wrong = new MongoClient(uri('deliberately_wrong'), {
    serverSelectionTimeoutMS: 2000,
  })
  try {
    await assert.rejects(
      () => wrong.connect(),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 18,
    )
  } finally {
    await wrong.close()
  }
  await client!
    .db('proof')
    .collection<{ _id: string; value: number }>('rows')
    .insertOne({ _id: 'persisted', value: 42 })
  assert.equal(
    (
      await client!
        .db('proof')
        .collection<{ _id: string; value: number }>('rows')
        .findOne({ _id: 'persisted' })
    )?.value,
    42,
  )
  await client!.close()
  await stopGateway()
  run('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '30'])
  postgresStarted = false
  run('pg_ctl', [
    'start',
    '-D',
    data,
    '-l',
    join(root, 'postgres.log'),
    '-w',
    '-t',
    '30',
  ])
  postgresStarted = true
  await startGateway()
  assert.equal(
    (
      await client!
        .db('proof')
        .collection<{ _id: string; value: number }>('rows')
        .findOne({ _id: 'persisted' })
    )?.value,
    42,
  )
  console.log(
    JSON.stringify({
      version: metadata.version,
      postgres: metadata.components.postgresql,
      authenticated: true,
      wrongPasswordRejected: true,
      persistedRestart: true,
    }),
  )
} catch (error) {
  // Never print command input, URIs, or generated credential-bearing SQL.
  console.error(
    `Native qualification failed (${error instanceof Error ? error.name : 'unknown error'}). Local diagnostic directory: ${root}`,
  )
  process.exitCode = 1
} finally {
  await client?.close().catch(() => {})
  await stopGateway()
  if (postgresStarted)
    run('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '30'])
  closeSync(log)
  if (!process.exitCode) rmSync(root, { recursive: true })
}
