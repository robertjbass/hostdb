#!/usr/bin/env tsx
/**
 * Download official MongoDB binaries for re-hosting
 *
 * This script bundles three components into a single package:
 * - MongoDB Server (mongod, mongos)
 * - MongoDB Shell (mongosh)
 * - MongoDB Database Tools (mongodump, mongorestore, etc.)
 *
 * Usage:
 *   ./builds/mongodb/download.ts [options]
 *   pnpm tsx builds/mongodb/download.ts [options]
 *
 * Options:
 *   --version VERSION    MongoDB version (default: 8.0.17)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./dist)
 *   --all-platforms      Download for all platforms
 *   --help               Show help
 */

import {
  createWriteStream,
  createReadStream,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

type Platform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'

const VALID_PLATFORMS: Platform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
]

function isValidPlatform(value: string): value is Platform {
  return VALID_PLATFORMS.includes(value as Platform)
}

// Validate version format to prevent command injection (e.g., "8.0.17")
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type SourceEntry = {
  url: string
  format: 'tar.xz' | 'tar.gz' | 'zip'
  sha256?: string | null
}

type ComponentEntry = {
  version: string
  description: string
  binaries: string[]
  platforms: Record<Platform, SourceEntry>
}

type Sources = {
  database: string
  versions: Record<string, Record<Platform, SourceEntry>>
  components: Record<string, ComponentEntry>
  notes: Record<string, string>
}

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(color: keyof typeof colors, prefix: string, msg: string) {
  console.log(`${colors[color]}[${prefix}]${colors.reset} ${msg}`)
}

function logInfo(msg: string) {
  log('blue', 'INFO', msg)
}
function logSuccess(msg: string) {
  log('green', 'OK', msg)
}
function logWarn(msg: string) {
  log('yellow', 'WARN', msg)
}
function logError(msg: string) {
  log('red', 'ERROR', msg)
}

function detectPlatform(): Platform {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'

  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

function loadSources(): Sources {
  const sourcesPath = resolve(__dirname, 'sources.json')
  const content = readFileSync(sourcesPath, 'utf-8')
  try {
    return JSON.parse(content) as Sources
  } catch (error) {
    throw new Error(`Failed to parse sources.json: invalid JSON`, {
      cause: error,
    })
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  logInfo(`Downloading: ${url}`)

  const response = await fetch(url, { redirect: 'follow' })

  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    )
  }

  const contentLength = response.headers.get('content-length')
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0

  mkdirSync(dirname(destPath), { recursive: true })

  const fileStream = createWriteStream(destPath)
  const reader = response.body?.getReader()

  if (!reader) {
    throw new Error('No response body')
  }

  let downloadedBytes = 0
  const startTime = Date.now()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const canContinue = fileStream.write(value)
    downloadedBytes += value.length

    // Handle backpressure - wait for drain if buffer is full
    if (!canContinue) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          fileStream.removeListener('error', onError)
          resolve()
        }
        const onError = (err: Error) => {
          fileStream.removeListener('drain', onDrain)
          reject(err)
        }
        fileStream.once('drain', onDrain)
        fileStream.once('error', onError)
      })
    }

    // Progress update
    if (totalBytes > 0) {
      const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1)
      const mbDownloaded = (downloadedBytes / 1024 / 1024).toFixed(1)
      const mbTotal = (totalBytes / 1024 / 1024).toFixed(1)
      process.stdout.write(
        `\r  ${mbDownloaded}MB / ${mbTotal}MB (${percent}%)    `,
      )
    } else {
      const mbDownloaded = (downloadedBytes / 1024 / 1024).toFixed(1)
      process.stdout.write(`\r  ${mbDownloaded}MB downloaded...    `)
    }
  }

  // Wait for the file stream to fully close before proceeding
  await new Promise<void>((resolve, reject) => {
    fileStream.end()
    fileStream.on('finish', resolve)
    fileStream.on('error', reject)
  })

  console.log() // New line after progress

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  logSuccess(
    `Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(1)}MB in ${duration}s`,
  )
}

