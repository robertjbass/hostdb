#!/usr/bin/env tsx
/**
 * Download PostgreSQL + DocumentDB binaries for re-hosting
 *
 * This script builds PostgreSQL FROM SOURCE on all platforms to ensure a standard
 * directory layout that makes binaries fully relocatable. The old approach of
 * extracting from Docker images (Linux) or using Homebrew (macOS) created binaries
 * with hardcoded paths that broke when moved to a different location.
 *
 * Build approach:
 * - Linux: Build from source inside Docker container (build-linux.sh)
 * - macOS: Build from source using Homebrew for dependencies only (build-macos.sh)
 *
 * Usage:
 *   ./builds/postgresql-documentdb/download.ts [options]
 *   pnpm tsx builds/postgresql-documentdb/download.ts [options]
 *
 * Options:
 *   --version VERSION    Version (e.g., 17-0.107.0)
 *   --platform PLATFORM  Target platform (default: current platform)
 *   --output DIR         Output directory (default: ./downloads)
 *   --all-platforms      Process all platforms
 *   --help               Show help
 */

import {
  createReadStream,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  cpSync,
  readdirSync,
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

// Version format: {pg_major}-{documentdb_version} (e.g., "17-0.107.0")
const VERSION_REGEX = /^\d+-\d+\.\d+\.\d+$/

function isValidVersion(value: string): boolean {
  return VERSION_REGEX.test(value)
}

type DockerExtractSource = {
  sourceType: 'docker-extract'
  image: string
  platform: string
  note?: string
}

type BuildRequiredSource = {
  sourceType: 'build-required'
  note?: string
}

type SourceEntry = DockerExtractSource | BuildRequiredSource

type Sources = {
  database: string
  versions: Record<string, Record<Platform, SourceEntry>>
  components: Record<string, { version: string; sourceRepo?: string }>
  config: Record<string, string>
  notes: Record<string, string>
}

function isDockerExtractSource(
  source: SourceEntry,
): source is DockerExtractSource {
  return source.sourceType === 'docker-extract'
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

/**
 * Extract PostgreSQL + DocumentDB from Docker image
 *
 * Uses tar inside the container to handle symlinks properly,
 * since `docker cp` fails on symlinks pointing outside the copied directory.
 *
 * Also fixes library RPATH to make binaries relocatable using $ORIGIN.
 */
function extractFromDocker(
  source: DockerExtractSource,
  version: string,
  platform: Platform,
  outputDir: string,
): string {
  if (!verifyCommand('docker')) {
    throw new Error('Docker is required for extraction. Install Docker.')
  }

  const pgVersion = version.split('-')[0] // e.g., "17" from "17-0.107.0"
  const containerName = `hostdb-pg-extract-${Date.now()}`
  const extractDir = join(outputDir, 'temp-docker-extract')
  const bundleDir = join(extractDir, 'postgresql-documentdb')
  const tarballName = 'pg-extract.tar.gz'

  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })

  try {
    // Pull the Docker image for the specific platform
    logInfo(`Pulling Docker image: ${source.image} (${source.platform})`)
    execFileSync(
      'docker',
      ['pull', '--platform', source.platform, source.image],
      { stdio: 'inherit' },
    )

    // Run container with a shell command that creates the proper directory structure,
    // fixes RPATH for relocatable binaries, and packages it as a tarball.
    logInfo('Creating container and extracting PostgreSQL files...')

    const pgLibPath = `/usr/lib/postgresql/${pgVersion}`
    const pgSharePath = `/usr/share/postgresql/${pgVersion}`

    // Shell script to:
    // 1. Create temp directory with proper structure
    // 2. Copy lib files (bin/, lib/) to root
    // 3. Copy share files (extension/, etc.) to share/
    // 4. Install patchelf and fix RPATH for relocatable binaries
    // 5. Create tarball
    //
    // Note: We use single quotes around $ORIGIN in patchelf so the shell
    // passes it literally (no variable expansion). In JS template literals,
    // $ only needs escaping when followed by {, so $ORIGIN is fine.
    const extractScript = `
set -e

# Create directory structure
mkdir -p /tmp/pg/share
cp -rL ${pgLibPath}/* /tmp/pg/
cp -rL ${pgSharePath}/* /tmp/pg/share/

# Install patchelf for RPATH fixing (suppress output)
apt-get update -qq && apt-get install -y -qq patchelf > /dev/null 2>&1 || true

# Fix RPATH on binaries to use $ORIGIN/../lib
echo "Fixing RPATH on binaries..."
for f in /tmp/pg/bin/*; do
  if file "$f" | grep -q "ELF"; then
    patchelf --set-rpath '$ORIGIN/../lib' "$f" 2>/dev/null || true
  fi
done

# Fix RPATH on shared libraries to use $ORIGIN
echo "Fixing RPATH on shared libraries..."
find /tmp/pg/lib -name "*.so*" -type f 2>/dev/null | while read f; do
  if file "$f" | grep -q "ELF"; then
    patchelf --set-rpath '$ORIGIN' "$f" 2>/dev/null || true
  fi
done

# Create tarball
tar -czf /output/${tarballName} -C /tmp pg
`

    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--name', containerName,
        '--platform', source.platform,
        '-v', `${resolve(extractDir)}:/output`,
        source.image,
        '/bin/sh', '-c', extractScript,
      ],
      { stdio: 'inherit' },
    )

    // Extract the tarball on the host
    // It contains pg/ with the proper structure: bin/, lib/, share/
    logInfo('Extracting tarball...')
    execFileSync(
      'tar',
      ['-xzf', join(extractDir, tarballName), '-C', extractDir],
      { stdio: 'inherit' },
    )

    // Rename pg/ to postgresql-documentdb/
    const pgDir = join(extractDir, 'pg')
    if (existsSync(pgDir)) {
      cpSync(pgDir, bundleDir, { recursive: true })
      rmSync(pgDir, { recursive: true, force: true })
    }

    // Copy our pre-configured postgresql.conf.sample (overwrite any existing)
    const shareDir = join(bundleDir, 'share')
    mkdirSync(shareDir, { recursive: true })
    const confSamplePath = resolve(__dirname, 'postgresql.conf.sample')
    if (existsSync(confSamplePath)) {
      cpSync(confSamplePath, join(shareDir, 'postgresql.conf.sample'))
      logSuccess('Added pre-configured postgresql.conf.sample')
    }

    // List what we extracted
    logInfo('Extracted files:')
    const binDir = join(bundleDir, 'bin')
    if (existsSync(binDir)) {
      const binFiles = readdirSync(binDir)
      logInfo(`  bin/: ${binFiles.slice(0, 10).join(', ')}${binFiles.length > 10 ? '...' : ''}`)
    }

    const libDir = join(bundleDir, 'lib')
    if (existsSync(libDir)) {
      const libFiles = readdirSync(libDir).filter((f) => f.endsWith('.so'))
      logInfo(`  lib/ (*.so): ${libFiles.slice(0, 10).join(', ')}${libFiles.length > 10 ? '...' : ''}`)
    }

    const extDir = join(shareDir, 'extension')
    if (existsSync(extDir)) {
      const extFiles = readdirSync(extDir).filter((f) =>
        f.endsWith('.control'),
      )
      logInfo(`  share/extension/ (*.control): ${extFiles.join(', ')}`)
    }

    // Add metadata file
    const metadata = {
      name: 'postgresql-documentdb',
      version,
      platform,
      source: 'docker-extract',
      sourceImage: source.image,
      postgresql_version: pgVersion,
      rehosted_by: 'hostdb',
      rehosted_at: new Date().toISOString(),
    }
    writeFileSync(
      join(bundleDir, '.hostdb-metadata.json'),
      JSON.stringify(metadata, null, 2),
    )

    // Clean up intermediate tarball
    rmSync(join(extractDir, tarballName), { force: true })

    // Create output archive
    const ext = 'tar.gz'
    const outputPath = join(outputDir, `postgresql-documentdb-${version}-${platform}.${ext}`)
    mkdirSync(dirname(outputPath), { recursive: true })

    logInfo(`Creating: ${basename(outputPath)}`)
    execFileSync(
      'tar',
      ['-czf', outputPath, '-C', extractDir, 'postgresql-documentdb'],
      { stdio: 'inherit' },
    )

    logSuccess(`Created: ${outputPath}`)
    return outputPath
  } finally {
    // Cleanup container
    try {
      execFileSync('docker', ['rm', '-f', containerName], { stdio: 'pipe' })
    } catch {
      // Ignore cleanup errors
    }

    // Cleanup temp directory
    rmSync(extractDir, { recursive: true, force: true })
  }
}

