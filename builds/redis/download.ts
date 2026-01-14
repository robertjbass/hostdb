#!/usr/bin/env tsx
/**
 * Download Redis binaries from multiple sources for re-hosting
 *
 * Sources:
 *   - redis-windows: Windows binaries from github.com/redis-windows/redis-windows
 *   - Build-required: Linux/macOS require source builds
 *
 * Usage:
 *   ./builds/redis/download.ts [options]
 *   pnpm tsx builds/redis/download.ts [options]
 *
 * Options:
 *   --version VERSION    Redis version (default: 8.4.0)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./dist)
 *   --all-platforms      Download for all platforms (skips build-required unless --build-fallback)
 *   --build-fallback     Build from source for platforms without binaries (linux only)
 *   --help               Show help
 */

import {
  createWriteStream,
  createReadStream,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
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

// Validate version format to prevent command injection (e.g., "8.4.0")
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type DownloadableSource = {
  url: string
  format: 'tar.gz' | 'zip'
  sha256: string | null
  sourceType?: 'redis-windows'
}

type BuildRequiredSource = {
  sourceType: 'build-required'
}

type SourceEntry = DownloadableSource | BuildRequiredSource

type Sources = {
  database: string
  versions: Record<string, Record<Platform, SourceEntry>>
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

    fileStream.write(value)
    downloadedBytes += value.length

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

/**
 * Repackage redis-windows ZIP
 * ZIP structure: Redis-VERSION-Windows-x64-msys2/
 */
function repackageRedisWindows(
  zipPath: string,
  outputPath: string,
  version: string,
  platform: Platform,
): void {
  const tempDir = resolve(dirname(zipPath), 'temp-extract')
  mkdirSync(tempDir, { recursive: true })

  logInfo('Extracting ZIP...')

  execFileSync('unzip', ['-q', zipPath, '-d', tempDir], { stdio: 'inherit' })

  // Find extracted directory (redis-windows extracts to Redis-VERSION-Windows-x64-msys2/)
  const extractedDirs = readdirSync(tempDir)
  const redisDir = extractedDirs.find((d) => d.startsWith('Redis-'))

  if (!redisDir) {
    throw new Error('Could not find extracted Redis directory')
  }

  const extractedPath = resolve(tempDir, redisDir)

  // Add metadata file
  const metadata = {
    name: 'redis',
    version,
    platform,
    source: 'redis-windows',
    sourceUrl: 'https://github.com/redis-windows/redis-windows',
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    resolve(extractedPath, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Create output directory
  mkdirSync(dirname(outputPath), { recursive: true })

  logInfo(`Creating: ${basename(outputPath)}`)

  // Rename directory to just 'redis' for consistency
  const finalDir = resolve(tempDir, 'redis')
  execFileSync('mv', [extractedPath, finalDir])

  // Log DLLs present (redis-windows includes MSYS2 DLLs)
  const binDir = resolve(finalDir, 'bin') || finalDir
  const files = readdirSync(existsSync(binDir) ? binDir : finalDir)
  const dlls = files.filter((f) => f.endsWith('.dll'))
  if (dlls.length > 0) {
    logInfo(`DLLs included: ${dlls.join(', ')}`)
  } else {
    logWarn(
      'No DLLs found in package - Windows binaries may not run standalone',
    )
  }

  // Create ZIP
  execFileSync('zip', ['-rq', outputPath, 'redis'], {
    cwd: tempDir,
    stdio: 'inherit',
  })

  // Cleanup temp
  rmSync(tempDir, { recursive: true, force: true })

  logSuccess(`Created: ${outputPath}`)
}

/**
 * Build Redis from source using Docker
 * Only supports linux-x64 and linux-arm64
 */
function buildFromSource(
  version: string,
  platform: Platform,
  outputDir: string,
): boolean {
  // Only Linux platforms can be built from source via Docker
  if (platform !== 'linux-x64' && platform !== 'linux-arm64') {
    logError(`Source builds only support linux-x64 and linux-arm64`)
    logError(`${platform} cannot be built from source via this script`)
    logError(`Darwin platforms need to be built on macOS directly`)
    return false
  }

  const buildScript = resolve(__dirname, 'build-local.sh')

  if (!existsSync(buildScript)) {
    logError(`Build script not found: ${buildScript}`)
    return false
  }

  logInfo(`Building ${platform} from source (this may take 5-15 minutes)...`)
  logInfo(`Running: ${buildScript}`)

  const result = spawnSync(
    buildScript,
    [
      '--version',
      version,
      '--platform',
      platform,
      '--output',
      outputDir,
      '--cleanup',
    ],
    {
      stdio: 'inherit',
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env, CI: 'true' },
    },
  )

  if (result.status !== 0) {
    logError(`Source build failed with exit code: ${result.status}`)
    return false
  }

  logSuccess(`Source build completed for ${platform}`)
  return true
}

function parseArgs(): {
  version: string
  platforms: Platform[]
  outputDir: string
  buildFallback: boolean
} {
  const args = process.argv.slice(2)
  let version = '8.4.0'
  let platforms: Platform[] = []
  let outputDir = './dist'
  let allPlatforms = false
  let buildFallback = false

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
          logError('Version must be in format: X.Y.Z (e.g., 8.4.0)')
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
      case '--build-fallback':
        buildFallback = true
        break
      case '--help':
      case '-h':
        console.log(`
Usage: ./builds/redis/download.ts [options]

Options:
  --version VERSION    Redis version (default: 8.4.0)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download for all platforms (skips build-required unless --build-fallback)
  --build-fallback     Build from source for platforms without binaries (linux only)
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Sources:
  - redis-windows (github.com/redis-windows/redis-windows): win32-x64
  - Build-required: linux-x64, linux-arm64, darwin-x64, darwin-arm64
  - Source build (Docker): linux-x64, linux-arm64 (with --build-fallback)

Examples:
  ./builds/redis/download.ts
  ./builds/redis/download.ts --version 8.4.0 --platform win32-x64
  ./builds/redis/download.ts --all-platforms
  ./builds/redis/download.ts --all-platforms --build-fallback
`)
        process.exit(0)
    }
  }

  if (allPlatforms) {
    platforms = [...VALID_PLATFORMS]
  } else if (platforms.length === 0) {
    platforms = [detectPlatform()]
  }

  return { version, platforms, outputDir, buildFallback }
}

async function main() {
  const { version, platforms, outputDir, buildFallback } = parseArgs()
  const sources = loadSources()

  console.log()
  logInfo(`Redis Download Script`)
  logInfo(`Version: ${version}`)
  logInfo(`Platforms: ${platforms.join(', ')}`)
  logInfo(`Output: ${outputDir}`)
  if (buildFallback) {
    logInfo(
      `Build fallback: enabled (will build from source for Linux platforms)`,
    )
  }
  console.log()

  const versionSources = sources.versions[version]
  if (!versionSources) {
    logError(`Version ${version} not found in sources.json`)
    logInfo(`Available versions: ${Object.keys(sources.versions).join(', ')}`)
    process.exit(1)
  }

  let downloadedCount = 0
  let builtCount = 0
  let skippedCount = 0

  for (const platform of platforms) {
    console.log()
    logInfo(`=== ${platform} ===`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source entry for ${platform}, skipping`)
      skippedCount++
      continue
    }

    // Handle build-required sources
    if (!isDownloadableSource(source)) {
      if (buildFallback) {
        // Try to build from source
        const canBuild = platform === 'linux-x64' || platform === 'linux-arm64'
        if (canBuild) {
          logInfo(
            `No binary available for ${platform}, building from source...`,
          )
          const success = buildFromSource(version, platform, outputDir)
          if (success) {
            builtCount++
          } else {
            logError(`Failed to build ${platform} from source`)
            skippedCount++
          }
          continue
        } else {
          logWarn(
            `${platform} requires building from source but source builds only support Linux`,
          )
          logWarn('Darwin platforms need to be built on macOS directly')
          skippedCount++
          continue
        }
      } else {
        logWarn(
          `${platform} requires building from source (no binary available)`,
        )
        logInfo(
          'Use --build-fallback to build from source, or builds/redis/build-local.sh',
        )
        skippedCount++
        continue
      }
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadPath = resolve(
      outputDir,
      'downloads',
      `redis-${version}-${platform}-original.${source.format}`,
    )
    const outputPath = resolve(outputDir, `redis-${version}-${platform}.${ext}`)

    // Download
    if (existsSync(downloadPath)) {
      logInfo(`Using cached download: ${downloadPath}`)
    } else {
      await downloadFile(source.url, downloadPath)
    }

    // Verify checksum
    const actualSha256 = await calculateSha256(downloadPath)
    logInfo(`SHA256: ${actualSha256}`)

    if (source.sha256) {
      if (actualSha256 === source.sha256) {
        logSuccess('Checksum verified')
      } else {
        logError(`Checksum mismatch! Expected: ${source.sha256}`)
        process.exit(1)
      }
    } else {
      logWarn('No checksum in sources.json - update it with the SHA256 above')
    }

    // Repackage based on source type
    if (source.sourceType === undefined) {
      logError(`Missing sourceType for download entry: ${platform}`)
      skippedCount++
      continue
    } else if (source.sourceType === 'redis-windows') {
      repackageRedisWindows(downloadPath, outputPath, version, platform)
    } else {
      logError(`Unknown source type: ${source.sourceType}`)
      logError('Only redis-windows downloads are currently supported')
      skippedCount++
      continue
    }

    // Final checksum
    const outputSha256 = await calculateSha256(outputPath)
    logInfo(`Output SHA256: ${outputSha256}`)

    downloadedCount++
  }

  console.log()
  logSuccess('Done!')
  logInfo(`Downloaded: ${downloadedCount} platform(s)`)
  if (builtCount > 0) {
    logInfo(`Built from source: ${builtCount} platform(s)`)
  }
  if (skippedCount > 0) {
    logInfo(`Skipped: ${skippedCount} platform(s)`)
  }
  logInfo(`Output files in: ${resolve(outputDir)}`)
}

main().catch((err) => {
  logError(err.message)
  process.exit(1)
})
