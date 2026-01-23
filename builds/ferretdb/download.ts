#!/usr/bin/env tsx
/**
 * Download FerretDB binaries and bundle with MongoDB tools
 *
 * This script:
 * - Downloads official FerretDB binaries for Linux
 * - Cross-compiles FerretDB for macOS/Windows using Go
 * - Bundles mongosh and database-tools for complete MongoDB compatibility
 *
 * Usage:
 *   ./builds/ferretdb/download.ts [options]
 *   pnpm tsx builds/ferretdb/download.ts [options]
 *
 * Options:
 *   --version VERSION    FerretDB version (default: 2.7.0)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./downloads)
 *   --all-platforms      Download/build for all platforms
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
  chmodSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

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

// Validate version format (e.g., "2.7.0")
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type DownloadableSource = {
  url: string
  format: 'tar.gz' | 'zip' | 'binary'
  sha256?: string | null
}

type BuildRequiredSource = {
  sourceType: 'build-required'
  note?: string
}

type SourceEntry = DownloadableSource | BuildRequiredSource

type ComponentEntry = {
  version: string
  description: string
  binaries: string[]
  platforms: Record<Platform, DownloadableSource>
}

type Sources = {
  database: string
  versions: Record<string, Record<Platform, SourceEntry>>
  components: Record<string, ComponentEntry>
  notes: Record<string, string>
}

function isDownloadableSource(
  source: SourceEntry,
): source is DownloadableSource {
  return 'url' in source
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

async function downloadFile(
  url: string,
  destPath: string,
  timeoutMs: number = 300000,
): Promise<void> {
  logInfo(`Downloading: ${url}`)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timed out after ${timeoutMs / 1000}s: ${url}`)
    }
    throw error
  }

  if (!response.ok) {
    clearTimeout(timeoutId)
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
    clearTimeout(timeoutId)
    throw new Error('No response body')
  }

  let downloadedBytes = 0
  const startTime = Date.now()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const canContinue = fileStream.write(value)
      downloadedBytes += value.length

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

    await new Promise<void>((resolve, reject) => {
      fileStream.end()
      fileStream.on('finish', resolve)
      fileStream.on('error', reject)
    })
  } finally {
    clearTimeout(timeoutId)
  }

  console.log()

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  logSuccess(
    `Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(1)}MB in ${duration}s`,
  )
}

async function calculateSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)

    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function verifyCommand(command: string): boolean {
  const findCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(findCmd, [command], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function extractArchive(
  sourcePath: string,
  format: string,
  destDir: string,
): void {
  mkdirSync(destDir, { recursive: true })

  if (format === 'tar.gz') {
    execFileSync('tar', ['-xzf', sourcePath, '-C', destDir], {
      stdio: 'inherit',
    })
  } else if (format === 'zip') {
    if (process.platform === 'win32') {
      const escapedSourcePath = sourcePath.replace(/'/g, "''")
      const escapedDestDir = destDir.replace(/'/g, "''")
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${escapedSourcePath}' -DestinationPath '${escapedDestDir}' -Force`,
        ],
        { stdio: 'inherit' },
      )
    } else {
      execFileSync('unzip', ['-q', sourcePath, '-d', destDir], {
        stdio: 'inherit',
      })
    }
  } else {
    throw new Error(`Unsupported archive format: ${format}`)
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

/**
 * Cross-compile FerretDB from source using Go
 */
