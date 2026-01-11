#!/usr/bin/env tsx
/**
 * Download official SQLite binaries for re-hosting
 *
 * Usage:
 *   ./builds/sqlite/download.ts [options]
 *   pnpm tsx builds/sqlite/download.ts [options]
 *
 * Options:
 *   --version VERSION    SQLite version (default: 3.51.2)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./dist)
 *   --all-platforms      Download for all platforms
 *   --help               Show help
 *
 * Note: linux-arm64 requires source build (not implemented in this script)
 */

import {
  createWriteStream,
  createReadStream,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  rmSync,
  chmodSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
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

// Validate version format (e.g., "3.51.2")
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type SourceEntry = {
  url?: string
  format?: 'zip'
  sha3_256?: string
  sourceType?: 'build-required'
  sourceUrl?: string
}

type Sources = {
  database: string
  versions: Record<string, Record<Platform, SourceEntry>>
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
    response = await fetch(url, { redirect: 'follow', signal: controller.signal })
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

// Calculate SHA3-256 checksum (SQLite uses SHA3-256, not SHA-256)
async function calculateSha3_256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha3-256')
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

function repackage(
  sourcePath: string,
  outputPath: string,
  version: string,
  platform: Platform,
): void {
  // All SQLite downloads are zip format
  verifyCommand('unzip')
  if (platform.startsWith('win32')) {
    verifyCommand('zip')
  }

  const tempDir = resolve(dirname(sourcePath), 'temp-extract')
  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(tempDir, { recursive: true })

  logInfo('Extracting archive...')

  // Extract zip
  execFileSync('unzip', ['-q', sourcePath, '-d', tempDir], { stdio: 'inherit' })

  // SQLite extracts files directly (no nested directory)
  // Create sqlite directory and move files into it
  const sqliteDir = resolve(tempDir, 'sqlite')
  const binDir = resolve(sqliteDir, 'bin')
  mkdirSync(binDir, { recursive: true })

  // Move all executables to bin/
  const files = readdirSync(tempDir)
  for (const file of files) {
    if (file === 'sqlite') continue // Skip our created directory
    const srcPath = resolve(tempDir, file)
    const destPath = resolve(binDir, file)
    renameSync(srcPath, destPath)
    // Make executable on Unix
    if (!platform.startsWith('win32')) {
      try {
        chmodSync(destPath, 0o755)
      } catch {
        // Silently ignore chmod failures (e.g., read-only filesystem)
      }
    }
  }

  // Add metadata file
  const metadata = {
    name: 'sqlite',
    version,
    platform,
    source: 'official',
    tools: ['sqlite3', 'sqldiff', 'sqlite3_analyzer', 'sqlite3_rsync'],
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    resolve(sqliteDir, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Create output archive
  mkdirSync(dirname(outputPath), { recursive: true })

  logInfo(`Creating: ${basename(outputPath)}`)

  if (platform.startsWith('win32')) {
    execFileSync('zip', ['-rq', outputPath, 'sqlite'], {
      stdio: 'inherit',
      cwd: tempDir,
    })
  } else {
    execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'sqlite'], {
      stdio: 'inherit',
    })
  }

  // Cleanup temp
  rmSync(tempDir, { recursive: true, force: true })

  logSuccess(`Created: ${outputPath}`)
}

function parseArgs(): {
  version: string
  platforms: Platform[]
  outputDir: string
} {
  const args = process.argv.slice(2)
  let version = '3.51.2'
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
          logError('Version must be in format: X.Y.Z (e.g., 3.51.2)')
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
Usage: ./builds/sqlite/download.ts [options]

Options:
  --version VERSION    SQLite version (default: 3.51.2)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download for all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Note: linux-arm64 requires source build (use Docker workflow)

Examples:
  ./builds/sqlite/download.ts
  ./builds/sqlite/download.ts --version 3.51.2 --platform linux-x64
  ./builds/sqlite/download.ts --all-platforms
`)
        process.exit(0)
        break // unreachable, but required for no-fallthrough rule
      default:
        if (args[i].startsWith('-')) {
          logError(`Unknown option: ${args[i]}`)
          process.exit(1)
        }
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
  logInfo(`SQLite Download Script`)
  logInfo(`Version: ${version}`)
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
    logInfo(`=== ${platform} ===`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source for ${platform}, skipping`)
      skipCount++
      continue
    }

    // Check if build is required (linux-arm64)
    if (source.sourceType === 'build-required') {
      logWarn(`${platform} requires source build - skipping download`)
      logInfo(`Use the Docker workflow to build for ${platform}`)
      skipCount++
      continue
    }

    if (!source.url) {
      logWarn(`No download URL for ${platform}, skipping`)
      skipCount++
      continue
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadPath = resolve(
      outputDir,
      'downloads',
      `sqlite-${version}-${platform}-original.zip`,
    )
    const outputPath = resolve(outputDir, `sqlite-${version}-${platform}.${ext}`)

    // Download
    if (existsSync(downloadPath)) {
      logInfo(`Using cached download: ${basename(downloadPath)}`)
    } else {
      await downloadFile(source.url, downloadPath)
    }

    // Verify checksum (SHA3-256)
    const actualSha3 = await calculateSha3_256(downloadPath)
    logInfo(`SHA3-256: ${actualSha3}`)

    if (source.sha3_256) {
      if (actualSha3 === source.sha3_256) {
        logSuccess('Checksum verified')
      } else {
        logError(`Checksum mismatch!`)
        logError(`Expected: ${source.sha3_256}`)
        logError(`Actual:   ${actualSha3}`)
        process.exit(1)
      }
    } else {
      logWarn('No checksum in sources.json - update it with the SHA3-256 above')
    }

    // Repackage
    repackage(downloadPath, outputPath, version, platform)

    successCount++
  }

  console.log()
  logSuccess(`Done! ${successCount} downloaded, ${skipCount} skipped`)
  logInfo(`Output files in: ${resolve(outputDir)}`)
}

main().catch((err) => {
  logError(err.message)
  process.exit(1)
})
