#!/usr/bin/env tsx
/**
 * Download official QuestDB binaries for re-hosting
 *
 * Usage:
 *   pnpm download:questdb
 *   pnpm download:questdb -- --version 9.2.3
 *   pnpm download:questdb -- --all-platforms
 *
 * QuestDB distribution:
 * - Linux x64, Windows x64: Official -rt- packages with bundled JRE
 * - Linux ARM64, macOS: No-JRE package + bundled Adoptium Temurin JRE 21
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
  statSync,
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

// Platforms that need JRE bundling (no official -rt- package)
const PLATFORMS_NEEDING_JRE: Platform[] = [
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
]

// Adoptium JRE download URLs (using latest JRE 21 LTS)
const JRE_URLS: Record<string, string> = {
  'linux-arm64':
    'https://api.adoptium.net/v3/binary/latest/21/ga/linux/aarch64/jre/hotspot/normal/eclipse',
  'darwin-x64':
    'https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jre/hotspot/normal/eclipse',
  'darwin-arm64':
    'https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jre/hotspot/normal/eclipse',
}

function isValidPlatform(value: string): value is Platform {
  return VALID_PLATFORMS.includes(value as Platform)
}

const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type SourceEntry = {
  url: string
  format: 'tar.gz' | 'zip'
  sha256?: string | null
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

function extractTarGz(sourcePath: string, destDir: string): void {
  logInfo('Extracting tar.gz archive...')
  mkdirSync(destDir, { recursive: true })
  verifyCommand('tar')
  execFileSync('tar', ['-xzf', sourcePath, '-C', destDir], {
    stdio: 'inherit',
  })
}

function findDirectory(dir: string, prefix: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(prefix)) {
      return join(dir, entry.name)
    }
  }
  return null
}

function needsJre(platform: Platform): boolean {
  return PLATFORMS_NEEDING_JRE.includes(platform)
}

async function downloadAndExtractJre(
  platform: Platform,
  downloadDir: string,
): Promise<string> {
  const jreUrl = JRE_URLS[platform]
  if (!jreUrl) {
    throw new Error(`No JRE URL for platform: ${platform}`)
  }

  const jreDownloadPath = join(downloadDir, `jre-21-${platform}.tar.gz`)

  if (existsSync(jreDownloadPath)) {
    logInfo(`Using cached JRE download: ${basename(jreDownloadPath)}`)
  } else {
    logInfo('=== Downloading Adoptium JRE 21 ===')
    await downloadFile(jreUrl, jreDownloadPath)
  }

  // Extract JRE
  const jreExtractDir = join(downloadDir, `jre-extract-${platform}`)
  rmSync(jreExtractDir, { recursive: true, force: true })
  mkdirSync(jreExtractDir, { recursive: true })
  extractTarGz(jreDownloadPath, jreExtractDir)

  // Find the JRE directory (format: jdk-21.x.x+y-jre on Linux, or jdk-21.x.x+y-jre/Contents/Home on macOS)
  const jreDir = findDirectory(jreExtractDir, 'jdk-')
  if (!jreDir) {
    throw new Error('Could not find extracted JRE directory')
  }

  // On macOS, the actual JRE is in Contents/Home
  if (platform.startsWith('darwin')) {
    const macJreHome = join(jreDir, 'Contents', 'Home')
    if (existsSync(macJreHome)) {
      return macJreHome
    }
  }

  return jreDir
}

function makeExecutable(dir: string): void {
  // Make shell scripts and binaries executable
  const binDir = join(dir, 'bin')
  if (existsSync(binDir)) {
    for (const file of readdirSync(binDir)) {
      const filePath = join(binDir, file)
      const stat = statSync(filePath)
      if (stat.isFile()) {
        chmodSync(filePath, 0o755)
      }
    }
  }

  // Also check for questdb.sh at root
  const questdbSh = join(dir, 'questdb.sh')
  if (existsSync(questdbSh)) {
    chmodSync(questdbSh, 0o755)
  }
}

async function repackage(
  version: string,
  platform: Platform,
  questdbDir: string,
  jreDir: string | null,
  outputPath: string,
): Promise<void> {
  const tempDir = resolve(dirname(outputPath), 'temp-package')
  const bundleDir = join(tempDir, 'questdb')

  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(bundleDir, { recursive: true })

  // Copy QuestDB files
  logInfo('Copying QuestDB files...')
  cpSync(questdbDir, bundleDir, { recursive: true })

  // Bundle JRE if needed
  if (jreDir) {
    logInfo('Bundling JRE...')
    const jreDestDir = join(bundleDir, 'jre')
    cpSync(jreDir, jreDestDir, { recursive: true })
    logSuccess('JRE bundled')
  }

  // Make scripts executable
  makeExecutable(bundleDir)
  if (jreDir) {
    makeExecutable(join(bundleDir, 'jre'))
  }

  // Add metadata file
  const metadata = {
    name: 'questdb',
    version,
    platform,
    source: 'official',
    jre_bundled: jreDir ? 'adoptium-21' : 'included',
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }
  writeFileSync(
    join(bundleDir, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Create output archive
  mkdirSync(dirname(outputPath), { recursive: true })
  logInfo(`Creating: ${basename(outputPath)}`)

  if (platform.startsWith('win32')) {
    verifyCommand('zip')
    execFileSync('zip', ['-rq', outputPath, 'questdb'], {
      stdio: 'inherit',
      cwd: tempDir,
    })
  } else {
    verifyCommand('tar')
    execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'questdb'], {
      stdio: 'inherit',
    })
  }

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
  let version = '9.2.3'
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
          logError('Version must be in format: X.Y.Z (e.g., 9.2.3)')
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
Usage: pnpm download:questdb [options]

Downloads and bundles QuestDB with JRE for all platforms.

Options:
  --version VERSION    QuestDB version (default: 9.2.3)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download for all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Notes:
  - Linux x64 and Windows x64 use official -rt- packages (JRE included)
  - Linux ARM64 and macOS use no-JRE package + bundled Adoptium JRE 21

Examples:
  pnpm download:questdb
  pnpm download:questdb -- --version 9.2.3 --platform linux-x64
  pnpm download:questdb -- --all-platforms
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
  logInfo(`QuestDB Download Script`)
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
    logInfo(`========== ${platform} ==========`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source for ${platform}, skipping`)
      continue
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadDir = resolve(outputDir, 'downloads')
    const outputPath = resolve(outputDir, `questdb-${version}-${platform}.${ext}`)

    mkdirSync(downloadDir, { recursive: true })

    try {
      // Download QuestDB
      const questdbDownloadPath = join(
        downloadDir,
        `questdb-${version}-${platform}-original.tar.gz`,
      )

      if (existsSync(questdbDownloadPath)) {
        logInfo(`Using cached download: ${basename(questdbDownloadPath)}`)
      } else {
        logInfo('=== Downloading QuestDB ===')
        await downloadFile(source.url, questdbDownloadPath)
      }

      // Verify checksum if available
      const actualSha256 = await calculateSha256(questdbDownloadPath)
      logInfo(`SHA256: ${actualSha256}`)

      if (source.sha256) {
        if (actualSha256 === source.sha256) {
          logSuccess('Checksum verified')
        } else {
          logError(`Checksum mismatch! Expected: ${source.sha256}`)
          continue
        }
      } else {
        logWarn('No checksum in sources.json - update it with the SHA256 above')
      }

      // Extract QuestDB
      const extractDir = join(downloadDir, `extract-${platform}`)
      rmSync(extractDir, { recursive: true, force: true })
      mkdirSync(extractDir, { recursive: true })
      extractTarGz(questdbDownloadPath, extractDir)

      // Find extracted QuestDB directory
      const questdbDir = findDirectory(extractDir, 'questdb-')
      if (!questdbDir) {
        throw new Error('Could not find extracted QuestDB directory')
      }
      logInfo(`Found QuestDB: ${questdbDir}`)

      // Download and extract JRE if needed
      let jreDir: string | null = null
      if (needsJre(platform)) {
        logInfo(`Platform ${platform} needs JRE bundling`)
        jreDir = await downloadAndExtractJre(platform, downloadDir)
        logInfo(`Found JRE: ${jreDir}`)
      }

      // Repackage
      await repackage(version, platform, questdbDir, jreDir, outputPath)

      // Cleanup extract directory
      rmSync(extractDir, { recursive: true, force: true })

      // Final checksum
      const outputSha256 = await calculateSha256(outputPath)
      logInfo(`Output SHA256: ${outputSha256}`)

      successCount++
    } catch (error) {
      logError(`Failed for ${platform}: ${error}`)
    }
  }

  console.log()
  logSuccess(`Done! ${successCount}/${platforms.length} platforms completed`)
  logInfo(`Output files in: ${resolve(outputDir)}`)
}

main().catch((err) => {
  logError(err.message)
  process.exit(1)
})
