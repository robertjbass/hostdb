#!/usr/bin/env tsx
/**
 * Scaffolding script for adding a new database engine to hostdb
 *
 * Usage:
 *   pnpm add:engine <database-key>
 *   pnpm add:engine redis
 *   pnpm add:engine sqlite
 *
 * This script:
 *   1. Validates the database exists in databases.json
 *   2. Creates builds/<id>/ directory with template files
 *   3. Creates .github/workflows/release-<id>.yml
 *   4. Adds download:<id> script to package.json
 *   5. Prints next steps for Claude Code
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

function log(message: string) {
  console.log(message)
}

function logSuccess(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function logError(message: string) {
  console.error(`${colors.red}✗${colors.reset} ${message}`)
}

function logWarning(message: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

type DatabaseConfig = {
  displayName: string
  description: string
  type: string
  license: string
  status: string
  latestLts: string
  versions: Record<string, boolean>
  platforms: Record<string, boolean>
}

type DatabasesJson = {
  databases: Record<string, DatabaseConfig>
}

function loadDatabases(): DatabasesJson {
  const path = join(ROOT, 'databases.json')
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content) as DatabasesJson
}

function loadPackageJson(): Record<string, unknown> {
  const path = join(ROOT, 'package.json')
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content) as Record<string, unknown>
}

function savePackageJson(pkg: Record<string, unknown>) {
  const path = join(ROOT, 'package.json')
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n')
}

function generateSourcesJson(dbKey: string, db: DatabaseConfig): string {
  const versions: Record<string, Record<string, { sourceType: string }>> = {}

  // Get enabled versions
  const enabledVersions = Object.entries(db.versions)
    .filter(([, enabled]) => enabled)
    .map(([version]) => version)

  // Get enabled platforms
  const enabledPlatforms = Object.entries(db.platforms)
    .filter(([, enabled]) => enabled)
    .map(([platform]) => platform)

  for (const version of enabledVersions) {
    versions[version] = {}
    for (const platform of enabledPlatforms) {
      versions[version][platform] = {
        sourceType: 'build-required',
      }
    }
  }

  const sources = {
    $schema: '../../schemas/sources.schema.json',
    database: dbKey,
    versions,
    notes: {
      'build-required':
        'TODO: Replace with actual URLs or keep as build-required if source build needed',
    },
  }

  return JSON.stringify(sources, null, 2)
}

function generateDownloadTs(dbKey: string, db: DatabaseConfig): string {
  return `#!/usr/bin/env tsx
/**
 * Download script for ${db.displayName}
 *
 * Usage:
 *   pnpm download:${dbKey}
 *   pnpm download:${dbKey} -- --version ${Object.keys(db.versions).find((v) => db.versions[v]) || '1.0.0'}
 *   pnpm download:${dbKey} -- --all-platforms
 *
 * TODO: Implement download logic for ${db.displayName}
 */

import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

// TODO: createWriteStream, basename, and execSync are scaffolded for download implementation.
// Remove unused imports once download logic is complete.

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '../..')

// TODO: Import and use sources.json for URL mappings
// import sources from './sources.json' assert { type: 'json' }

type Platform = 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64' | 'win32-x64'

const PLATFORMS: Platform[] = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
]