// Calculate SHA256 checksum using streaming to avoid loading large files into memory
async function calculateSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)

    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function verifyCommand(command: string): void {
  const findCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(findCmd, [command], { stdio: 'pipe' })
  } catch {
    throw new Error(`Required command not found: ${command}`)
  }
}

function extractArchive(
  sourcePath: string,
  format: string,
  destDir: string,
): void {
  mkdirSync(destDir, { recursive: true })

  if (format === 'tar.xz') {
    execFileSync('tar', ['-xJf', sourcePath, '-C', destDir], {
      stdio: 'inherit',
    })
  } else if (format === 'tar.gz') {
    execFileSync('tar', ['-xzf', sourcePath, '-C', destDir], {
      stdio: 'inherit',
    })
  } else if (format === 'zip') {
    execFileSync('unzip', ['-q', sourcePath, '-d', destDir], {
      stdio: 'inherit',
    })
  } else {
    throw new Error(
      `Unsupported archive format: '${format}' for file: ${sourcePath}. Supported formats: tar.xz, tar.gz, zip`,
    )
  }
}

function findExtractedDir(tempDir: string, prefix: string): string | null {
  const dirs = readdirSync(tempDir)
  return dirs.find((d) => d.startsWith(prefix)) || null
}

function copyBinaries(srcBinDir: string, destBinDir: string): void {
  if (!existsSync(srcBinDir)) {
    logWarn(`Source bin directory not found: ${srcBinDir}`)
    return
  }

  mkdirSync(destBinDir, { recursive: true })

  const files = readdirSync(srcBinDir)
  for (const file of files) {
    const srcPath = join(srcBinDir, file)
    const destPath = join(destBinDir, file)
    cpSync(srcPath, destPath, { recursive: true })
  }
}

async function downloadAndExtractComponent(
  componentName: string,
  source: SourceEntry,
  downloadDir: string,
  extractDir: string,
): Promise<string> {
  const downloadPath = join(
    downloadDir,
    `${componentName}-original.${source.format}`,
  )

  // Download if not cached
  if (existsSync(downloadPath)) {
    logInfo(`Using cached download: ${basename(downloadPath)}`)
  } else {
    await downloadFile(source.url, downloadPath)
  }

  // Verify checksum if available
  if (source.sha256) {
    const actualSha256 = await calculateSha256(downloadPath)
    if (actualSha256 !== source.sha256) {
      logError(`Checksum mismatch for ${componentName}!`)
      logError(`Expected: ${source.sha256}`)
      logError(`Actual: ${actualSha256}`)
      throw new Error(`Checksum verification failed for ${componentName}`)
    }
    logSuccess(`Checksum verified for ${componentName}`)
  }

  // Extract
  const componentExtractDir = join(extractDir, componentName)
  mkdirSync(componentExtractDir, { recursive: true })
  extractArchive(downloadPath, source.format, componentExtractDir)

  return componentExtractDir
}

