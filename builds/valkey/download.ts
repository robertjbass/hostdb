#!/usr/bin/env tsx
/**
 * Download/Build Valkey binaries for re-hosting
 *
 * Valkey requires building from source for ALL platforms (no pre-built binaries available).
 *
 * Usage:
 *   ./builds/valkey/download.ts [options]
 *   pnpm tsx builds/valkey/download.ts [options]
 *
 * Options:
 *   --version VERSION    Valkey version (default: 9.0.1)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./dist)
 *   --all-platforms      Build for all platforms (skips build-required unless --build-fallback)
 *   --build-fallback     Build from source for platforms without binaries (linux only)
 *   --help               Show help
 */

import {
  mkdirSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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

// Validate version format to prevent command injection (e.g., "9.0.1")
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type BuildRequiredSource = {
  sourceType: 'build-required'
}

type SourceEntry = BuildRequiredSource

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

/**
 * Build Valkey from source using Docker
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
    if (platform.startsWith('darwin')) {
      logError(`Darwin platforms need to be built on macOS directly`)
    } else if (platform === 'win32-x64') {
      logError(`Windows platform needs to be built on Windows directly`)
    }
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

  if (result.error) {
    logError(`Failed to spawn build process: ${result.error.message}`)
    return false
  }

  if (result.status === null) {
    logError(`Build process terminated by signal: ${result.signal}`)
    return false
  }

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
  let version = '9.0.1'
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
          logError('Version must be in format: X.Y.Z (e.g., 9.0.1)')
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
Usage: ./builds/valkey/download.ts [options]

Options:
  --version VERSION    Valkey version (default: 9.0.1)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./dist)
  --all-platforms      Build for all platforms (skips build-required unless --build-fallback)
  --build-fallback     Build from source for platforms without binaries (linux only)
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

NOTE: Valkey requires building from source for ALL platforms (no pre-built binaries).

Sources:
  - Build-required: All platforms
  - Source build (Docker): linux-x64, linux-arm64 (with --build-fallback)
  - Native builds: darwin-x64, darwin-arm64 (macOS), win32-x64 (Windows)

Examples:
  ./builds/valkey/download.ts --version 9.0.1 --platform linux-x64 --build-fallback
  ./builds/valkey/download.ts --all-platforms --build-fallback
`)
        process.exit(0)
        break
      default:
        if (args[i].startsWith('-')) {
          logWarn(`Unknown option: ${args[i]} (use --help to see available options)`)
        }
    }
  }

  if (allPlatforms) {
    platforms = [...VALID_PLATFORMS]
  } else if (platforms.length === 0) {
    platforms = [detectPlatform()]
  }

  return { version, platforms, outputDir, buildFallback }
}

function main() {
  const { version, platforms, outputDir, buildFallback } = parseArgs()
  const sources = loadSources()

  console.log()
  logInfo(`Valkey Download Script`)
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

  // Create output directory
  mkdirSync(outputDir, { recursive: true })

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

    // All Valkey platforms are build-required
    if (buildFallback) {
      // Try to build from source
      const canBuild = platform === 'linux-x64' || platform === 'linux-arm64'
      if (canBuild) {
        logInfo(`Building ${platform} from source...`)
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
          `${platform} requires building from source but source builds only support Linux via this script`,
        )
        if (platform.startsWith('darwin')) {
          logWarn('Darwin platforms need to be built on macOS directly via GitHub Actions')
        } else if (platform === 'win32-x64') {
          logWarn('Windows needs to be built on Windows directly via GitHub Actions')
        }
        skippedCount++
        continue
      }
    } else {
      logWarn(
        `${platform} requires building from source (no binary available)`,
      )
      logInfo(
        'Use --build-fallback to build from source (Linux only), or use GitHub Actions for all platforms',
      )
      skippedCount++
      continue
    }
  }

  console.log()
  logSuccess('Done!')
  if (builtCount > 0) {
    logInfo(`Built from source: ${builtCount} platform(s)`)
  }
  if (skippedCount > 0) {
    logInfo(`Skipped: ${skippedCount} platform(s)`)
  }
  logInfo(`Output files in: ${resolve(outputDir)}`)
}

try {
  main()
} catch (error) {
  logError(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
