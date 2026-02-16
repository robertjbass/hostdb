#!/usr/bin/env tsx
/**
 * Download Weaviate binaries and repackage for distribution
 *
 * This script:
 * - Downloads official Weaviate binaries for Linux (tar.gz from GitHub Releases)
 * - Cross-compiles Weaviate for macOS/Windows using Go (CGO_ENABLED=0)
 *
 * Usage:
 *   pnpm download:weaviate
 *   pnpm download:weaviate -- --version 1.35.7
 *   pnpm download:weaviate -- --all-platforms
 *
 * Options:
 *   --version VERSION    Weaviate version (default: 1.35.7)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./dist)
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
  copyFileSync,
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

const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type DownloadableSource = {
  url: string
  format: 'tar.gz'
  sourceType: 'official'
  sha256?: string | null
}

type BuildRequiredSource = {
  sourceType: 'build-required'
  note?: string
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

function extractTarGz(sourcePath: string, destDir: string): void {
  logInfo('Extracting tar.gz archive...')
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xzf', sourcePath, '-C', destDir], {
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

/**
 * Cross-compile Weaviate from source using Go
 *
 * Weaviate is pure Go (CGO_ENABLED=0), so cross-compilation is trivial.
 * The entry point is ./cmd/weaviate-server
 */
function crossCompileWeaviate(
  version: string,
  platform: Platform,
  outputDir: string,
): string {
  if (!verifyCommand('go')) {
    throw new Error('Go is required for cross-compilation. Install Go 1.23+')
  }

  if (!verifyCommand('git')) {
    throw new Error('Git is required for cloning Weaviate source')
  }

  const repoDir = join(outputDir, 'weaviate-source')
  const binaryName = platform.startsWith('win32') ? 'weaviate.exe' : 'weaviate'
  const outputPath = join(
    outputDir,
    `weaviate-${version}-${platform}`,
    binaryName,
  )

  const goEnv: Record<Platform, { GOOS: string; GOARCH: string }> = {
    'linux-x64': { GOOS: 'linux', GOARCH: 'amd64' },
    'linux-arm64': { GOOS: 'linux', GOARCH: 'arm64' },
    'darwin-x64': { GOOS: 'darwin', GOARCH: 'amd64' },
    'darwin-arm64': { GOOS: 'darwin', GOARCH: 'arm64' },
    'win32-x64': { GOOS: 'windows', GOARCH: 'amd64' },
  }

  const { GOOS, GOARCH } = goEnv[platform]

  // Clone if not exists (reuse for multiple cross-compile targets)
  if (!existsSync(repoDir)) {
    logInfo('Cloning Weaviate repository...')
    execFileSync(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--branch',
        `v${version}`,
        'https://github.com/weaviate/weaviate.git',
        repoDir,
      ],
      { stdio: 'inherit' },
    )
  }

  logInfo(`Cross-compiling for ${platform} (GOOS=${GOOS}, GOARCH=${GOARCH})...`)

  mkdirSync(dirname(outputPath), { recursive: true })

  const result = spawnSync(
    'go',
    ['build', '-o', outputPath, '-ldflags', '-s -w', './cmd/weaviate-server'],
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

  logSuccess(`Built Weaviate for ${platform}`)
  return outputPath
}

