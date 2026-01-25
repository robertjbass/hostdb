#!/usr/bin/env tsx
/**
 * Download CouchDB binaries from Neighbourhoodie for re-hosting
 *
 * Sources:
 *   - Neighbourhoodie: Official macOS and Windows binaries
 *   - Docker: Linux binaries extracted from official Docker image
 *
 * Usage:
 *   ./builds/couchdb/download.ts [options]
 *   pnpm tsx builds/couchdb/download.ts [options]
 *
 * Options:
 *   --version VERSION    CouchDB version (default: 3.5.1)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./downloads)
 *   --all-platforms      Download for all platforms (skips docker-extract unless --build-fallback)
 *   --build-fallback     Build from Docker for platforms without binaries (linux only)
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
  cpSync,
  statSync,
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

// Validate version format to prevent command injection (e.g., "3.5.1")
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type DownloadableSource = {
  url: string
  format: 'zip' | 'msi'
  sha256: string | null
  sourceType: 'neighbourhoodie'
}

type DockerExtractSource = {
  sourceType: 'docker-extract'
}

type SourceEntry = DownloadableSource | DockerExtractSource

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
 * Repackage macOS ZIP (contains Apache CouchDB.app bundle)
 * Structure: Apache CouchDB.app/Contents/Resources/couchdbx-core/
 */
function repackageMacOS(
  zipPath: string,
  outputPath: string,
  version: string,
  platform: Platform,
): void {
  const tempDir = resolve(dirname(zipPath), 'temp-extract')
  mkdirSync(tempDir, { recursive: true })

  logInfo('Extracting macOS ZIP...')
  execFileSync('unzip', ['-q', zipPath, '-d', tempDir], { stdio: 'inherit' })

  // Find the .app bundle
  const appDir = readdirSync(tempDir).find((d) => d.endsWith('.app'))
  if (!appDir) {
    throw new Error('Could not find .app bundle in ZIP')
  }

  // CouchDB stores the actual installation in Contents/Resources/couchdbx-core/
  const couchdbCorePath = resolve(
    tempDir,
    appDir,
    'Contents',
    'Resources',
    'couchdbx-core',
  )

  if (!existsSync(couchdbCorePath)) {
    // Fallback: check if it's directly in Contents/Resources
    const resourcesPath = resolve(tempDir, appDir, 'Contents', 'Resources')
    logWarn(`couchdbx-core not found, checking Resources directory structure`)

    // List what we have
    if (existsSync(resourcesPath)) {
      const contents = readdirSync(resourcesPath)
      logInfo(`Resources contents: ${contents.join(', ')}`)
    }
    throw new Error(
      `Could not find CouchDB installation in app bundle at ${couchdbCorePath}`,
    )
  }

  // Create output directory structure
  const finalDir = resolve(tempDir, 'couchdb')
  mkdirSync(finalDir, { recursive: true })

  // Copy the couchdbx-core contents to couchdb/
  logInfo('Copying CouchDB files...')
  cpSync(couchdbCorePath, finalDir, { recursive: true })

  // Add metadata file
  const metadata = {
    name: 'couchdb',
    version,
    platform,
    source: 'neighbourhoodie',
    sourceUrl: 'https://neighbourhood.ie/couchdb-support/download-binaries',
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    resolve(finalDir, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Verify key directories/files exist
  const binDir = resolve(finalDir, 'bin')
  if (!existsSync(binDir)) {
    logWarn('bin directory not found, checking structure...')
    const contents = readdirSync(finalDir)
    logInfo(`CouchDB directory contents: ${contents.join(', ')}`)
  }

  // Create output directory
  mkdirSync(dirname(outputPath), { recursive: true })

  logInfo(`Creating: ${basename(outputPath)}`)

  // Create tar.gz for Unix platforms
  execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'couchdb'], {
    stdio: 'inherit',
  })

  // Cleanup temp
  rmSync(tempDir, { recursive: true, force: true })

  logSuccess(`Created: ${outputPath}`)
}

/**
 * Repackage Windows MSI installer
 * On Windows: use msiexec to extract
 * On other platforms: use 7z if available, otherwise leave as MSI for CI
 */
