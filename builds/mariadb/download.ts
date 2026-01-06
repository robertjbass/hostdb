#!/usr/bin/env tsx
/**
 * Download MariaDB binaries from multiple sources for re-hosting
 *
 * Sources:
 *   - Official: archive.mariadb.org (Linux x64, Windows x64)
 *   - MariaDB4j: Maven Central JAR (darwin-arm64 11.4.5)
 *   - Build-required: No binary available (requires source build)
 *
 * Usage:
 *   ./builds/mariadb/download.ts [options]
 *   pnpm tsx builds/mariadb/download.ts [options]
 *
 * Options:
 *   --version VERSION    MariaDB version (default: 11.4.5)
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
  renameSync,
  rmSync,
  cpSync,
  readdirSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, execFileSync, spawnSync } from 'node:child_process'

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

// Validate version format to prevent command injection (e.g., "11.4.5")
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type DownloadableSource = {
  url: string
  format: 'tar.gz' | 'tar.xz' | 'zip' | 'jar'
  sha256: string | null
  sourceType?: 'official' | 'mariadb4j'
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
 * Repackage official MariaDB tarball/zip
 */
function repackageOfficial(
  sourcePath: string,
  format: string,
  outputPath: string,
  version: string,
  platform: Platform,
): void {
  const tempDir = resolve(dirname(sourcePath), 'temp-extract')
  mkdirSync(tempDir, { recursive: true })

  logInfo('Extracting archive...')

  // Extract based on format
  if (format === 'tar.gz') {
    execSync(`tar -xzf "${sourcePath}" -C "${tempDir}"`, { stdio: 'inherit' })
  } else if (format === 'tar.xz') {
    execSync(`tar -xJf "${sourcePath}" -C "${tempDir}"`, { stdio: 'inherit' })
  } else if (format === 'zip') {
    execSync(`unzip -q "${sourcePath}" -d "${tempDir}"`, { stdio: 'inherit' })
  }

  // Find extracted directory (MariaDB extracts to mariadb-VERSION-PLATFORM/)
  const extractedDirs = execSync(`ls "${tempDir}"`, { encoding: 'utf-8' })
    .trim()
    .split('\n')
  const mariadbDir = extractedDirs.find((d) => d.startsWith('mariadb-'))

  if (!mariadbDir) {
    throw new Error('Could not find extracted MariaDB directory')
  }

  const extractedPath = resolve(tempDir, mariadbDir)

  // Add metadata file
  const metadata = {
    name: 'mariadb',
    version,
    platform,
    source: 'official',
    sourceUrl: 'https://archive.mariadb.org/',
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    resolve(extractedPath, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Create output tarball
  mkdirSync(dirname(outputPath), { recursive: true })

  logInfo(`Creating: ${basename(outputPath)}`)

  // Rename directory to just 'mariadb' for consistency
  const finalDir = resolve(tempDir, 'mariadb')
  renameSync(extractedPath, finalDir)

  // Create tarball
  if (platform.startsWith('win32')) {
    execFileSync('zip', ['-rq', outputPath, 'mariadb'], {
      cwd: tempDir,
      stdio: 'inherit',
    })
  } else {
    execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'mariadb'], {
      stdio: 'inherit',
    })
  }

  // Cleanup temp
  rmSync(tempDir, { recursive: true, force: true })

  logSuccess(`Created: ${outputPath}`)
}

/**
 * Repackage MariaDB4j JAR from Maven Central
 * JAR structure: ch/vorburger/mariadb4j/mariadb-{VERSION}/{PLATFORM}/bin|libs|share|scripts/
 * where PLATFORM is 'osx' for macOS, 'win64' for Windows, 'linux64' for Linux
 */
