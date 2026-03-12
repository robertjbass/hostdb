#!/usr/bin/env tsx
/**
 * Download official libSQL server (sqld) binaries for re-hosting
 *
 * Usage:
 *   pnpm download:libsql
 *   pnpm download:libsql -- --version 0.24.32
 *   pnpm download:libsql -- --all-platforms
 *
 * libSQL distributes tar.xz archives containing the sqld binary
 * for Linux (x64, arm64) and macOS (x64, arm64). No Windows binaries.
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
  chmodSync,
  copyFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

type Platform = 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64'

const VALID_PLATFORMS: Platform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
]

function isValidPlatform(value: string): value is Platform {
  return VALID_PLATFORMS.includes(value as Platform)
}

const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type SourceEntry = {
  url: string
  format: 'tar.xz'
  sha256: string | null
  sourceType: 'official'
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

  throw new Error(
    `Unsupported platform: ${platform}-${arch}. libSQL only supports Linux and macOS.`,
  )
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

function verifyCommand(command: string): void {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(whichCmd, [command], { stdio: 'pipe' })
  } catch {
    throw new Error(`Required command not found: ${command}`)
  }
}

function extractTarXz(sourcePath: string, destDir: string): void {
  logInfo('Extracting tar.xz archive...')
  mkdirSync(destDir, { recursive: true })
  verifyCommand('tar')
  execFileSync('tar', ['-xJf', sourcePath, '-C', destDir], {
    stdio: 'inherit',
  })
}

function findBinary(dir: string, binaryName: string): string {
  const files = readdirSync(dir, { withFileTypes: true })

  for (const file of files) {
    const fullPath = resolve(dir, file.name)
    if (file.isDirectory()) {
      try {
        const found = findBinary(fullPath, binaryName)
        if (found) return found
      } catch {
        // Continue searching
      }
    } else if (
      file.name === binaryName ||
      file.name.toLowerCase() === binaryName.toLowerCase()
    ) {
      return fullPath
    }
  }

  throw new Error(`Could not find ${binaryName} in ${dir}`)
}

function repackage(
  binaryPath: string,
  outputPath: string,
  version: string,
  platform: Platform,
): void {
  verifyCommand('tar')

  const tempDir = resolve(dirname(binaryPath), 'temp-package')
  const libsqlDir = resolve(tempDir, 'libsql')
  const binDir = resolve(libsqlDir, 'bin')

  mkdirSync(binDir, { recursive: true })

  // Copy binary to bin/
  const destBinary = resolve(binDir, 'sqld')
  copyFileSync(binaryPath, destBinary)
  chmodSync(destBinary, 0o755)

  // Add metadata file
  const metadata = {
    name: 'libsql',
    version,
    platform,
    source: 'official',
    tools: ['sqld'],
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    resolve(libsqlDir, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Create output tarball
  mkdirSync(dirname(outputPath), { recursive: true })
  logInfo(`Creating: ${basename(outputPath)}`)

  execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'libsql'], {
    stdio: 'inherit',
  })

  // Cleanup
  rmSync(tempDir, { recursive: true, force: true })

  logSuccess(`Created: ${outputPath}`)
}

function parseArgs(): {
  version: string
  platforms: Platform[]
  outputDir: string
} {
  const args = process.argv.slice(2)
  let version = '0.24.32'
  let platforms: Platform[] = []
  let outputDir = './dist'
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
          break
        }
        const versionValue = args[++i]
        if (!isValidVersion(versionValue)) {
          logError(`Invalid version format: ${versionValue}`)
          logError('Version must be in format: X.Y.Z (e.g., 0.24.32)')
          process.exit(1)
          break
        }
        version = versionValue
        break
      }
      case '--platform': {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          logError('--platform requires a value')
          process.exit(1)
          break
        }
        const platformValue = args[++i]
        if (!isValidPlatform(platformValue)) {
          logError(`Invalid platform: ${platformValue}`)
          logError(`Valid platforms: ${VALID_PLATFORMS.join(', ')}`)
          process.exit(1)
          break
        }
        platforms.push(platformValue)
        break
      }
      case '--output':
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          logError('--output requires a value')
          process.exit(1)
          break
        }
        outputDir = args[++i]
        break
      case '--all-platforms':
        allPlatforms = true
        break
      case '--help':
      case '-h':
        console.log(`
Usage: pnpm download:libsql [options]

Options:
  --version VERSION    libSQL version (default: 0.24.32)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download for all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64

Note: No Windows binaries available (use WSL)

Examples:
  pnpm download:libsql
  pnpm download:libsql -- --version 0.24.32 --platform linux-x64
  pnpm download:libsql -- --all-platforms
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

  return { version, platforms, outputDir }
}

async function main() {
  const { version, platforms, outputDir } = parseArgs()
  const sources = loadSources()

  console.log()
  logInfo(`libSQL (sqld) Download Script`)
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

  for (const platform of platforms) {
    console.log()
    logInfo(`=== ${platform} ===`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source for ${platform}, skipping`)
      continue
    }

    const downloadPath = resolve(
      outputDir,
      'downloads',
      `libsql-${version}-${platform}-original.tar.xz`,
    )
    const outputPath = resolve(
      outputDir,
      `libsql-${version}-${platform}.tar.gz`,
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

    // Extract from tar.xz
    const extractDir = resolve(outputDir, 'extract', platform)
    rmSync(extractDir, { recursive: true, force: true })
    mkdirSync(extractDir, { recursive: true })
    extractTarXz(downloadPath, extractDir)

    // Find the sqld binary
    const binaryPath = findBinary(extractDir, 'sqld')
    logInfo(`Found binary: ${binaryPath}`)

    // Repackage with metadata
    repackage(binaryPath, outputPath, version, platform)

    // Cleanup extract directory
    rmSync(extractDir, { recursive: true, force: true })

    // Final checksum
    const outputSha256 = await calculateSha256(outputPath)
    logInfo(`Output SHA256: ${outputSha256}`)

    successCount++
  }

  console.log()
  logSuccess(`Done! ${successCount}/${platforms.length} platforms completed`)
  logInfo(`Output files in: ${resolve(outputDir)}`)
}

main().catch((err) => {
  logError(err.message)
  process.exit(1)
})
