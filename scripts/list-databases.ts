import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import chalk from 'chalk'
import Table from 'cli-table3'

const RELEASES_URL =
  'https://raw.githubusercontent.com/robertjbass/hostdb/main/releases.json'

const __dirname = dirname(fileURLToPath(import.meta.url))

type ReleasePlatform = {
  url: string
  sha256: string
  size: number
}

type ReleaseVersion = {
  version: string
  releaseTag: string
  releasedAt: string
  platforms: Record<string, ReleasePlatform>
}

type ReleasesJson = {
  repository: string
  lastUpdated: string
  databases: Record<string, Record<string, ReleaseVersion>>
}

type CliTools = {
  server: string | null
  client: string | null
  utilities: string[]
  enhanced: string[]
  note?: string
}

type Database = {
  displayName: string
  description: string
  type: string
  sourceRepo: string
  license: string
  status: 'completed' | 'in-progress' | 'pending' | 'unsupported'
  commercialUse: boolean
  protocol: string | null
  note: string
  latestLts: string
  versions: Record<string, boolean>
  platforms: Record<string, boolean>
  cliTools: CliTools
}

type DatabasesJson = {
  databases: Record<string, Database>
}

type DownloadItem = {
  name: string
  description: string
  type: 'database' | 'cli-tool' | 'prerequisite'
  binary?: string
  category?: string
  bundledWith?: string | null
  packages: Record<string, unknown>
  binaries?: Record<string, unknown>
  requires: string[]
}

type DownloadsJson = {
  packageManagers: Record<string, unknown>
  items: Record<string, DownloadItem>
}

function loadDatabases(): DatabasesJson {
  const filePath = resolve(__dirname, '..', 'databases.json')
  const content = readFileSync(filePath, 'utf-8')
  return JSON.parse(content) as DatabasesJson
}

function loadDownloads(): DownloadsJson {
  const filePath = resolve(__dirname, '..', 'downloads.json')
  const content = readFileSync(filePath, 'utf-8')
  return JSON.parse(content) as DownloadsJson
}

async function loadReleases(): Promise<ReleasesJson> {
  // Try to fetch from GitHub first (more accurate than local)
  try {
    const response = await fetch(RELEASES_URL, {
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      return (await response.json()) as ReleasesJson
    }
  } catch {
    // Fetch failed, fall back to local
  }

  // Fall back to local file
  const filePath = resolve(__dirname, '..', 'releases.json')
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as ReleasesJson
  }

  // No releases data available
  return {
    repository: 'robertjbass/hostdb',
    lastUpdated: '',
    databases: {},
  }
}

function getCliTools(downloads: DownloadsJson): Record<string, DownloadItem> {
  const tools: Record<string, DownloadItem> = {}
  for (const [id, item] of Object.entries(downloads.items)) {
    if (item.type === 'cli-tool') {
      tools[id] = item
    }
  }
  return tools
}

function getEnabledVersionCount(versions: Record<string, boolean>): number {
  return Object.values(versions).filter(Boolean).length
}

function getEnabledPlatformCount(platforms: Record<string, boolean>): number {
  return Object.values(platforms).filter(Boolean).length
}

function getReleasedVersionCount(
  dbKey: string,
  releases: ReleasesJson,
): number {
  const dbReleases = releases.databases[dbKey]
  if (!dbReleases) return 0
  return Object.keys(dbReleases).length
}

function getAllToolsForDatabase(cliTools: CliTools): string[] {
  const tools: string[] = []
  if (cliTools.server) tools.push(cliTools.server)
  if (cliTools.client) tools.push(cliTools.client)
  tools.push(...cliTools.utilities)
  tools.push(...cliTools.enhanced)
  return tools
}