function repackage(
  binaryPath: string,
  outputPath: string,
  version: string,
  platform: Platform,
  source: 'official' | 'cross-compiled',
): void {
  if (platform.startsWith('win32')) {
    if (!verifyCommand('zip')) {
      throw new Error('zip command required for Windows packaging')
    }
  } else {
    if (!verifyCommand('tar')) {
      throw new Error('tar command required for packaging')
    }
  }

  const tempDir = resolve(dirname(outputPath), 'temp-package')
  const weaviateDir = resolve(tempDir, 'weaviate')

  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(weaviateDir, { recursive: true })

  // Copy binary
  const binaryName = platform.startsWith('win32') ? 'weaviate.exe' : 'weaviate'
  const destBinary = resolve(weaviateDir, binaryName)

  copyFileSync(binaryPath, destBinary)
  if (!platform.startsWith('win32')) {
    chmodSync(destBinary, 0o755)
  }

  // Add metadata file
  const metadata: Record<string, unknown> = {
    name: 'weaviate',
    version,
    platform,
    source,
    rehosted_by: 'hostdb',
    rehosted_at: new Date().toISOString(),
  }

  if (platform === 'win32-x64') {
    metadata.warnings = [
      'Weaviate on Windows is cross-compiled from source. Weaviate uses mmap for storage which has limited Windows support. Use with caution for non-production workloads.',
    ]
    logWarn('Weaviate on Windows uses mmap which has limited Windows support.')
  }

  writeFileSync(
    resolve(weaviateDir, '.hostdb-metadata.json'),
    JSON.stringify(metadata, null, 2),
  )

  // Create output archive
  mkdirSync(dirname(outputPath), { recursive: true })
  logInfo(`Creating: ${basename(outputPath)}`)

  if (platform.startsWith('win32')) {
    execFileSync('zip', ['-rq', outputPath, 'weaviate'], {
      stdio: 'inherit',
      cwd: tempDir,
    })
  } else {
    execFileSync('tar', ['-czf', outputPath, '-C', tempDir, 'weaviate'], {
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
  let version = '1.35.7'
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
          logError('Version must be in format: X.Y.Z (e.g., 1.35.7)')
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
Usage: pnpm download:weaviate [options]

Downloads Weaviate binaries (official or cross-compiled):
  - Linux: Official binaries from GitHub Releases
  - macOS/Windows: Cross-compiled from source (requires Go 1.23+)

Options:
  --version VERSION    Weaviate version (default: 1.35.7)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Download/build for all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Examples:
  pnpm download:weaviate
  pnpm download:weaviate -- --version 1.35.7 --platform linux-x64
  pnpm download:weaviate -- --all-platforms
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
  logInfo(`Weaviate Download Script`)
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
    logInfo(`========== ${platform} ==========`)

    const source = versionSources[platform]
    if (!source) {
      logWarn(`No source for ${platform}, skipping`)
      skipCount++
      continue
    }

    // Check if Go is available for build-required platforms
    if (!isDownloadableSource(source) && !verifyCommand('go')) {
      logWarn(
        `${platform} requires Go for cross-compilation, but Go is not installed`,
      )
      logInfo('Install Go 1.23+ to build for this platform')
      skipCount++
      continue
    }

    const ext = platform.startsWith('win32') ? 'zip' : 'tar.gz'
    const downloadDir = resolve(outputDir, 'downloads')
    const outputPath = resolve(
      outputDir,
      `weaviate-${version}-${platform}.${ext}`,
    )

    mkdirSync(downloadDir, { recursive: true })

    try {
      let binaryPath: string

      if (isDownloadableSource(source)) {
        // Download official archive and extract binary
        const downloadPath = join(
          downloadDir,
          `weaviate-${version}-${platform}-original.${source.format}`,
        )

        if (existsSync(downloadPath)) {
          logInfo(`Using cached download: ${basename(downloadPath)}`)
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
          logWarn(
            'No checksum in sources.json - update it with the SHA256 above',
          )
        }

        // Extract and find binary
        const extractDir = resolve(downloadDir, 'extract', platform)
        rmSync(extractDir, { recursive: true, force: true })
        extractTarGz(downloadPath, extractDir)

        binaryPath = findBinary(extractDir, 'weaviate')
        logInfo(`Found binary: ${binaryPath}`)

        // Repackage
        repackage(binaryPath, outputPath, version, platform, 'official')

        // Cleanup extract dir
        rmSync(extractDir, { recursive: true, force: true })
      } else {
        // Cross-compile from source
        const builtBinaryPath = crossCompileWeaviate(
          version,
          platform,
          downloadDir,
        )

        repackage(
          builtBinaryPath,
          outputPath,
          version,
          platform,
          'cross-compiled',
        )
      }

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