/**
 * Build PostgreSQL + DocumentDB from source
 *
 * Uses different build scripts depending on platform:
 * - macOS: build-macos.sh (builds locally using Homebrew for dependencies)
 * - Linux: build-linux.sh (builds inside Docker container)
 */
function buildFromSource(
  version: string,
  platform: Platform,
  outputDir: string,
): string {
  // Select the appropriate build script
  let buildScript: string
  if (platform.startsWith('darwin')) {
    buildScript = resolve(__dirname, 'build-macos.sh')
  } else if (platform.startsWith('linux')) {
    buildScript = resolve(__dirname, 'build-linux.sh')
  } else {
    throw new Error(`No build script available for platform: ${platform}`)
  }

  if (!existsSync(buildScript)) {
    throw new Error(`Build script not found: ${buildScript}`)
  }

  // Convert outputDir to absolute path to ensure consistency between
  // the build script (which runs with cwd set to project root) and
  // the existsSync check (which runs in the current process)
  const absoluteOutputDir = resolve(outputDir)

  logInfo(`Building ${platform} from source...`)
  logInfo(`Running: ${buildScript} ${version}`)

  const result = spawnSync('bash', [buildScript, version, platform, absoluteOutputDir], {
    stdio: 'inherit',
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env },
  })

  if (result.status !== 0) {
    throw new Error(`Source build failed with exit code: ${result.status}`)
  }

  const ext = 'tar.gz'
  const outputPath = join(absoluteOutputDir, `postgresql-documentdb-${version}-${platform}.${ext}`)

  if (!existsSync(outputPath)) {
    throw new Error(`Expected output not found: ${outputPath}`)
  }

  logSuccess(`Source build completed for ${platform}`)
  return outputPath
}