function crossCompileFerretDB(
  version: string,
  platform: Platform,
  outputDir: string,
): string {
  if (!verifyCommand('go')) {
    throw new Error('Go is required for cross-compilation. Install Go 1.22+')
  }

  if (!verifyCommand('git')) {
    throw new Error('Git is required for cloning FerretDB source')
  }

  const repoDir = join(outputDir, 'ferretdb-source')
  const binaryName = platform.startsWith('win32') ? 'ferretdb.exe' : 'ferretdb'
  const outputPath = join(outputDir, `ferretdb-${version}-${platform}`, binaryName)

  // Map platform to GOOS/GOARCH
  const goEnv: Record<Platform, { GOOS: string; GOARCH: string }> = {
    'linux-x64': { GOOS: 'linux', GOARCH: 'amd64' },
    'linux-arm64': { GOOS: 'linux', GOARCH: 'arm64' },
    'darwin-x64': { GOOS: 'darwin', GOARCH: 'amd64' },
    'darwin-arm64': { GOOS: 'darwin', GOARCH: 'arm64' },
    'win32-x64': { GOOS: 'windows', GOARCH: 'amd64' },
  }

  const { GOOS, GOARCH } = goEnv[platform]

  // Clone if not exists
  if (!existsSync(repoDir)) {
    logInfo('Cloning FerretDB repository...')
    execFileSync(
      'git',
      ['clone', '--depth', '1', '--branch', `v${version}`, 'https://github.com/FerretDB/FerretDB.git', repoDir],
      { stdio: 'inherit' },
    )
  }

  // Build
  logInfo(`Cross-compiling for ${platform} (GOOS=${GOOS}, GOARCH=${GOARCH})...`)

  mkdirSync(dirname(outputPath), { recursive: true })

  const result = spawnSync(
    'go',
    ['build', '-o', outputPath, './cmd/ferretdb'],
    {
      cwd: repoDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        GOOS,
        GOARCH,
        CGO_ENABLED: '0',
      },
    },
  )

  if (result.status !== 0) {
    throw new Error(`Go build failed with exit code ${result.status}`)
  }

  logSuccess(`Built FerretDB for ${platform}`)
  return outputPath
}

