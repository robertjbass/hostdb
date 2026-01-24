import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Canonical platform type
export type Platform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'

// Database entry from databases.json
export type DatabaseEntry = {
  displayName?: string
  description?: string
  type?: string
  license?: string
  commercialUse?: boolean
  status?: 'completed' | 'in-progress' | 'pending' | 'unsupported'
  latestLts?: string
  versions: Record<string, boolean>
  platforms?: Record<string, boolean>
}

// databases.json structure
export type DatabasesJson = {
  $schema?: string
  databases: Record<string, DatabaseEntry>
}

// Platform asset from releases.json
export type PlatformAsset = {
  url: string
  sha256: string
  size: number
}

// Version release from releases.json
export type VersionRelease = {
  version: string
  releaseTag: string
  releasedAt: string
  platforms: Partial<Record<Platform, PlatformAsset>>
}

// releases.json structure
export type ReleasesJson = {
  $schema?: string
  repository: string
  databases: Record<string, Record<string, VersionRelease>>
}

export function loadDatabasesJson(): DatabasesJson {
  const filePath = join(ROOT, 'databases.json')
  return JSON.parse(readFileSync(filePath, 'utf-8')) as DatabasesJson
}

export function loadReleasesJson(): ReleasesJson {
  const filePath = join(ROOT, 'releases.json')
  return JSON.parse(readFileSync(filePath, 'utf-8')) as ReleasesJson
}

export function getEnabledVersions(database: string): Set<string> {
  try {
    const data = loadDatabasesJson()
    const dbEntry = data.databases[database]
    if (!dbEntry) return new Set()

    return new Set(
      Object.entries(dbEntry.versions)
        .filter(([, enabled]) => enabled === true)
        .map(([version]) => version),
    )
  } catch {
    return new Set()
  }
}
