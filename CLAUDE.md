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
│   ├── list-databases.ts   # pnpm dbs
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
| `databases.json` | `schemas/databases.schema.json` | All databases, versions, platforms, status |
| `builds/*/sources.json` | `schemas/sources.schema.json` | Binary download URLs per version/platform |
| `releases.json` | `schemas/releases.schema.json` | Manifest of GitHub Releases (queryable) |

### databases.json

The central source of truth. Each database entry includes:

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

Each database has a release workflow:

1. Triggered via `workflow_dispatch` (manual)
2. Matrix builds all platforms in parallel
3. Downloads official binaries OR builds from source
4. Creates GitHub Release with artifacts
5. `update-manifest` job updates `releases.json`

**Build methods by platform:**
| Platform | Method |
|----------|--------|
| linux-x64 | Download or Docker build |
| linux-arm64 | Docker build (QEMU emulation) |
| darwin-x64 | Native build on macos-13 runner |
| darwin-arm64 | Native build on macos-14 runner |
| win32-x64 | Download official binary |

## Adding a New Database

See [CHECKLIST.md](./CHECKLIST.md) for the complete checklist.

**Quick summary:**
1. Add entry to `databases.json` with `status: "in-progress"`
2. Create `builds/<database>/` directory with:
   - `sources.json` - URL mappings
   - `download.ts` - Download script
   - `Dockerfile` - Source build (if needed)
   - `README.md` - Documentation
3. Create `.github/workflows/release-<database>.yml`
4. Add `download:<database>` script to `package.json`
5. Test locally, then run workflow to create releases
6. Verify `releases.json` is updated

## Adding New Versions

When adding a new version to an existing database:

1. Update `builds/<database>/sources.json` with URLs for all platforms
2. Update `.github/workflows/release-<database>.yml` dropdown options
3. Update `databases.json` versions object

## Development Commands

```bash
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
