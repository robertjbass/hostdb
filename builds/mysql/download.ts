#!/usr/bin/env tsx
/**
 * Download official MySQL binaries for re-hosting
 *
 * Usage:
 *   ./builds/mysql/download.ts [options]
 *   pnpm tsx builds/mysql/download.ts [options]
 *
 * Options:
 *   --version VERSION    MySQL version (default: 8.4.3)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./dist)
 *   --all-platforms      Download for all platforms
 *   --help               Show help
 */

import {
  createWriteStream,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

type Platform =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64'

type SourceEntry = {
  url: string
  format: 'tar.xz' | 'tar.gz' | 'zip'
  sha256: string | null
}

type Sources = {
  database: string
  baseUrl: string
  versions: Record<string, Record<Platform, SourceEntry>>
  notes: Record<string, string>
}

// Colors
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

// Detect current platform
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

// Load sources.json
function loadSources(): Sources {
  const sourcesPath = resolve(__dirname, 'sources.json')
  const content = readFileSync(sourcesPath, 'utf-8')
  return JSON.parse(content) as Sources
}

// Download file with progress
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

// Calculate SHA256 checksum
function calculateSha256(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

// Extract and repackage
function repackage(
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
  if (format === 'tar.xz') {
    execSync(`tar -xJf "${sourcePath}" -C "${tempDir}"`, { stdio: 'inherit' })
  } else if (format === 'tar.gz') {
    execSync(`tar -xzf "${sourcePath}" -C "${tempDir}"`, { stdio: 'inherit' })
  } else if (format === 'zip') {
    execSync(`unzip -q "${sourcePath}" -d "${tempDir}"`, { stdio: 'inherit' })
  }

  // Find extracted directory (MySQL extracts to mysql-VERSION-PLATFORM/)
  const extractedDirs = execSync(`ls "${tempDir}"`, { encoding: 'utf-8' })
    .trim()
    .split('\n')
  const mysqlDir = extractedDirs.find((d) => d.startsWith('mysql-'))

  if (!mysqlDir) {
    throw new Error('Could not find extracted MySQL directory')
  }

  const extractedPath = resolve(tempDir, mysqlDir)

  // Add metadata file
  const metadata = {
    name: 'mysql',
    version,
    platform,
    source: 'official',
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

  // Rename directory to just 'mysql' for consistency
  const finalDir = resolve(tempDir, 'mysql')
  execSync(`mv "${extractedPath}" "${finalDir}"`)

  // Create tarball
  if (platform.startsWith('win32')) {
    execSync(`cd "${tempDir}" && zip -rq "${outputPath}" mysql`, {
      stdio: 'inherit',
    })
  } else {
    execSync(`tar -czf "${outputPath}" -C "${tempDir}" mysql`, {
      stdio: 'inherit',
    })
  }

  // Cleanup temp
  execSync(`rm -rf "${tempDir}"`)

  logSuccess(`Created: ${outputPath}`)
}

// Parse CLI arguments
function parseArgs(): {
  version: string
  platforms: Platform[]
  outputDir: string
} {
  const args = process.argv.slice(2)
  let version = '8.4.3'
  let platforms: Platform[] = []
  let outputDir = './dist'
  let allPlatforms = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--version':
        version = args[++i]
        break
      case '--platform':
        platforms.push(args[++i] as Platform)
        break
      case '--output':
        outputDir = args[++i]
        break
      case '--all-platforms':
        allPlatforms = true
        break
      case '--help':
      case '-h':
        console.log(`
Usage: ./builds/mysql/download.ts [options]

Options:
  --version VERSION    MySQL version (default: 8.4.3)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download for all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Examples:
  ./builds/mysql/download.ts
  ./builds/mysql/download.ts --version 8.0.40 --platform linux-x64
  ./builds/mysql/download.ts --all-platforms
`)
        process.exit(0)
    }
  }

  if (allPlatforms) {
    platforms = [
      'linux-x64',
      'linux-arm64',
      'darwin-x64',
      'darwin-arm64',
      'win32-x64',
    ]
  } else if (platforms.length === 0) {
    platforms = [detectPlatform()]
  }

  return { version, platforms, outputDir }
}

// Main
async function main() {
  const { version, platforms, outputDir } = parseArgs()
  const sources = loadSources()

  console.log()
  logInfo(`MySQL Download Script`)
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

  for (const platform of platforms) {
    console.log()
    logInfo(`=== ${platform} ===`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source for ${platform}, skipping`)
      continue
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadPath = resolve(
      outputDir,
      'downloads',
      `mysql-${version}-${platform}-original.${source.format}`,
    )
    const outputPath = resolve(outputDir, `mysql-${version}-${platform}.${ext}`)

    // Download
    if (existsSync(downloadPath)) {
      logInfo(`Using cached download: ${downloadPath}`)
    } else {
      await downloadFile(source.url, downloadPath)
    }

    // Verify checksum
    const actualSha256 = calculateSha256(downloadPath)
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

    // Repackage
    repackage(downloadPath, source.format, outputPath, version, platform)

    // Final checksum
    const outputSha256 = calculateSha256(outputPath)
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
