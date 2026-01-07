# hostdb

Pre-built database binaries for all major platforms, distributed via GitHub Releases.

**Primary consumer:** [spindb](https://github.com/robertjbass/spindb) - a CLI tool for spinning up local database instances

## Philosophy

This repository exists to solve one problem: **database binaries should be available for download on every major platform, for every supported version, without relying on third-party sources that may disappear.**

### Binary Sourcing Priority

When adding a database, source binaries in this order:

1. **Official binaries** - Direct from vendor CDNs (Oracle for MySQL, MariaDB Foundation, etc.)
2. **Third-party repositories** - Trusted sources like [zonky.io](https://github.com/zonkyio/embedded-postgres-binaries) for PostgreSQL or [MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) Maven JARs
3. **Build from source** - Docker builds for Linux, native GitHub Actions builds for macOS/Windows

### Key Principles

- **Full platform coverage**: Every version must have binaries for all 5 platforms
- **Build once, host forever**: Binaries are uploaded to GitHub Releases and never rebuilt
- **Queryable manifest**: `releases.json` lets CLI tools discover available downloads
- **Single source of truth**: `databases.json` controls which databases/versions/platforms are supported

## Supported Platforms

- `linux-x64` - Linux x86_64 (glibc 2.28+)
- `linux-arm64` - Linux ARM64 (glibc 2.28+)
- `darwin-x64` - macOS Intel
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

## How It Works

1. **databases.json** defines which databases, versions, and platforms are supported
2. **Build scripts** download official binaries or build from source
3. **GitHub Actions** run builds in parallel and upload to GitHub Releases
4. **releases.json** is auto-updated with download URLs for each release
5. **SpinDB** (or any consumer) queries releases.json to find and download binaries

## Project Structure

```
hostdb/
├── databases.json          # Source of truth for all databases
├── releases.json           # Queryable manifest of GitHub Releases (auto-updated)
├── downloads.json          # CLI tools, prerequisites, fallback downloads
├── schemas/
│   ├── databases.schema.json
│   ├── sources.schema.json
│   └── releases.schema.json
├── builds/                 # Per-database build configurations
│   ├── mysql/
│   │   ├── download.ts     # Downloads/repackages binaries
│   │   ├── sources.json    # Version → URL mappings
│   │   ├── Dockerfile      # Source build for Linux
│   │   ├── build-local.sh  # Local Docker build script
│   │   └── README.md
│   ├── postgresql/
│   ├── mariadb/
│   └── ...
├── scripts/
│   ├── add-engine.ts       # pnpm add:engine - scaffold new database
│   ├── list-databases.ts   # pnpm dbs
│   ├── sync-versions.ts    # pnpm sync:versions - sync workflow dropdowns
│   └── update-releases.ts  # Updates releases.json after GH Release
└── .github/workflows/
    ├── release-mysql.yml
    ├── release-postgresql.yml
    └── ...
```

## Configuration Files

**IMPORTANT:** All configuration files have JSON schemas. If you modify the structure of these files (add/remove/rename keys), you must also update the corresponding schema.

| Config File | Schema File | Description |
|-------------|-------------|-------------|
| `databases.json` | `schemas/databases.schema.json` | **Single source of truth** - drives all automation |
| `builds/*/sources.json` | `schemas/sources.schema.json` | Binary download URLs per version/platform |
| `releases.json` | `schemas/releases.schema.json` | Manifest of GitHub Releases (queryable) |

### databases.json

The central source of truth that **drives all automation**. GitHub Actions workflows validate against this file before building. The key for each database (e.g., `mysql`, `postgresql`, `mariadb`) is the normalized ID used for:
- Workflow files: `.github/workflows/release-{id}.yml`
- Build directories: `builds/{id}/`
- Release tags: `{id}-{version}`

Each database entry includes:

```json
{
  "displayName": "MySQL",
  "description": "...",
  "type": "Relational",
  "license": "GPL-2.0",
  "commercialUse": true,
  "status": "in-progress",
  "latestLts": "8.4",
  "versions": { "8.4.7": true, "8.0.40": true },
  "platforms": { "linux-x64": true, "darwin-arm64": true, ... }
}
```

**Status values:**
- `completed` - Fully built and released
- `in-progress` - Currently being implemented
- `pending` - Planned, not yet started
- `unsupported` - Not planned (licensing, niche, etc.)

### sources.json (per database)

Maps versions and platforms to download URLs:

```json
{
  "database": "mysql",
  "versions": {
    "8.4.7": {
      "linux-x64": {
        "url": "https://dev.mysql.com/get/Downloads/...",
        "format": "tar.gz",
        "sourceType": "official"
      },
      "linux-arm64": {
        "sourceType": "build-required"
      }
    }
  }
}
```

**Source types:**
- `official` - Direct from vendor CDN
- `mariadb4j`, `zonky` - Third-party repositories
- `build-required` - Must build from source

## GitHub Actions Workflows

Each database has a release workflow that **validates against databases.json**:

1. Triggered via `workflow_dispatch` (manual)
2. **Dropdown selects version** - options synced from databases.json via `pnpm sync:versions`
3. **Validate job** checks version is enabled in `databases.json` and exists in `sources.json`
4. Matrix builds all platforms in parallel
5. Downloads official binaries OR builds from source
6. Creates GitHub Release with artifacts
7. `update-manifest` job updates `releases.json`

**Validation flow:**
```
User selects version "8.4.7" from dropdown
        ↓
Check databases.json: versions["8.4.7"] == true?
        ↓
Check sources.json: versions["8.4.7"] exists?
        ↓
Proceed with build (or fail with helpful error)
```

**Build methods by platform:**
| Platform | Method |
|----------|--------|
| linux-x64 | Download or Docker build |
| linux-arm64 | Docker build (QEMU emulation) |
| darwin-x64 | Native build on macos-15-intel runner |
| darwin-arm64 | Native build on macos-14 runner |
| win32-x64 | Download official binary |

### macOS Native Build Considerations

Native macOS builds (darwin-x64, darwin-arm64) require careful SDK configuration to avoid conflicts between Xcode and Command Line Tools:

**The Problem:** CMake can find libraries from Command Line Tools (`/Library/Developer/CommandLineTools/SDKs/`) while using Xcode's SDK for compilation. This causes C++ header search path errors like:
```
error: <cstddef> tried including <stddef.h> but didn't find libc++'s <stddef.h> header.
```

**The Solution:** Force all tools to use a single SDK by:
1. Setting `xcode-select` to the Xcode app (not Command Line Tools)
2. Exporting `SDKROOT`, `CC`, `CXX`, `CFLAGS`, `CXXFLAGS`, `LDFLAGS` with `--sysroot`
3. Using `CMAKE_FIND_ROOT_PATH` to restrict library search to Xcode SDK + Homebrew only
4. Running cmake via `xcrun` to inherit the correct environment

See `release-mariadb.yml` for a working example of this configuration.

## Adding a New Database

Use the scaffolding script to create the basic structure:

```bash
pnpm add:engine redis
pnpm add:engine sqlite
```

This creates:
- `builds/<id>/` directory with template files
- `.github/workflows/release-<id>.yml` with validation
- `download:<id>` script in package.json

Then follow the printed instructions to implement the download logic.

See [CHECKLIST.md](./CHECKLIST.md) for the complete checklist.

## Adding New Versions

When adding a new version to an existing database:

1. Update `databases.json` - add version with `true`
2. Update `builds/<database>/sources.json` - add URLs for all platforms
3. Run `pnpm prep` - syncs workflows and populates checksums

**That's it.** The prep script handles syncing workflow dropdowns and populating SHA256 checksums automatically.

```bash
# Sync all workflows
pnpm sync:versions

# Sync specific database
pnpm sync:versions mysql

# Check if sync needed (for CI)
pnpm sync:versions --check
```

## Development Commands

```bash
# Pre-commit preparation (run before committing)
pnpm prep              # Type-check, lint, sync versions, populate checksums
pnpm prep --fix        # Same as above + auto-fix lint/format issues
pnpm prep --check      # Check only, don't modify files (for CI)

# List databases
pnpm dbs              # Show in-progress
pnpm dbs --all        # Show all
pnpm dbs --pending    # Show pending only

# Download binaries locally
pnpm download:mysql -- --version 8.4.7
pnpm download:mysql -- --version 8.4.7 --all-platforms
pnpm download:mariadb -- --version 11.8.5 --build-fallback

# Local Docker builds
./builds/mariadb/build-local.sh --version 11.8.5 --platform linux-arm64

# Scaffolding and maintenance
pnpm add:engine redis              # Scaffold new database
pnpm sync:versions                 # Sync workflow dropdowns with databases.json
pnpm checksums:populate <database> # Populate missing SHA256 checksums
```

## Querying Available Binaries

```bash
# Raw URL for releases.json
https://raw.githubusercontent.com/robertjbass/hostdb/main/releases.json
```

**Download URL pattern:**
```
https://github.com/robertjbass/hostdb/releases/download/{tag}/{filename}
```

**releases.json structure:**
```json
{
  "repository": "robertjbass/hostdb",
  "lastUpdated": "2024-01-15T10:30:00Z",
  "databases": {
    "mysql": {
      "8.4.3": {
        "releaseTag": "mysql-8.4.3",
        "platforms": {
          "darwin-arm64": {
            "url": "https://github.com/.../mysql-8.4.3-darwin-arm64.tar.gz",
            "sha256": "abc123...",
            "size": 165000000
          }
        }
      }
    }
  }
}
```

## Package Configuration

The root `package.json` has `"private": true` because:
- The root package is not published to npm
- Only the future `cli/` package will be published as `@hostdb/cli` or `hostdb`

## GitHub Constraints (Public Repo)

| Resource | Limit |
|----------|-------|
| Actions minutes | Unlimited (public repo) |
| Job timeout | 6 hours per job |
| Release file size | 2 GB per file |
| Total release storage | No limit |

**Build times vary significantly:**
- Downloads: 2-5 minutes
- Docker builds (QEMU): 45-90+ minutes
- Native macOS builds: 30-60 minutes
