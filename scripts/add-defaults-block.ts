/**
 * One-off script to add the `defaults` block to every engine in databases.yml.
 *
 * The defaults table is the explicit ratification of LTS-vs-latest policies
 * that today live only as comments in spindb's hand-written version-maps.ts files.
 *
 * Run with: pnpm tsx scripts/add-defaults-block.ts
 *
 * Idempotent: if `defaults:` already exists for an engine, replaces it.
 *
 * After this script runs once, delete it. Future edits go through the
 * regular `pnpm prep` flow.
 */

import fs from 'node:fs'
import path from 'node:path'

// Source of truth for what each major key resolves to.
// Mirrors spindb/engines/<X>/version-maps.ts as of 2026-05-15.
// Multi-track engines are commented to call out the policy choice.
const DEFAULTS: Record<string, Record<string, string>> = {
  clickhouse: { '25': '25.12.3.21' },
  cockroachdb: { '25': '25.4.2' },
  couchdb: { '3': '3.5.1' },
  duckdb: { '1': '1.4.4' },
  ferretdb: {
    '1': '1.24.2', // v1: plain PostgreSQL backend
    '2': '2.7.0', // v2: postgresql-documentdb backend
  },
  influxdb: { '3': '3.8.0' },
  libsql: { '0': '0.24.32' },
  mariadb: {
    '10': '10.11.16', // 10.11 is the only LTS line in 10.x
    '11': '11.8.6', // LATEST in 11.x; the 11.4 LTS exists but is older — explicit choice
  },
  meilisearch: { '1': '1.43.1' },
  mongodb: {
    '7': '7.0.34',
    '8': '8.0.23', // 8.0 LTS — NOT the latest 8.2.9 — explicit LTS choice
  },
  mysql: {
    '8': '8.4.9', // 8.4 LTS — NOT the older 8.0.40
    '9': '9.6.0', // latest in 9.x track
  },
  postgresql: {
    '15': '15.18.0',
    '16': '16.14.0',
    '17': '17.10.0',
    '18': '18.4.0',
  },
  'postgresql-documentdb': { '17': '17-0.107.0' },
  qdrant: { '1': '1.16.3' },
  questdb: { '9': '9.2.3' },
  redis: {
    '7': '7.4.9',
    '8': '8.4.0', // 8.4 line stays at 8.4.0 — no patches yet
  },
  sqlite: { '3': '3.53.1' },
  surrealdb: { '2': '2.3.2' },
  tigerbeetle: { '0': '0.16.70' },
  typedb: { '3': '3.8.0' },
  valkey: {
    '8': '8.0.9',
    '9': '9.0.4',
  },
  weaviate: { '1': '1.35.7' },
}

const yamlPath = path.join(process.cwd(), 'databases.yml')
const original = fs.readFileSync(yamlPath, 'utf-8')
const lines = original.split('\n')

// Find each engine block: a top-level `<engine_name>:` under `databases:`.
// We splice a `defaults:` block right above the `versions:` line for that engine.
// Engines are 2-space indented under `databases:`, so engine block headers are
// 2-space indented and end with `:`. Inside-block content is 4-space indented.

const engineHeaderRe = /^ {2}([a-z][a-z0-9-]*):\s*$/
const versionsLineRe = /^ {4}versions:\s*$/
const defaultsLineRe = /^ {4}defaults:\s*$/

type EngineBlock = {
  name: string
  startLine: number // line index of the engine header
  versionsLine: number // line index of `    versions:`
  existingDefaultsStart: number | null
  existingDefaultsEnd: number | null
}

const blocks: EngineBlock[] = []

let currentEngine: EngineBlock | null = null
for (let i = 0; i < lines.length; i++) {
  const headerMatch = lines[i].match(engineHeaderRe)
  if (headerMatch) {
    if (currentEngine && currentEngine.versionsLine !== -1)
      blocks.push(currentEngine)
    currentEngine = {
      name: headerMatch[1],
      startLine: i,
      versionsLine: -1,
      existingDefaultsStart: null,
      existingDefaultsEnd: null,
    }
    continue
  }
  if (!currentEngine) continue
  if (versionsLineRe.test(lines[i])) {
    currentEngine.versionsLine = i
    continue
  }
  if (defaultsLineRe.test(lines[i])) {
    currentEngine.existingDefaultsStart = i
    // find end: next line that is NOT 6-space-indented or deeper
    let j = i + 1
    while (
      j < lines.length &&
      (lines[j].startsWith('      ') || lines[j].trim() === '')
    ) {
      j++
    }
    currentEngine.existingDefaultsEnd = j - 1
    continue
  }
}
if (currentEngine && currentEngine.versionsLine !== -1)
  blocks.push(currentEngine)

console.log(`Found ${blocks.length} engine blocks`)

// Rewrite from bottom to top so line indices stay valid as we splice.
// Steps per engine:
//   1. If existing defaults block, remove it.
//   2. Insert new defaults block right above the versions: line.
const sortedBlocks = [...blocks].sort((a, b) => b.versionsLine - a.versionsLine)

for (const block of sortedBlocks) {
  const defaults = DEFAULTS[block.name]
  if (!defaults) {
    console.warn(`No defaults declared for engine: ${block.name} — skipping`)
    continue
  }

  // Remove existing defaults block if present
  if (
    block.existingDefaultsStart !== null &&
    block.existingDefaultsEnd !== null
  ) {
    const removeCount =
      block.existingDefaultsEnd - block.existingDefaultsStart + 1
    lines.splice(block.existingDefaultsStart, removeCount)
    // Adjust versionsLine if the removed block was above it
    if (block.existingDefaultsStart < block.versionsLine) {
      block.versionsLine -= removeCount
    }
  }

  // Build the new defaults block (4-space indent for `defaults:`, 6-space for entries)
  const defaultsLines: string[] = ['    defaults:']
  for (const [major, full] of Object.entries(defaults)) {
    // Quote the major key only if it contains chars YAML would otherwise interpret oddly.
    // Major keys are short numeric/version-y strings; quoting them is always safe.
    defaultsLines.push(`      "${major}": "${full}"`)
  }

  lines.splice(block.versionsLine, 0, ...defaultsLines)
}

fs.writeFileSync(yamlPath, lines.join('\n'), 'utf-8')

console.log('Updated databases.yml with defaults blocks for all 22 engines')