function parseArgs(): {
  version: string
  platforms: Platform[]
  outputDir: string
} {
  const args = process.argv.slice(2)
  let version = '17-0.107.0'
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
          logError('Version must be in format: {pg_major}-{documentdb_version} (e.g., 17-0.107.0)')
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
Usage: ./builds/postgresql-documentdb/download.ts [options]

Builds PostgreSQL + DocumentDB from source for hostdb releases.

All platforms now build from source to ensure proper relocatability. The old
approach of extracting from Docker images created binaries with hardcoded paths
that broke when installed to a different location.

Build approach:
  - Linux: Build from source inside Docker container (requires Docker)
  - macOS: Build from source locally (requires Homebrew for dependencies)
  - Windows: Not supported yet

Options:
  --version VERSION    Version (default: 17-0.107.0)
  --platform PLATFORM  Target platform (default: current)
  --output DIR         Output directory (default: ./downloads)
  --all-platforms      Process all platforms
  --help               Show this help

Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64

Version format: {pg_major}-{documentdb_version} (e.g., 17-0.107.0)

Examples:
  ./builds/postgresql-documentdb/download.ts
  ./builds/postgresql-documentdb/download.ts --version 17-0.107.0 --platform linux-x64
  ./builds/postgresql-documentdb/download.ts --all-platforms
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

  const [pgVersion, docdbVersion] = version.split('-')

  console.log()
  logInfo(`PostgreSQL + DocumentDB Download Script`)
  logInfo(`Version: ${version}`)
  logInfo(`  PostgreSQL: ${pgVersion}`)
  logInfo(`  DocumentDB: ${docdbVersion}`)
  logInfo(`Platforms: ${platforms.join(', ')}`)
  logInfo(`Output: ${outputDir}`)
  console.log()

  const versionSources = sources.versions[version]
  if (!versionSources) {
    logError(`Version ${version} not found in sources.json`)
    logInfo(`Available versions: ${Object.keys(sources.versions).join(', ')}`)
    process.exit(1)
  }

  mkdirSync(outputDir, { recursive: true })

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

    try {
      let outputPath: string

      // All platforms now use source builds for proper relocatability
      // - Linux: builds inside Docker container (requires Docker)
      // - macOS: builds locally (requires macOS + Homebrew)
      // - Windows: not yet supported
      if (platform.startsWith('win32')) {
        logWarn(`${platform} is not yet supported`)
        skipCount++
        continue
      }

      if (platform.startsWith('linux')) {
        // Linux builds require Docker
        if (!verifyCommand('docker')) {
          logWarn(`${platform} requires Docker for source build, but Docker is not installed`)
          skipCount++
          continue
        }
        outputPath = buildFromSource(version, platform, outputDir)
      } else if (platform.startsWith('darwin')) {
        // macOS builds require running on macOS
        if (process.platform !== 'darwin') {
          logWarn(`${platform} requires macOS to build, skipping`)
          skipCount++
          continue
        }
        outputPath = buildFromSource(version, platform, outputDir)
      } else {
        logWarn(`Unknown platform: ${platform}`)
        skipCount++
        continue
      }

      const outputSha256 = await calculateSha256(outputPath)
      logInfo(`Output SHA256: ${outputSha256}`)
      successCount++
    } catch (error) {
      logError(`Failed for ${platform}: ${error}`)
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
