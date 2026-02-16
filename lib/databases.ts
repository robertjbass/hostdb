import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Canonical platform type
export type Platform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'

// All supported platforms
export const ALL_PLATFORMS: Platform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
]

// Runtime dependency on another database engine
export type Dependency = {
  database: string
  cascadeDelete: boolean
  note?: string
}

// CLI tools configuration
export type CliTools = {
  server: string | null
  client: string | null
  utilities: string[]
  enhanced: string[]
  note?: string
}

// Per-platform overrides within a version
export type PlatformConfig = {
  dependencies?: Dependency[]
  cliTools?: CliTools
}

// A platform entry in the version platforms map: true (inherit) or config overrides
export type PlatformEntry = true | PlatformConfig

// Version config with overrides (when version entry is an object)
export type VersionConfig = {
  enabled?: boolean
  note?: string
  dependencies?: Dependency[]
  platforms?: Platform[] | Record<string, PlatformEntry>
  cliTools?: CliTools
}

// A version entry is either a simple boolean or a config object
export type VersionEntry = boolean | VersionConfig

// Database entry from databases.json
export type DatabaseEntry = {
  displayName: string
  description: string
  type: string
  sourceRepo: string
  license: string
  commercialUse: boolean
  hostedServiceAllowed: boolean
  protocol: string | null
  note?: string
  dependencies?: Dependency[]
  spindbStatus: 'completed' | 'in-progress'
  versions: Record<string, VersionEntry>
  platforms: Platform[]
  cliTools: CliTools
  connection: {
    runtime: 'server' | 'embedded'
    defaultPort: number | null
    scheme: string | null
    defaultDatabase: string | null
    defaultUser: string | null
    queryLanguage: string
  }
}

// databases.json structure
export type DatabasesJson = {
  $schema?: string
  _generated?: string
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

// --- Internal helpers ---

/** Get the version's platforms field, handling both array and object forms */
function getVersionPlatformsRaw(versionEntry: VersionConfig): {
  list: Platform[]
  map: Record<string, PlatformEntry> | null
} {
  if (!versionEntry.platforms) {
    return { list: [], map: null }
  }

  if (Array.isArray(versionEntry.platforms)) {
    return { list: versionEntry.platforms as Platform[], map: null }
  }

  // Object form: keys are platforms
  const map = versionEntry.platforms as Record<string, PlatformEntry>
  return { list: Object.keys(map) as Platform[], map }
}

// --- Resolver helpers ---

/** Check if a version entry is enabled */
export function isVersionEnabled(entry: VersionEntry): boolean {
  if (typeof entry === 'boolean') return entry
  return entry.enabled !== false
}

/** Get set of enabled version strings for a database */
export function getEnabledVersions(database: string): Set<string> {
  try {
    const data = loadDatabasesJson()
    const dbEntry = data.databases[database]
    if (!dbEntry) return new Set()

    return new Set(
      Object.entries(dbEntry.versions)
        .filter(([, entry]) => isVersionEnabled(entry))
        .map(([version]) => version),
    )
  } catch {
    return new Set()
  }
}

/** Get effective platforms for a version (version overrides or engine defaults) */
export function getVersionPlatforms(
  engine: DatabaseEntry,
  version: string,
): Platform[] {
  const versionEntry = engine.versions[version]
  if (!versionEntry || typeof versionEntry === 'boolean') {
    return [...engine.platforms]
  }

  const { list } = getVersionPlatformsRaw(versionEntry)
  return list.length > 0 ? [...list] : [...engine.platforms]
}

/**
 * Get effective dependencies for a version+platform.
 *
 * Resolution order (each level fully replaces):
 * 1. Engine-level dependencies
 * 2. Version-level dependencies (if specified)
 * 3. Platform-level dependencies within version (if platforms is object form and platform entry has dependencies)
 */
export function getVersionDependencies(
  engine: DatabaseEntry,
  version: string,
  platform?: Platform,
): Dependency[] {
  const versionEntry = engine.versions[version]
  if (!versionEntry || typeof versionEntry === 'boolean') {
    return engine.dependencies ?? []
  }

  // Version-level replaces engine-level
  let resolved = versionEntry.dependencies ?? engine.dependencies ?? []

  // Platform-level replaces version-level
  if (platform) {
    const { map } = getVersionPlatformsRaw(versionEntry)
    if (map) {
      const platformEntry = map[platform]
      if (
        platformEntry &&
        typeof platformEntry === 'object' &&
        platformEntry.dependencies
      ) {
        resolved = platformEntry.dependencies
      }
    }
  }

  return resolved
}

/**
 * Get effective CLI tools for a version+platform.
 *
 * Resolution order (each level fully replaces):
 * 1. Engine-level cliTools
 * 2. Version-level cliTools (if specified)
 * 3. Platform-level cliTools within version (if platforms is object form and platform entry has cliTools)
 */
export function getVersionCliTools(
  engine: DatabaseEntry,
  version: string,
  platform?: Platform,
): CliTools {
  const versionEntry = engine.versions[version]
  if (!versionEntry || typeof versionEntry === 'boolean') {
    return engine.cliTools
  }

  // Version-level replaces engine-level
  let resolved = versionEntry.cliTools ?? engine.cliTools

  // Platform-level replaces version-level
  if (platform) {
    const { map } = getVersionPlatformsRaw(versionEntry)
    if (map) {
      const platformEntry = map[platform]
      if (
        platformEntry &&
        typeof platformEntry === 'object' &&
        platformEntry.cliTools
      ) {
        resolved = platformEntry.cliTools
      }
    }
  }

  return resolved
}

// --- databases.json generation from databases.yml ---

/** Convert a snake_case string to camelCase */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

/** Recursively convert all object keys from snake_case to camelCase */
function transformKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(transformKeys)
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = transformKeys(value)
    }
    return result
  }
  return obj
}

/**
 * Generate databases.json from databases.yml
 *
 * @returns true if the file was changed/created (or needs updating in check mode), false if already up-to-date
 */
export function generateDatabasesJson(options?: {
  checkOnly?: boolean
  rootDir?: string
}): boolean {
  const { checkOnly = false, rootDir = ROOT } = options ?? {}
  const yamlPath = join(rootDir, 'databases.yml')
  const jsonPath = join(rootDir, 'databases.json')

  if (!existsSync(yamlPath)) {
    return false
  }

  const yamlContent = readFileSync(yamlPath, 'utf-8')
  const parsed = parseYaml(yamlContent) as Record<string, unknown>

  const transformed = transformKeys(parsed) as Record<string, unknown>

  const output = {
    _generated:
      'DO NOT EDIT. Generated from databases.yml by pnpm prep. Edit databases.yml instead.',
    $schema: './schemas/databases.schema.json',
    ...transformed,
  }

  const newJson = JSON.stringify(output, null, 2) + '\n'

  let currentJson = ''
  if (existsSync(jsonPath)) {
    currentJson = readFileSync(jsonPath, 'utf-8')
  }

  if (currentJson === newJson) {
    return false
  }

  if (checkOnly) {
    return true
  }

  writeFileSync(jsonPath, newJson)
  return true
}