function repackageMariadb4j(
  jarPath: string,
  outputPath: string,
  version: string,
  platform: Platform,
): void {
  const tempDir = resolve(dirname(jarPath), 'temp-extract')
  mkdirSync(tempDir, { recursive: true })

  logInfo('Extracting JAR...')

  // Extract JAR (it's just a ZIP file)
  execSync(`unzip -q "${jarPath}" -d "${tempDir}"`, { stdio: 'inherit' })

  // MariaDB4j JAR structure: ch/vorburger/mariadb4j/mariadb-{VERSION}/{PLATFORM}/
  // Map our platform names to MariaDB4j platform names
  const platformMap: Record<string, string> = {
    'darwin-arm64': 'osx',
    'darwin-x64': 'osx',
    'linux-x64': 'linux64',
    'linux-arm64': 'linux64',
    'win32-x64': 'win64',
  }
  const mariadb4jPlatform = platformMap[platform] || 'osx'

  // Find the MariaDB distribution directory
  const mariadbSrcDir = resolve(
    tempDir,
    'ch',
    'vorburger',
    'mariadb4j',
    `mariadb-${version}`,
    mariadb4jPlatform,
  )

  if (!existsSync(mariadbSrcDir)) {
    // Try to find the actual path
    const searchResult = execSync(
      `find "${tempDir}" -type d -name "${mariadb4jPlatform}" 2>/dev/null | head -1`,
      { encoding: 'utf-8' },
    ).trim()

    if (!searchResult) {
      throw new Error(
        `Could not find MariaDB4j binaries for platform ${mariadb4jPlatform} in JAR`,
      )
    }
    logInfo(`Found MariaDB4j binaries at: ${searchResult}`)
  }

  const actualSrcDir = existsSync(mariadbSrcDir)
    ? mariadbSrcDir
    : execSync(
        `find "${tempDir}" -type d -name "${mariadb4jPlatform}" 2>/dev/null | head -1`,
        { encoding: 'utf-8' },
      ).trim()

  logInfo(`Extracting from: ${actualSrcDir}`)

  // Create the output directory structure
  const extractDir = resolve(tempDir, 'mariadb')
  mkdirSync(extractDir, { recursive: true })

  // Copy the platform-specific contents to mariadb/
  for (const item of readdirSync(actualSrcDir)) {
    cpSync(resolve(actualSrcDir, item), resolve(extractDir, item), {
      recursive: true,
    })
  }

  // Add metadata file
  const metadata = {
    name: 'mariadb',
    version,
    platform,
    source: 'mariadb4j',
    sourceUrl:
      'https://repo.maven.apache.org/maven2/ch/vorburger/mariaDB4j/',
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    resolve(extractDir, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Clean up the ch/ directory and META-INF
  rmSync(resolve(tempDir, 'ch'), { recursive: true, force: true })
  rmSync(resolve(tempDir, 'META-INF'), { recursive: true, force: true })

  // Create output tarball
  mkdirSync(dirname(outputPath), { recursive: true })

  logInfo(`Creating: ${basename(outputPath)}`)

  // Create tarball or zip based on platform
  if (platform.startsWith('win32')) {
    execFileSync('zip', ['-rq', outputPath, 'mariadb'], {
      cwd: tempDir,
      stdio: 'inherit',
    })
  } else {
    execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'mariadb'], {
      stdio: 'inherit',
    })
  }

  // Cleanup temp
  rmSync(tempDir, { recursive: true, force: true })

  logSuccess(`Created: ${outputPath}`)
}

/**
 * Build MariaDB from source using Docker
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
    logError(`${platform} cannot be built from source`)
    return false
  }

  const buildScript = resolve(__dirname, 'build-local.sh')

  if (!existsSync(buildScript)) {
    logError(`Build script not found: ${buildScript}`)
    return false
  }

  logInfo(`Building ${platform} from source (this may take 45-90+ minutes)...`)
  logInfo(`Running: ${buildScript}`)

  const result = spawnSync(
    buildScript,
    ['--version', version, '--platform', platform, '--output', outputDir, '--cleanup'],
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
  let version = '11.4.5'
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
          logError('Version must be in format: X.Y.Z (e.g., 11.4.5)')
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
Usage: ./builds/mariadb/download.ts [options]

Options:
  --version VERSION    MariaDB version (default: 11.4.5)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download for all platforms (skips build-required unless --build-fallback)
  --build-fallback     Build from source for platforms without binaries (linux only)
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Sources:
  - Official (archive.mariadb.org): linux-x64, win32-x64
  - MariaDB4j (Maven Central): darwin-arm64 (11.4.5 only)
  - Build-required: linux-arm64, darwin-x64, darwin-arm64 (other versions)
  - Source build (Docker): linux-x64, linux-arm64 (with --build-fallback)

Examples:
  ./builds/mariadb/download.ts
  ./builds/mariadb/download.ts --version 11.8.5 --platform linux-x64
  ./builds/mariadb/download.ts --all-platforms
  ./builds/mariadb/download.ts --all-platforms --build-fallback
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
  logInfo(`MariaDB Download Script`)
  logInfo(`Version: ${version}`)
  logInfo(`Platforms: ${platforms.join(', ')}`)
  logInfo(`Output: ${outputDir}`)
  if (buildFallback) {
    logInfo(`Build fallback: enabled (will build from source for Linux platforms)`)
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
          logInfo(`No binary available for ${platform}, building from source...`)
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
        logInfo('Use --build-fallback to build from source, or builds/mariadb/build-local.sh')
        skippedCount++
        continue
      }
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadExt = source.format === 'jar' ? 'jar' : source.format
    const downloadPath = resolve(
      outputDir,
      'downloads',
      `mariadb-${version}-${platform}-original.${downloadExt}`,
    )
    const outputPath = resolve(outputDir, `mariadb-${version}-${platform}.${ext}`)

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
    const sourceType = source.sourceType || 'official'
    if (sourceType === 'mariadb4j') {
      repackageMariadb4j(downloadPath, outputPath, version, platform)
    } else {
      repackageOfficial(
        downloadPath,
        source.format,
        outputPath,
        version,
        platform,
      )
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