async function downloadAndExtractComponent(
  componentName: string,
  source: DownloadableSource,
  platform: Platform,
  downloadDir: string,
  extractDir: string,
): Promise<string> {
  const downloadPath = join(
    downloadDir,
    `${componentName}-${platform}-original.${source.format}`,
  )

  if (existsSync(downloadPath)) {
    logInfo(`Using cached download: ${basename(downloadPath)}`)
  } else {
    await downloadFile(source.url, downloadPath)
  }

  if (source.sha256) {
    const actualSha256 = await calculateSha256(downloadPath)
    if (actualSha256 !== source.sha256) {
      throw new Error(`Checksum mismatch for ${componentName}`)
    }
    logSuccess(`Checksum verified for ${componentName}`)
  }

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
  verifyCommand('tar')
  if (platform.startsWith('win32') || platform.startsWith('darwin')) {
    if (process.platform !== 'win32') {
      verifyCommand('unzip')
    }
  }
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
    const source = versionSources[platform]

    const bundleDir = join(tempDir, 'ferretdb')
    const binDir = join(bundleDir, 'bin')
    mkdirSync(binDir, { recursive: true })

    // 1. Get FerretDB binary
    logInfo('=== Getting FerretDB binary ===')
    const binaryName = platform.startsWith('win32')
      ? 'ferretdb.exe'
      : 'ferretdb'

    if (isDownloadableSource(source)) {
      // Download raw binary
      const binaryPath = join(downloadDir, `ferretdb-${version}-${platform}`)

      if (existsSync(binaryPath)) {
        logInfo(`Using cached download: ${basename(binaryPath)}`)
      } else {
        await downloadFile(source.url, binaryPath)
      }

      // Verify checksum if available
      if (source.sha256) {
        const actualSha256 = await calculateSha256(binaryPath)
        if (actualSha256 !== source.sha256) {
          throw new Error('Checksum mismatch for FerretDB binary')
        }
        logSuccess('Checksum verified')
      } else {
        const sha256 = await calculateSha256(binaryPath)
        logInfo(`SHA256: ${sha256}`)
        logWarn('No checksum in sources.json - update it with the SHA256 above')
      }

      // Copy to bin directory
      cpSync(binaryPath, join(binDir, binaryName))
      chmodSync(join(binDir, binaryName), 0o755)
      logSuccess('FerretDB binary ready')
    } else {
      // Cross-compile from source
      const builtBinaryPath = crossCompileFerretDB(version, platform, downloadDir)
      cpSync(builtBinaryPath, join(binDir, binaryName))
      if (!platform.startsWith('win32')) {
        chmodSync(join(binDir, binaryName), 0o755)
      }
      logSuccess('FerretDB binary built and ready')
    }

    // 2. Download and extract mongosh
    const mongoshComponent = sources.components['mongosh']
    if (mongoshComponent) {
      const mongoshSource = mongoshComponent.platforms[platform]
      if (mongoshSource) {
        logInfo('=== Downloading MongoDB Shell (mongosh) ===')
        const mongoshExtractDir = await downloadAndExtractComponent(
          'mongosh',
          mongoshSource,
          platform,
          downloadDir,
          extractDir,
        )

        const mongoshDir = findExtractedDir(mongoshExtractDir, 'mongosh-')
        if (mongoshDir) {
          const mongoshBinDir = join(mongoshExtractDir, mongoshDir, 'bin')
          logInfo('Copying mongosh binaries...')
          copyBinaries(mongoshBinDir, binDir)
          logSuccess('mongosh bundled')
        } else {
          logWarn('Could not find mongosh directory')
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
          platform,
          downloadDir,
          extractDir,
        )

        const toolsDir = findExtractedDir(
          toolsExtractDir,
          'mongodb-database-tools-',
        )
        if (toolsDir) {
          const toolsBinDir = join(toolsExtractDir, toolsDir, 'bin')
          logInfo('Copying database-tools binaries...')
          copyBinaries(toolsBinDir, binDir)
          logSuccess('database-tools bundled')
        } else {
          logWarn('Could not find database-tools directory')
        }
      }
    }

    // 4. Add metadata file
    const metadata = {
      name: 'ferretdb',
      version,
      platform,
      source: isDownloadableSource(source) ? 'official' : 'cross-compiled',
      components: {
        ferretdb: version,
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
      execFileSync('zip', ['-rq', outputPath, 'ferretdb'], {
        stdio: 'inherit',
        cwd: tempDir,
      })
    } else {
      execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'ferretdb'], {
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
  let version = '2.7.0'
  let platforms: Platform[] = []
  let outputDir = './downloads'
  let allPlatforms = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--':
        // Ignore -- (end of options delimiter from pnpm)
        break
      case '--version': {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          logError('--version requires a value')
          process.exit(1)
        }
        const versionValue = args[++i]
        if (!isValidVersion(versionValue)) {
          logError(`Invalid version format: ${versionValue}`)
          logError('Version must be in format: X.Y.Z (e.g., 2.7.0)')
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
Usage: ./builds/ferretdb/download.ts [options]

Downloads and bundles FerretDB with MongoDB tools:
  - FerretDB server (downloaded or cross-compiled)
  - MongoDB Shell (mongosh)
  - MongoDB Database Tools (mongodump, mongorestore, etc.)

Options:
  --version VERSION    FerretDB version (default: 2.7.0)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./downloads)
  --all-platforms      Download/build for all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Sources:
  - Linux: Official binaries from GitHub releases
  - macOS/Windows: Cross-compiled from source (requires Go 1.22+)

Examples:
  ./builds/ferretdb/download.ts
  ./builds/ferretdb/download.ts --version 2.7.0 --platform linux-x64
  ./builds/ferretdb/download.ts --all-platforms
`)
        process.exit(0)
        break
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
  logInfo(`FerretDB Download Script (with bundled MongoDB tools)`)
  logInfo(`FerretDB Version: ${version}`)
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

  let successCount = 0
  let skipCount = 0

  for (const platform of platforms) {
    console.log()
    logInfo(`========== ${platform} ==========`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source for ${platform}, skipping`)
      skipCount++
      continue
    }

    // Check if Go is available for build-required platforms
    if (!isDownloadableSource(source) && !verifyCommand('go')) {
      logWarn(`${platform} requires Go for cross-compilation, but Go is not installed`)
      logInfo('Install Go 1.22+ to build for this platform')
      skipCount++
      continue
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadDir = resolve(outputDir, 'downloads')
    const outputPath = resolve(
      outputDir,
      `ferretdb-${version}-${platform}.${ext}`,
    )

    mkdirSync(downloadDir, { recursive: true })

    try {
      await repackage(sources, version, platform, downloadDir, outputPath)

      const outputSha256 = await calculateSha256(outputPath)
      logInfo(`Output SHA256: ${outputSha256}`)
      successCount++
    } catch (error) {
      logError(`Failed to build for ${platform}: ${error}`)
      skipCount++
    }
  }

  console.log()
  logSuccess('Done!')
  logInfo(`Built: ${successCount} platform(s)`)
  if (skipCount > 0) {
    logInfo(`Skipped: ${skipCount} platform(s)`)
  }
  logInfo(`Output files in: ${resolve(outputDir)}`)
}

main().catch((err) => {
  logError(err.message)
  process.exit(1)
})
