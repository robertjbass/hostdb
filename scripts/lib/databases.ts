import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

export type DatabaseEntry = {
  versions: Record<string, boolean>
}

export type DatabasesJson = {
  databases: Record<string, DatabaseEntry>
}

export function loadDatabasesJson(): DatabasesJson {
  const filePath = join(ROOT, 'databases.json')
  return JSON.parse(readFileSync(filePath, 'utf-8')) as DatabasesJson
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