function repackageWindowsMSI(
  msiPath: string,
  outputPath: string,
  version: string,
  platform: Platform,
): void {
  const tempDir = resolve(dirname(msiPath), 'temp-extract-win')
  mkdirSync(tempDir, { recursive: true })

  logInfo('Extracting MSI installer...')

  // Try different extraction methods
  let extracted = false

  if (process.platform === 'win32') {
    // On Windows, use msiexec
    try {
      execFileSync(
        'msiexec',
        ['/a', msiPath, '/qn', `TARGETDIR=${tempDir}`],
        { stdio: 'inherit' },
      )
      extracted = true
    } catch {
      logWarn('msiexec extraction failed')
    }
  }

  if (!extracted) {
    // Try 7z (works on all platforms if installed)
    try {
      execFileSync('7z', ['x', '-y', `-o${tempDir}`, msiPath], {
        stdio: 'inherit',
      })
      extracted = true
    } catch {
      logWarn('7z not available for MSI extraction')
    }
  }

  if (!extracted) {
    // Try msitools on Linux/macOS
    try {
      execFileSync('msiextract', ['-C', tempDir, msiPath], { stdio: 'inherit' })
      extracted = true
    } catch {
      logWarn('msiextract not available')
    }
  }

  if (!extracted) {
    // Fallback: just copy the MSI as-is and let the CI workflow handle extraction
    logWarn('No MSI extraction tool available')
    logInfo('Leaving MSI as-is - CI workflow will extract on Windows runner')

    // Create a simple wrapper directory
    const finalDir = resolve(tempDir, 'couchdb')
    mkdirSync(finalDir, { recursive: true })

    // Copy MSI into the directory
    cpSync(msiPath, resolve(finalDir, basename(msiPath)))

    // Add metadata
    const metadata = {
      name: 'couchdb',
      version,
      platform,
      source: 'neighbourhoodie',
      sourceUrl: 'https://neighbourhood.ie/couchdb-support/download-binaries',
      rehosted_by: 'hostdb',
      rehosted_at: new Date().toISOString(),
      note: 'Contains MSI installer - extract with msiexec /a',
    }
    writeFileSync(
      resolve(finalDir, '.hostdb-metadata.json'),
      JSON.stringify(metadata, null, 2),
    )

    // Create ZIP for Windows
    mkdirSync(dirname(outputPath), { recursive: true })
    execFileSync('zip', ['-rq', outputPath, 'couchdb'], {
      cwd: tempDir,
      stdio: 'inherit',
    })

    rmSync(tempDir, { recursive: true, force: true })
    logSuccess(`Created: ${outputPath} (contains MSI, needs extraction)`)
    return
  }

  // Find CouchDB installation directory
  logInfo('Looking for CouchDB installation in extracted MSI...')
  const entries = readdirSync(tempDir)
  logInfo(`Extracted contents: ${entries.join(', ')}`)

  // MSI typically extracts to a ProgramFiles structure or directly
  // Look for Apache CouchDB folder or couchdb binaries
  let couchdbDir = ''

  // Common patterns for CouchDB MSI
  const searchDirs = [
    resolve(tempDir, 'Apache CouchDB'),
    resolve(tempDir, 'Apache', 'CouchDB'),
    resolve(tempDir, 'CouchDB'),
    resolve(tempDir, 'Program Files', 'Apache CouchDB'),
    resolve(tempDir, 'PFiles', 'Apache CouchDB'),
  ]

  for (const dir of searchDirs) {
    if (existsSync(dir)) {
      couchdbDir = dir
      break
    }
  }

  // If not found, search recursively for bin/couchdb.cmd or similar
  if (!couchdbDir) {
    function findCouchDB(dir: string): string | null {
      try {
        const entries = readdirSync(dir)
        for (const entry of entries) {
          const fullPath = resolve(dir, entry)
          const stat = statSync(fullPath)
          if (stat.isDirectory()) {
            // Check if this looks like a CouchDB installation
            if (
              existsSync(resolve(fullPath, 'bin')) &&
              existsSync(resolve(fullPath, 'etc'))
            ) {
              return fullPath
            }
            const found = findCouchDB(fullPath)
            if (found) return found
          }
        }
      } catch {
        // Ignore permission errors
      }
      return null
    }
    couchdbDir = findCouchDB(tempDir) || ''
  }

  if (!couchdbDir) {
    logError('Could not find CouchDB installation in extracted MSI')
    logInfo('Listing temp directory contents recursively...')
    execFileSync('find', [tempDir, '-type', 'd', '-maxdepth', '3'], {
      stdio: 'inherit',
    })
    throw new Error('Failed to locate CouchDB installation')
  }

  logInfo(`Found CouchDB at: ${couchdbDir}`)

  // Create final directory structure
  const finalDir = resolve(tempDir, 'couchdb-final', 'couchdb')
  mkdirSync(finalDir, { recursive: true })

  // Copy CouchDB files
  cpSync(couchdbDir, finalDir, { recursive: true })

  // Add metadata
  const metadata = {
    name: 'couchdb',
    version,
    platform,
    source: 'neighbourhoodie',
    sourceUrl: 'https://neighbourhood.ie/couchdb-support/download-binaries',
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    resolve(finalDir, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Create ZIP for Windows
  mkdirSync(dirname(outputPath), { recursive: true })
  logInfo(`Creating: ${basename(outputPath)}`)

  execFileSync(
    'zip',
    ['-rq', outputPath, 'couchdb'],
    {
      cwd: resolve(tempDir, 'couchdb-final'),
      stdio: 'inherit',
    },
  )

  // Cleanup
  rmSync(tempDir, { recursive: true, force: true })

  logSuccess(`Created: ${outputPath}`)
}

/**
 * Build from Docker image (Linux platforms only)
 */
function buildFromDocker(
  version: string,
  platform: Platform,
  outputDir: string,
): boolean {
  if (platform !== 'linux-x64' && platform !== 'linux-arm64') {
    logError('Docker extraction only supports linux-x64 and linux-arm64')
    return false
  }

  const buildScript = resolve(__dirname, 'build-local.sh')

  if (!existsSync(buildScript)) {
    logError(`Build script not found: ${buildScript}`)
    return false
  }

  logInfo(
    `Extracting from Docker image for ${platform} (this may take a few minutes)...`,
  )
  logInfo(`Running: ${buildScript}`)

  const result = spawnSync(
    buildScript,
    ['--version', version, '--platform', platform, '--output', outputDir],
    {
      stdio: 'inherit',
      cwd: resolve(__dirname, '../..'),
      env: { ...process.env, CI: 'true' },
    },
  )

  if (result.status !== 0) {
    logError(`Docker extraction failed with exit code: ${result.status}`)
    return false
  }

  logSuccess(`Docker extraction completed for ${platform}`)
  return true
}

function parseArgs(): {
  version: string
  platforms: Platform[]
  outputDir: string
  buildFallback: boolean
} {
  const args = process.argv.slice(2)
  let version = '3.5.1'
  let platforms: Platform[] = []
  let outputDir = './downloads'
  let allPlatforms = false
  let buildFallback = false

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
          logError('Version must be in format: X.Y.Z (e.g., 3.5.1)')
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
Usage: ./builds/couchdb/download.ts [options]

Options:
  --version VERSION    CouchDB version (default: 3.5.1)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./downloads)
  --all-platforms      Download for all platforms (skips docker-extract unless --build-fallback)
  --build-fallback     Extract from Docker for Linux platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Sources:
  - Neighbourhoodie (neighbourhood.ie): darwin-x64, darwin-arm64, win32-x64
  - Docker extraction: linux-x64, linux-arm64 (with --build-fallback)

Examples:
  ./builds/couchdb/download.ts
  ./builds/couchdb/download.ts --version 3.5.1 --platform darwin-arm64
  ./builds/couchdb/download.ts --all-platforms
  ./builds/couchdb/download.ts --all-platforms --build-fallback
`)
        process.exit(0)
        break // unreachable, but required for no-fallthrough rule
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
  logInfo('CouchDB Download Script')
  logInfo(`Version: ${version}`)
  logInfo(`Platforms: ${platforms.join(', ')}`)
  logInfo(`Output: ${outputDir}`)
  if (buildFallback) {
    logInfo(
      'Build fallback: enabled (will extract from Docker for Linux platforms)',
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

    // Handle docker-extract sources
    if (!isDownloadableSource(source)) {
      if (buildFallback) {
        const canBuild = platform === 'linux-x64' || platform === 'linux-arm64'
        if (canBuild) {
          logInfo(
            `No binary available for ${platform}, extracting from Docker...`,
          )
          const success = buildFromDocker(version, platform, outputDir)
          if (success) {
            builtCount++
          } else {
            logError(`Failed to extract ${platform} from Docker`)
            skippedCount++
          }
          continue
        } else {
          logWarn(
            `${platform} requires Docker extraction but only Linux platforms are supported`,
          )
          skippedCount++
          continue
        }
      } else {
        logWarn(
          `${platform} requires Docker extraction (no binary available)`,
        )
        logInfo(
          'Use --build-fallback to extract from Docker, or use builds/couchdb/build-local.sh',
        )
        skippedCount++
        continue
      }
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const originalExt = source.format === 'msi' ? 'msi' : source.format
    const downloadPath = resolve(
      outputDir,
      'downloads',
      `couchdb-${version}-${platform}-original.${originalExt}`,
    )
    const outputPath = resolve(
      outputDir,
      `couchdb-${version}-${platform}.${ext}`,
    )

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

    // Repackage based on platform and format
    if (platform.startsWith('darwin')) {
      repackageMacOS(downloadPath, outputPath, version, platform)
    } else if (platform === 'win32-x64') {
      repackageWindowsMSI(downloadPath, outputPath, version, platform)
    } else {
      logError(`Unexpected platform for download: ${platform}`)
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
    logInfo(`Extracted from Docker: ${builtCount} platform(s)`)
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