async function main() {
  const { databases } = loadDatabases()
  const downloadsData = loadDownloads()
  const cliToolsData = getCliTools(downloadsData)
  const releases = await loadReleases()

  const showAll = process.argv.includes('--all')
  const showPending = process.argv.includes('--pending')
  const showUnsupported = process.argv.includes('--unsupported')
  const showTools = process.argv.includes('--tools')
  const showHelp =
    process.argv.includes('--help') || process.argv.includes('-h')

  if (showHelp) {
    console.log(`
${chalk.bold('Usage:')} pnpm dbs [options]

${chalk.bold('Options:')}
  ${chalk.yellow('--all')}          Show all databases
  ${chalk.yellow('--pending')}      Show only pending databases
  ${chalk.yellow('--unsupported')}  Show only unsupported databases
  ${chalk.yellow('--tools')}        Show CLI tools summary
  ${chalk.yellow('--help, -h')}     Show this help message

${chalk.bold('Status:')}
  ${chalk.blue('completed')}    - Fully built and released
  ${chalk.green('in-progress')}  - Actively being built
  ${chalk.yellow('pending')}      - Planned, not yet started
  ${chalk.gray('unsupported')}  - Not planned for support

${chalk.bold('Released column:')}
  Shows versions released on GitHub vs versions configured in databases.json
  ${chalk.green('3/3')} = all versions released, ${chalk.yellow('2/3')} = partial, ${chalk.red('0/3')} = none
`)
    return
  }

  const entries = Object.entries(databases)
    .filter(([, db]) => {
      if (showAll) return true
      if (showPending) return db.status === 'pending'
      if (showUnsupported) return db.status === 'unsupported'
      // Default: show completed and in-progress
      return db.status === 'completed' || db.status === 'in-progress'
    })
    .map(([key, db]) => ({
      key,
      ...db,
    }))

  if (entries.length === 0) {
    console.log(chalk.yellow('No databases found matching criteria.'))
    return
  }

  // Database table
  console.log()
  console.log(chalk.bold.cyan('📦 Databases'))
  console.log()

  const dbTable = new Table({
    head: [
      chalk.bold('Database'),
      chalk.bold('Status'),
      chalk.bold('Type'),
      chalk.bold('Released'),
      chalk.bold('Platforms'),
      chalk.bold('License'),
    ],
    style: {
      head: [],
      border: ['gray'],
    },
  })

  for (const entry of entries) {
    const statusCell =
      entry.status === 'completed'
        ? chalk.blue('completed')
        : entry.status === 'in-progress'
          ? chalk.green('in-progress')
          : entry.status === 'pending'
            ? chalk.yellow('pending')
            : chalk.gray('unsupported')

    const enabledVersions = getEnabledVersionCount(entry.versions)
    const releasedVersions = getReleasedVersionCount(entry.key, releases)

    let releasedCell: string
    if (releasedVersions === 0) {
      releasedCell = chalk.red(`0/${enabledVersions}`)
    } else if (releasedVersions < enabledVersions) {
      releasedCell = chalk.yellow(`${releasedVersions}/${enabledVersions}`)
    } else {
      releasedCell = chalk.green(`${releasedVersions}/${enabledVersions}`)
    }

    dbTable.push([
      entry.displayName,
      statusCell,
      entry.type,
      releasedCell,
      String(getEnabledPlatformCount(entry.platforms)),
      entry.license,
    ])
  }

  console.log(dbTable.toString())
  console.log()

  // Type counts table
  console.log(chalk.bold.cyan('📊 By Type'))
  console.log()

  const typeCounts: Record<string, number> = {}
  for (const entry of entries) {
    typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1
  }

  const typeTable = new Table({
    head: [chalk.bold('Type'), chalk.bold('Count')],
    style: { head: [], border: ['gray'] },
    colAligns: ['left', 'right'],
  })

  const sortedTypes = Object.entries(typeCounts).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  for (const [type, count] of sortedTypes) {
    typeTable.push([type, String(count)])
  }

  console.log(typeTable.toString())
  console.log()

  // CLI Tools summary (if --tools flag)
  if (showTools) {
    console.log(chalk.bold.cyan('🔧 CLI Tools'))
    console.log()

    // Collect all unique tools from enabled databases
    const toolUsage: Record<string, string[]> = {}
    for (const entry of entries) {
      const tools = getAllToolsForDatabase(entry.cliTools)
      for (const tool of tools) {
        if (!toolUsage[tool]) toolUsage[tool] = []
        toolUsage[tool].push(entry.displayName)
      }
    }

    // Group by category
    const byCategory: Record<
      string,
      { tool: string; usedBy: string[]; entry: DownloadItem }[]
    > = {
      server: [],
      client: [],
      utility: [],
      enhanced: [],
    }

    for (const [toolName, usedBy] of Object.entries(toolUsage)) {
      const toolEntry = cliToolsData[toolName]
      if (toolEntry) {
        const category = toolEntry.category || 'utility'
        if (!byCategory[category]) byCategory[category] = []
        byCategory[category].push({ tool: toolName, usedBy, entry: toolEntry })
      }
    }

    const categoryLabels: Record<string, string> = {
      server: '🖥️  Server Binaries',
      client: '💻 Client Tools',
      utility: '🛠️  Utilities',
      enhanced: '✨ Enhanced CLIs',
    }

    for (const [category, tools] of Object.entries(byCategory)) {
      if (tools.length === 0) continue

      console.log(chalk.bold(categoryLabels[category] || category))

      const toolTable = new Table({
        head: [
          chalk.bold('Binary'),
          chalk.bold('Name'),
          chalk.bold('Used By'),
          chalk.bold('Pkg Mgrs'),
        ],
        style: { head: [], border: ['gray'] },
      })

      tools.sort((a, b) => a.tool.localeCompare(b.tool))
      for (const { tool, usedBy, entry } of tools) {
        const pkgMgrCount = Object.keys(entry.packages).length
        const pkgMgrCell =
          pkgMgrCount > 0
            ? chalk.green(`${pkgMgrCount}`)
            : chalk.yellow('curl only')

        toolTable.push([
          chalk.cyan(tool),
          entry.name,
          usedBy.slice(0, 3).join(', ') + (usedBy.length > 3 ? '...' : ''),
          pkgMgrCell,
        ])
      }

      console.log(toolTable.toString())
      console.log()
    }

    // Tools with missing platform coverage
    console.log(chalk.bold('⚠️  Tools Without Full Platform Coverage'))
    console.log()

    const platforms = ['brew', 'apt', 'choco', 'winget']
    const incomplete: { tool: string; missing: string[] }[] = []

    for (const [toolName] of Object.entries(toolUsage)) {
      const toolEntry = cliToolsData[toolName]
      if (!toolEntry) continue

      const missing: string[] = []
      for (const pm of platforms) {
        if (!toolEntry.packages[pm]) {
          missing.push(pm)
        }
      }

      if (missing.length > 0 && missing.length < platforms.length) {
        incomplete.push({ tool: toolName, missing })
      }
    }

    if (incomplete.length > 0) {
      const incompleteTable = new Table({
        head: [chalk.bold('Binary'), chalk.bold('Missing')],
        style: { head: [], border: ['gray'] },
      })

      for (const { tool, missing } of incomplete) {
        incompleteTable.push([
          chalk.cyan(tool),
          chalk.yellow(missing.join(', ')),
        ])
      }

      console.log(incompleteTable.toString())
    } else {
      console.log(chalk.green('All tools have good package manager coverage!'))
    }
    console.log()
  }

  // Summary
  const totalVersions = entries.reduce(
    (sum, e) => sum + getEnabledVersionCount(e.versions),
    0,
  )
  const totalReleased = entries.reduce(
    (sum, e) => sum + getReleasedVersionCount(e.key, releases),
    0,
  )
  const totalBuilds = entries.reduce(
    (sum, e) =>
      sum +
      getEnabledVersionCount(e.versions) * getEnabledPlatformCount(e.platforms),
    0,
  )

  const totalTools = new Set(
    entries.flatMap((e) => getAllToolsForDatabase(e.cliTools)),
  ).size

  console.log(chalk.bold.cyan('📈 Summary'))
  console.log()
  console.log(
    `  ${chalk.bold('Databases:')}     ${chalk.green(entries.length)}`,
  )

  const releasedColor =
    totalReleased === totalVersions
      ? chalk.green
      : totalReleased > 0
        ? chalk.yellow
        : chalk.red
  console.log(
    `  ${chalk.bold('Released:')}      ${releasedColor(`${totalReleased}/${totalVersions}`)} versions on GitHub`,
  )
  console.log(
    `  ${chalk.bold('Builds:')}        ${chalk.green(totalBuilds)} total (versions × platforms)`,
  )
  console.log(
    `  ${chalk.bold('CLI Tools:')}     ${chalk.green(totalTools)} unique`,
  )
  console.log()

  // Show status counts if not showing all
  if (!showAll) {
    const statusCounts: Record<string, number> = {
      completed: 0,
      'in-progress': 0,
      pending: 0,
      unsupported: 0,
    }
    for (const db of Object.values(databases)) {
      statusCounts[db.status]++
    }

    const hiddenInfo: string[] = []
    if (!showPending && statusCounts.pending > 0) {
      hiddenInfo.push(`${statusCounts.pending} pending`)
    }
    if (!showUnsupported && statusCounts.unsupported > 0) {
      hiddenInfo.push(`${statusCounts.unsupported} unsupported`)
    }

    if (hiddenInfo.length > 0) {
      console.log(
        chalk.gray(`  (${hiddenInfo.join(', ')} hidden, use --all to show)`),
      )
      console.log()
    }
  }

  if (!showTools) {
    console.log(chalk.gray('  Use --tools to see CLI tools summary'))
    console.log()
  }
}

main().catch((error) => {
  console.error(
    chalk.red('Error:'),
    error instanceof Error ? error.message : String(error),
  )
  process.exit(1)
})