function getCurrentPlatform(): Platform {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform = process.platform

  if (platform === 'darwin') return \`darwin-\${arch}\` as Platform
  if (platform === 'win32') return 'win32-x64'
  return \`linux-\${arch}\` as Platform
}

function parseArgs() {
  const args = process.argv.slice(2)
  let version = '${Object.keys(db.versions).find((v) => db.versions[v]) || '1.0.0'}'
  let platform: Platform | null = null
  let allPlatforms = false
  let outputDir = './dist'

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--version':
        version = args[++i]
        break
      case '--platform':
        platform = args[++i] as Platform
        break
      case '--all-platforms':
        allPlatforms = true
        break
      case '--output':
        outputDir = args[++i]
        break
      case '--help':
        console.log(\`
Usage: pnpm download:${dbKey} [options]

Options:
  --version <version>   Version to download (default: ${Object.keys(db.versions).find((v) => db.versions[v]) || '1.0.0'})
  --platform <platform> Target platform (default: current)
  --all-platforms       Download for all platforms
  --output <dir>        Output directory (default: ./dist)
  --help                Show this help
\`)
        process.exit(0)
    }
  }

  return { version, platform, allPlatforms, outputDir }
}

async function downloadForPlatform(
  version: string,
  platform: Platform,
  outputDir: string,
): Promise<boolean> {
  console.log(\`Downloading ${db.displayName} \${version} for \${platform}...\`)

  // TODO: Implement actual download logic
  // 1. Look up URL in sources.json
  // 2. Download the archive
  // 3. Extract and repackage with metadata
  // 4. Create tarball in outputDir

  console.log('TODO: Implement download logic')
  return false
}

async function main() {
  const { version, platform, allPlatforms, outputDir } = parseArgs()

  console.log(\`${db.displayName} Download Script\`)
  console.log('='.repeat(40))

  const platforms = allPlatforms
    ? PLATFORMS
    : [platform || getCurrentPlatform()]

  let successCount = 0
  for (const p of platforms) {
    const success = await downloadForPlatform(version, p, outputDir)
    if (success) successCount++
  }

  console.log(\`\\nCompleted: \${successCount}/\${platforms.length} platforms\`)
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
`
}

function getEnabledVersionsSorted(db: DatabaseConfig): string[] {
  return Object.entries(db.versions)
    .filter(([, enabled]) => enabled)
    .map(([version]) => version)
    .sort((a, b) => {
      // Sort by semantic version, newest first
      const aParts = a.split('.').map((p) => parseInt(p.replace(/\D/g, ''), 10) || 0)
      const bParts = b.split('.').map((p) => parseInt(p.replace(/\D/g, ''), 10) || 0)
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0
        const bVal = bParts[i] || 0
        if (bVal !== aVal) return bVal - aVal
      }
      return 0
    })
}

function generateReadme(dbKey: string, db: DatabaseConfig): string {
  const enabledVersions = getEnabledVersionsSorted(db)

  const enabledPlatforms = Object.entries(db.platforms)
    .filter(([, enabled]) => enabled)
    .map(([platform]) => platform)

  return `# ${db.displayName} Builds

Download and repackage ${db.displayName} binaries for distribution via GitHub Releases.

## Status

**TODO**: This is a scaffolded template. Implementation needed.

## Supported Versions

${enabledVersions.map((v) => `- ${v}`).join('\n')}

## Supported Platforms

${enabledPlatforms.map((p) => `- \`${p}\``).join('\n')}

## Binary Sources

TODO: Document where binaries come from:

| Source | Platforms | Versions | Format |
|--------|-----------|----------|--------|
| Official | ? | ? | ? |
| Third-party | ? | ? | ? |
| Source Build | ? | ? | ? |

## Usage

\`\`\`bash
# Download for current platform
pnpm download:${dbKey}

# Download specific version
pnpm download:${dbKey} -- --version ${enabledVersions[0] || '1.0.0'}

# Download for all platforms
pnpm download:${dbKey} -- --all-platforms
\`\`\`

## Implementation Checklist

- [ ] Research binary sources (official CDN, third-party repos)
- [ ] Update sources.json with URLs for each version/platform
- [ ] Implement download.ts for the specific archive formats
- [ ] Test local downloads work
- [ ] Create Dockerfile if source builds needed
- [ ] Create build-local.sh if source builds needed
- [ ] Run workflow to create first release
- [ ] Verify releases.json is updated

## Related Links

- [${db.displayName} Official Site](TODO)
- [${db.displayName} Downloads](TODO)
- [Source Repository](${(db as unknown as { sourceRepo?: string }).sourceRepo || 'TODO'})
`
}