async function repackage(
  sources: Sources,
  version: string,
  platform: Platform,
  downloadDir: string,
  outputPath: string,
): Promise<void> {
  // Verify required commands exist before starting
  verifyCommand('tar')
  if (platform.startsWith('win32')) {
    verifyCommand('zip')
  }

  const tempDir = resolve(downloadDir, 'temp-bundle')
  const extractDir = resolve(downloadDir, 'temp-extract')
  rmSync(tempDir, { recursive: true, force: true })
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(tempDir, { recursive: true })
  mkdirSync(extractDir, { recursive: true })

  try {
    const versionSources = sources.versions[version]
    const serverSource = versionSources[platform]

    // 1. Download and extract MongoDB Server
    logInfo('=== Downloading MongoDB Server ===')
    const serverDownloadPath = join(
      downloadDir,
      `mongodb-server-${version}-${platform}-original.${serverSource.format}`,
    )

    if (existsSync(serverDownloadPath)) {
      logInfo(`Using cached download: ${basename(serverDownloadPath)}`)
    } else {
      await downloadFile(serverSource.url, serverDownloadPath)
    }

    // Verify server checksum
    const serverSha256 = await calculateSha256(serverDownloadPath)
    logInfo(`Server SHA256: ${serverSha256}`)
    if (serverSource.sha256) {
      if (serverSha256 === serverSource.sha256) {
        logSuccess('Server checksum verified')
      } else {
        logError(`Checksum mismatch! Expected: ${serverSource.sha256}`)
        throw new Error('Server checksum verification failed')
      }
    }

    // Extract server
    const serverExtractDir = join(extractDir, 'server')
    mkdirSync(serverExtractDir, { recursive: true })
    logInfo('Extracting MongoDB Server...')
    extractArchive(serverDownloadPath, serverSource.format, serverExtractDir)

    // Find extracted MongoDB directory
    const mongoDir = findExtractedDir(serverExtractDir, 'mongodb-')
    if (!mongoDir) {
      throw new Error('Could not find extracted MongoDB server directory')
    }

    const serverPath = join(serverExtractDir, mongoDir)

    // Create final bundle directory
    const bundleDir = join(tempDir, 'mongodb')
    mkdirSync(bundleDir, { recursive: true })

    // Copy server files to bundle
    logInfo('Copying server files...')
    cpSync(serverPath, bundleDir, { recursive: true })

    // 2. Download and extract mongosh
    const mongoshComponent = sources.components['mongosh']
    if (mongoshComponent) {
      const mongoshSource = mongoshComponent.platforms[platform]
      if (mongoshSource) {
        logInfo('=== Downloading MongoDB Shell (mongosh) ===')
        const mongoshExtractDir = await downloadAndExtractComponent(
          'mongosh',
          mongoshSource,
          downloadDir,
          extractDir,
        )

        if (mongoshExtractDir) {
          // Find mongosh directory (extracts to mongosh-VERSION-PLATFORM/)
          const mongoshDir = findExtractedDir(mongoshExtractDir, 'mongosh-')
          if (mongoshDir) {
            const mongoshBinDir = join(mongoshExtractDir, mongoshDir, 'bin')
            logInfo('Copying mongosh binaries...')
            copyBinaries(mongoshBinDir, join(bundleDir, 'bin'))
            logSuccess('mongosh bundled')
          } else {
            logWarn('Could not find mongosh directory')
          }
        }
      }
    }

    // 3. Download and extract database-tools
    const toolsComponent = sources.components['database-tools']
    if (toolsComponent) {
      const toolsSource = toolsComponent.platforms[platform]
      if (toolsSource) {
        logInfo('=== Downloading MongoDB Database Tools ===')
        const toolsExtractDir = await downloadAndExtractComponent(
          'database-tools',
          toolsSource,
          downloadDir,
          extractDir,
        )

        if (toolsExtractDir) {
          // Find database-tools directory
          const toolsDir = findExtractedDir(
            toolsExtractDir,
            'mongodb-database-tools-',
          )
          if (toolsDir) {
            const toolsBinDir = join(toolsExtractDir, toolsDir, 'bin')
            logInfo('Copying database-tools binaries...')
            copyBinaries(toolsBinDir, join(bundleDir, 'bin'))
            logSuccess('database-tools bundled')
          } else {
            logWarn('Could not find database-tools directory')
          }
        }
      }
    }

    // 4. Add metadata file
    const metadata = {
      name: 'mongodb',
      version,
      platform,
      source: 'official',
      components: {
        server: version,
        mongosh: mongoshComponent?.version || 'not-included',
        'database-tools': toolsComponent?.version || 'not-included',
      },
      rehosted_by: 'hostdb',
      rehosted_at: new Date().toISOString(),
    }
    writeFileSync(
      join(bundleDir, '.hostdb-metadata.json'),
      JSON.stringify(metadata, null, 2),
    )

    // 5. Create output archive
    mkdirSync(dirname(outputPath), { recursive: true })
    logInfo(`Creating: ${basename(outputPath)}`)

    if (platform.startsWith('win32')) {
      execFileSync('zip', ['-rq', outputPath, 'mongodb'], {
        stdio: 'inherit',
        cwd: tempDir,
      })
    } else {
      execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'mongodb'], {
        stdio: 'inherit',
      })
    }

    logSuccess(`Created: ${outputPath}`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}

