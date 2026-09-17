/**
 * Bundled plugins stripped from the official MariaDB archives on re-host.
 *
 * Starting with 11.8.9 / 12.3.3 / 13.0.2 the official linux-x64 bintar ships
 * `lib/plugin/ha_duckdb.so`, and 12.3.x / 13.0.x additionally ship
 * `lib/plugin/ha_videx.{so,dll}`. Neither is re-hosted, on any platform:
 *
 * - Pre-stable engine: the DuckDB storage engine is gamma maturity upstream.
 * - Backup path unvalidated: nothing in the spindb dump/restore path has ever
 *   been exercised against a table in either engine, and a managed-cloud
 *   tenant is root on their own server, so `INSTALL SONAME 'ha_duckdb'` is a
 *   single statement away from data we cannot back up. VIDEX additionally
 *   makes outbound HTTP calls to an external cost-estimation service.
 * - Platform parity with the source builds: `builds/mariadb/Dockerfile` and
 *   the macOS builds already pass `-DPLUGIN_DUCKDB=NO -DPLUGIN_VIDEX=NO`, so
 *   keeping the plugins in the two repacked official archives would make
 *   linux-x64 and win32-x64 the only platforms that carry them.
 *
 * The exclusion list is explicit rather than a glob: anything that names a
 * stripped plugin but sits outside a listed path is reported as unexpected so
 * the repack fails loudly instead of deleting broadly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export const BUNDLED_PLUGIN_NAMES = ['duckdb', 'videx'] as const

type ExclusionKind = 'file' | 'directory'

type Exclusion = {
  path: string
  kind: ExclusionKind
}

export const BUNDLED_PLUGIN_EXCLUSIONS: readonly Exclusion[] = [
  { path: 'lib/plugin/ha_duckdb.so', kind: 'file' },
  { path: 'lib/plugin/ha_duckdb.dll', kind: 'file' },
  { path: 'lib/plugin/ha_videx.so', kind: 'file' },
  { path: 'lib/plugin/ha_videx.dll', kind: 'file' },
  { path: 'mariadb-test/plugin/duckdb', kind: 'directory' },
  { path: 'mariadb-test/plugin/videx', kind: 'directory' },
]

export type ArchivePathVerdict = 'strip' | 'keep' | 'unexpected'

const CONFIG_EXTENSIONS = ['.cnf', '.ini', '.conf']

const PLUGIN_LOAD_REGEX = /^[ \t]*plugin[-_]load(?:[-_]add)?[ \t]*=(.*)$/gim

export function normalizeArchivePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function mentionsBundledPlugin(value: string): boolean {
  const lowered = value.toLowerCase()
  return BUNDLED_PLUGIN_NAMES.some((name) => lowered.includes(name))
}

export function classifyArchivePath(relativePath: string): ArchivePathVerdict {
  const normalized = normalizeArchivePath(relativePath)
  if (normalized === '') return 'keep'

  for (const exclusion of BUNDLED_PLUGIN_EXCLUSIONS) {
    if (normalized === exclusion.path) return 'strip'
    if (
      exclusion.kind === 'directory' &&
      normalized.startsWith(`${exclusion.path}/`)
    ) {
      return 'strip'
    }
  }

  const segments = normalized.split('/')
  return segments.some(mentionsBundledPlugin) ? 'unexpected' : 'keep'
}

export type PluginRemoval = {
  path: string
  kind: ExclusionKind
  entries: number
  bytes: number
}

export type PluginRemovalPlan = {
  removals: PluginRemoval[]
  unexpected: string[]
}

function measureTree(absolutePath: string): { entries: number; bytes: number } {
  const stats = statSync(absolutePath)
  if (!stats.isDirectory()) {
    return { entries: 1, bytes: stats.size }
  }

  let entries = 0
  let bytes = 0
  for (const child of readdirSync(absolutePath, { withFileTypes: true })) {
    const measured = measureTree(resolve(absolutePath, child.name))
    entries += measured.entries
    bytes += measured.bytes
  }
  return { entries, bytes }
}

export function planPluginRemovals({
  rootDir,
}: {
  rootDir: string
}): PluginRemovalPlan {
  const removals: PluginRemoval[] = []
  const unexpected: string[] = []

  function walk(relativeDir: string) {
    const absoluteDir = relativeDir ? resolve(rootDir, relativeDir) : rootDir
    for (const child of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = relativeDir
        ? `${relativeDir}/${child.name}`
        : child.name
      const verdict = classifyArchivePath(relativePath)

      if (verdict === 'strip') {
        const measured = measureTree(resolve(rootDir, relativePath))
        removals.push({
          path: relativePath,
          kind: child.isDirectory() ? 'directory' : 'file',
          entries: measured.entries,
          bytes: measured.bytes,
        })
        continue
      }

      if (verdict === 'unexpected') {
        unexpected.push(relativePath)
      }

      if (child.isDirectory() && !child.isSymbolicLink()) {
        walk(relativePath)
      }
    }
  }

  walk('')

  return { removals, unexpected }
}

export function findStalePluginLoadDirectives({
  rootDir,
}: {
  rootDir: string
}): string[] {
  const stale: string[] = []

  function walk(relativeDir: string) {
    const absoluteDir = relativeDir ? resolve(rootDir, relativeDir) : rootDir
    for (const child of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = relativeDir
        ? `${relativeDir}/${child.name}`
        : child.name

      if (child.isDirectory() && !child.isSymbolicLink()) {
        walk(relativePath)
        continue
      }

      if (!CONFIG_EXTENSIONS.some((ext) => child.name.endsWith(ext))) continue

      const contents = readFileSync(resolve(rootDir, relativePath), 'utf-8')
      for (const match of contents.matchAll(PLUGIN_LOAD_REGEX)) {
        if (mentionsBundledPlugin(match[1])) {
          stale.push(`${relativePath}: ${match[0].trim()}`)
        }
      }
    }
  }

  walk('')

  return stale
}