function generateWorkflow(dbKey: string, db: DatabaseConfig): string {
  const versions = getEnabledVersionsSorted(db)
  const versionOptions = versions.map((v) => `          - ${v}`).join('\n')
  const defaultVersion = versions[0] || '1.0.0'

  return `name: Release ${db.displayName}

on:
  workflow_dispatch:
    inputs:
      version:
        description: '${db.displayName} version'
        required: true
        type: choice
        options:
${versionOptions}
        default: ${defaultVersion}
      platforms:
        description: 'Platforms'
        required: true
        default: 'all'
        type: choice
        options:
          - 'all'
          - 'linux-x64'
          - 'linux-arm64'
          - 'darwin-x64'
          - 'darwin-arm64'
          - 'win32-x64'

# Prevent concurrent runs that could conflict when updating releases.json
concurrency:
  group: release-${dbKey}
  cancel-in-progress: false

jobs:
  validate:
    runs-on: ubuntu-latest
    env:
      VERSION: \${{ github.event.inputs.version }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Validate version against databases.json
        run: |
          DB="${dbKey}"

          echo "Validating ${db.displayName} version: $VERSION"

          # Check if version exists and is enabled in databases.json
          ENABLED=$(jq -r ".databases.$DB.versions[\\"$VERSION\\"] // false" databases.json)
          if [ "$ENABLED" != "true" ]; then
            echo "::error::Version '$VERSION' is not enabled in databases.json"
            echo ""
            echo "Available versions:"
            jq -r ".databases.$DB.versions | to_entries | map(select(.value == true)) | .[].key" databases.json
            exit 1
          fi

          echo "✓ Version $VERSION is enabled in databases.json"

      - name: Validate sources.json exists
        run: |
          DB="${dbKey}"
          if [ ! -f "builds/$DB/sources.json" ]; then
            echo "::error::Missing builds/$DB/sources.json"
            exit 1
          fi
          echo "✓ builds/$DB/sources.json exists"

      - name: Validate version in sources.json
        run: |
          DB="${dbKey}"

          HAS_VERSION=$(jq -r ".versions[\\"$VERSION\\"] // empty" "builds/$DB/sources.json")
          if [ -z "$HAS_VERSION" ]; then
            echo "::error::Version '$VERSION' not found in builds/$DB/sources.json"
            echo ""
            echo "Available versions in sources.json:"
            jq -r ".versions | keys[]" "builds/$DB/sources.json"
            exit 1
          fi

          echo "✓ Version $VERSION found in sources.json"

  build:
    needs: validate
    runs-on: ubuntu-latest
    env:
      VERSION: \${{ github.event.inputs.version }}
      PLATFORMS: \${{ github.event.inputs.platforms }}
    outputs:
      artifact_names: \${{ steps.build.outputs.artifact_names }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Download and repackage ${db.displayName}
        id: build
        run: |
          if [ "$PLATFORMS" = "all" ]; then
            pnpm download:${dbKey} -- --version "$VERSION" --all-platforms --output ./dist
          else
            for platform in $(echo "$PLATFORMS" | tr ',' ' '); do
              pnpm download:${dbKey} -- --version "$VERSION" --platform "$platform" --output ./dist
            done
          fi

          # List created artifacts
          ls -la ./dist/

          # Create artifact names output
          shopt -s nullglob
          FILES=(./dist/*.tar.gz ./dist/*.zip)
          if [ \${#FILES[@]} -eq 0 ]; then
            echo "ERROR: No artifacts were created"
            exit 1
          fi
          ARTIFACTS=$(printf '%s\\n' "\${FILES[@]}" | xargs -n1 basename | tr '\\n' ',' | sed 's/,$//')
          echo "artifact_names=$ARTIFACTS" >> $GITHUB_OUTPUT

      - name: Generate checksums
        run: |
          cd dist
          sha256sum *.tar.gz *.zip 2>/dev/null > checksums.txt || sha256sum *.tar.gz > checksums.txt
          cat checksums.txt

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${dbKey}-\${{ github.event.inputs.version }}
          path: |
            dist/*.tar.gz
            dist/*.zip
            dist/checksums.txt
          retention-days: 1

  release:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${dbKey}-\${{ github.event.inputs.version }}
          path: ./release-assets

      - name: List release assets
        run: ls -la ./release-assets/

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${dbKey}-\${{ github.event.inputs.version }}
          name: ${db.displayName} \${{ github.event.inputs.version }}
          body: |
            ## ${db.displayName} \${{ github.event.inputs.version }}

            ${db.displayName} binaries repackaged for hostdb.

            ### Platforms
            - \`linux-x64\` - Linux x86_64
            - \`linux-arm64\` - Linux ARM64
            - \`darwin-x64\` - macOS x86_64
            - \`darwin-arm64\` - macOS Apple Silicon
            - \`win32-x64\` - Windows x64

            ### Usage
            \`\`\`bash
            # Download URL pattern
            https://github.com/\${{ github.repository }}/releases/download/${dbKey}-\${{ github.event.inputs.version }}/${dbKey}-\${{ github.event.inputs.version }}-<platform>.tar.gz
            \`\`\`

            ### Checksums
            See \`checksums.txt\` for SHA256 checksums.
          files: |
            release-assets/*.tar.gz
            release-assets/*.zip
            release-assets/checksums.txt
          fail_on_unmatched_files: false

  update-manifest:
    needs: release
    runs-on: ubuntu-latest
    env:
      VERSION: \${{ github.event.inputs.version }}
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: main

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Update releases.json
        run: |
          pnpm tsx scripts/update-releases.ts \\
            --database ${dbKey} \\
            --version "$VERSION" \\
            --tag "${dbKey}-$VERSION"

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add releases.json
          git diff --staged --quiet && echo "No changes to commit" && exit 0

          git commit -m "chore: update releases.json for ${dbKey}-$VERSION"

          # Retry push with rebase if remote has changed
          for i in 1 2 3; do
            if git push; then
              echo "Push succeeded"
              exit 0
            fi
            echo "Push failed, attempting rebase (attempt $i/3)..."
            git fetch origin main
            if ! git rebase origin/main; then
              echo "ERROR: Rebase failed due to conflicts. Manual intervention required."
              git rebase --abort
              exit 1
            fi
            sleep $((2**i))
          done
          echo "ERROR: Push failed after 3 attempts"
          exit 1
`
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    log(`
${colors.cyan}add-engine${colors.reset} - Scaffold a new database engine for hostdb

${colors.yellow}Usage:${colors.reset}
  pnpm add:engine <database-key>

${colors.yellow}Examples:${colors.reset}
  pnpm add:engine redis
  pnpm add:engine sqlite
  pnpm add:engine valkey

${colors.yellow}What it does:${colors.reset}
  1. Validates database exists in databases.json
  2. Creates builds/<id>/ directory with template files
  3. Creates .github/workflows/release-<id>.yml
  4. Adds download:<id> script to package.json
  5. Prints next steps for implementation

${colors.yellow}Available databases:${colors.reset}
`)
    const databases = loadDatabases()
    const sortedDbs = Object.entries(databases.databases)
      .filter(([, db]) => db.status === 'in-progress' || db.status === 'pending')
      .sort(([, a], [, b]) => {
        if (a.status === 'in-progress' && b.status !== 'in-progress') return -1
        if (b.status === 'in-progress' && a.status !== 'in-progress') return 1
        return 0
      })

    for (const [key, db] of sortedDbs) {
      const statusColor = db.status === 'in-progress' ? colors.green : colors.dim
      const hasBuilds = existsSync(join(ROOT, 'builds', key))
      const marker = hasBuilds ? `${colors.dim}(exists)${colors.reset}` : ''
      log(`  ${statusColor}${key}${colors.reset} - ${db.displayName} ${marker}`)
    }
    log('')
    process.exit(0)
  }

  const dbKey = args[0].toLowerCase()

  // Load databases.json
  const databases = loadDatabases()

  // Validate database exists
  if (!databases.databases[dbKey]) {
    logError(`Database '${dbKey}' not found in databases.json`)
    log('')
    log('Available databases:')
    for (const key of Object.keys(databases.databases).sort()) {
      log(`  - ${key}`)
    }
    process.exit(1)
  }

  const db = databases.databases[dbKey]
  log('')
  log(`${colors.cyan}Adding ${db.displayName} (${dbKey})${colors.reset}`)
  log('='.repeat(50))
  log('')

  // Check if builds directory already exists
  const buildsDir = join(ROOT, 'builds', dbKey)
  if (existsSync(buildsDir)) {
    logWarning(`builds/${dbKey}/ already exists`)
  } else {
    mkdirSync(buildsDir, { recursive: true })
    logSuccess(`Created builds/${dbKey}/`)
  }

  // Create sources.json
  const sourcesPath = join(buildsDir, 'sources.json')
  if (existsSync(sourcesPath)) {
    logWarning(`builds/${dbKey}/sources.json already exists (skipping)`)
  } else {
    writeFileSync(sourcesPath, generateSourcesJson(dbKey, db))
    logSuccess(`Created builds/${dbKey}/sources.json`)
  }

  // Create download.ts
  const downloadPath = join(buildsDir, 'download.ts')
  if (existsSync(downloadPath)) {
    logWarning(`builds/${dbKey}/download.ts already exists (skipping)`)
  } else {
    writeFileSync(downloadPath, generateDownloadTs(dbKey, db))
    logSuccess(`Created builds/${dbKey}/download.ts`)
  }

  // Create README.md
  const readmePath = join(buildsDir, 'README.md')
  if (existsSync(readmePath)) {
    logWarning(`builds/${dbKey}/README.md already exists (skipping)`)
  } else {
    writeFileSync(readmePath, generateReadme(dbKey, db))
    logSuccess(`Created builds/${dbKey}/README.md`)
  }

  // Create workflow
  const workflowDir = join(ROOT, '.github', 'workflows')
  const workflowPath = join(workflowDir, `release-${dbKey}.yml`)
  if (existsSync(workflowPath)) {
    logWarning(`.github/workflows/release-${dbKey}.yml already exists (skipping)`)
  } else {
    mkdirSync(workflowDir, { recursive: true })
    writeFileSync(workflowPath, generateWorkflow(dbKey, db))
    logSuccess(`Created .github/workflows/release-${dbKey}.yml`)
  }

  // Update package.json
  const pkg = loadPackageJson()
  const scripts = (pkg.scripts || {}) as Record<string, string>
  const scriptName = `download:${dbKey}`
  if (scripts[scriptName]) {
    logWarning(`package.json already has ${scriptName} script (skipping)`)
  } else {
    scripts[scriptName] = `tsx builds/${dbKey}/download.ts`
    // Sort scripts alphabetically
    pkg.scripts = Object.fromEntries(
      Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b)),
    )
    savePackageJson(pkg)
    logSuccess(`Added ${scriptName} to package.json`)
  }

  // Print next steps
  log('')
  log('='.repeat(50))
  log(`${colors.cyan}Next Steps for Claude Code:${colors.reset}`)
  log('')
  log(`${colors.yellow}1. Research binary sources for ${db.displayName}:${colors.reset}`)
  log(`   - Official download page/CDN`)
  log(`   - Third-party builds (like zonky.io for PostgreSQL)`)
  log(`   - Whether source builds are needed for any platforms`)
  log('')
  log(`${colors.yellow}2. Update builds/${dbKey}/sources.json:${colors.reset}`)
  log(`   - Add URLs for each version/platform combination`)
  log(`   - Set sourceType: "official", "third-party", or "build-required"`)
  log('')
  log(`${colors.yellow}3. Implement builds/${dbKey}/download.ts:${colors.reset}`)
  log(`   - Handle specific archive formats (tar.gz, zip, etc.)`)
  log(`   - Extract and repackage with .hostdb-metadata.json`)
  log(`   - Reference builds/mysql/download.ts or builds/postgresql/download.ts`)
  log('')
  log(`${colors.yellow}4. If source builds needed:${colors.reset}`)
  log(`   - Create builds/${dbKey}/Dockerfile`)
  log(`   - Create builds/${dbKey}/build-local.sh`)
  log(`   - Update workflow for matrix builds if needed`)
  log('')
  log(`${colors.yellow}5. Test locally:${colors.reset}`)
  log(`   pnpm download:${dbKey} -- --version <version>`)
  log('')
  log(`${colors.yellow}6. Update databases.json status:${colors.reset}`)
  log(`   Set status to "completed" after first successful release`)
  log('')
  log('='.repeat(50))
  log('')
}

main()