function parseArgs(): {
  version: string
  platforms: Platform[]
  outputDir: string
} {
  const args = process.argv.slice(2)
  let version = '8.0.17'
  let platforms: Platform[] = []
  let outputDir = './dist'
  let allPlatforms = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--version': {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          logError('--version requires a value')
          process.exit(1)
        }
        const versionValue = args[++i]
        if (!isValidVersion(versionValue)) {
          logError(`Invalid version format: ${versionValue}`)
          logError('Version must be in format: X.Y.Z (e.g., 8.0.17)')
          process.exit(1)
        }
        version = versionValue
        break
      }
      case '--platform': {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          logError('--platform requires a value')
          process.exit(1)
        }
        const platformValue = args[++i]
        if (!isValidPlatform(platformValue)) {
          logError(`Invalid platform: ${platformValue}`)
          logError(`Valid platforms: ${VALID_PLATFORMS.join(', ')}`)
          process.exit(1)
        }
        platforms.push(platformValue)
        break
      }
      case '--output':
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          logError('--output requires a value')
          process.exit(1)
        }
        outputDir = args[++i]
        break
      case '--all-platforms':
        allPlatforms = true
        break
      case '--help':
      case '-h':
        console.log(`
Usage: ./builds/mongodb/download.ts [options]

Downloads and bundles MongoDB components into a single package:
  - MongoDB Server (mongod, mongos)
  - MongoDB Shell (mongosh)
  - MongoDB Database Tools (mongodump, mongorestore, etc.)

Options:
  --version VERSION    MongoDB version (default: 8.0.17)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download for all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Examples:
  ./builds/mongodb/download.ts
  ./builds/mongodb/download.ts --version 7.0.28 --platform linux-x64
  ./builds/mongodb/download.ts --all-platforms
`)
        process.exit(0)
    }
  }

  if (allPlatforms) {
    platforms = [...VALID_PLATFORMS]
  } else if (platforms.length === 0) {
    platforms = [detectPlatform()]
  }

  return { version, platforms, outputDir }
}

async function main() {
  const { version, platforms, outputDir } = parseArgs()
  const sources = loadSources()

  console.log()
  logInfo(`MongoDB Download Script (with bundled components)`)
  logInfo(`Server Version: ${version}`)
  logInfo(`mongosh Version: ${sources.components['mongosh']?.version || 'N/A'}`)
  logInfo(
    `Database Tools Version: ${sources.components['database-tools']?.version || 'N/A'}`,
  )
  logInfo(`Platforms: ${platforms.join(', ')}`)
  logInfo(`Output: ${outputDir}`)
  console.log()

  const versionSources = sources.versions[version]
  if (!versionSources) {
    logError(`Version ${version} not found in sources.json`)
    logInfo(`Available versions: ${Object.keys(sources.versions).join(', ')}`)
    process.exit(1)
  }

  for (const platform of platforms) {
    console.log()
    logInfo(`========== ${platform} ==========`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source for ${platform}, skipping`)
      continue
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadDir = resolve(outputDir, 'downloads')
    const outputPath = resolve(outputDir, `mongodb-${version}-${platform}.${ext}`)

    mkdirSync(downloadDir, { recursive: true })

    // Download and bundle all components
    await repackage(sources, version, platform, downloadDir, outputPath)

    // Final checksum
    const outputSha256 = await calculateSha256(outputPath)
    logInfo(`Output SHA256: ${outputSha256}`)
  }

  console.log()
  logSuccess('Done!')
  logInfo(`Output files in: ${resolve(outputDir)}`)
}

main().catch((err) => {
  logError(err.message)
  process.exit(1)
})
