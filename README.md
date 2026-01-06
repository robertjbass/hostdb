# hostdb

Pre-built database binaries for all major platforms, distributed via GitHub Releases.

**Primary consumer:** [SpinDB](https://github.com/robertjbass/spindb) - a CLI tool for spinning up local database instances

## Philosophy

This repository exists to solve one problem: **database binaries should be available for download on every major platform, for every supported version, without relying on third-party sources that may disappear.**

### Binary Sourcing Priority

When adding a database, we source binaries in this order:

1. **Official binaries** - Direct from vendor CDNs (Oracle for MySQL, MariaDB Foundation, etc.)
2. **Third-party repositories** - Trusted sources like [zonky.io](https://github.com/zonkyio/embedded-postgres-binaries) for PostgreSQL or [MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) Maven JARs
3. **Build from source** - Docker builds for Linux, native GitHub Actions builds for macOS/Windows

### What This Means

- Every database version we support has binaries for all 5 platforms
- Binaries are built once and hosted forever on GitHub Releases
- `releases.json` provides a queryable manifest of all available downloads
- CLI tools (like SpinDB) query this manifest to find and download binaries

## Supported Platforms

| Platform | Description |
|----------|-------------|
| `linux-x64` | Linux x86_64 (glibc 2.28+) |
| `linux-arm64` | Linux ARM64 (glibc 2.28+) |
| `darwin-x64` | macOS Intel |
| `darwin-arm64` | macOS Apple Silicon |
| `win32-x64` | Windows x64 |

## Quick Start

```bash
# Download MySQL 8.4.3 for current platform
pnpm download:mysql

# Download for all platforms
pnpm download:mysql -- --all-platforms

# Build from source if no binary available
pnpm download:mariadb -- --version 11.8.5 --platform linux-arm64 --build-fallback

# List supported databases
pnpm dbs
```

## Querying Available Binaries

SpinDB (or any consumer) can fetch `releases.json` for available binaries:

```bash
curl https://raw.githubusercontent.com/robertjbass/hostdb/main/releases.json
```

**Download URL pattern:**
```
https://github.com/robertjbass/hostdb/releases/download/{tag}/{filename}

# Example:
https://github.com/robertjbass/hostdb/releases/download/mysql-8.4.3/mysql-8.4.3-darwin-arm64.tar.gz
```

## Configuration Files

| File | Purpose |
|------|---------|
| `databases.json` | Source of truth for all databases, versions, and platforms |
| `releases.json` | Queryable manifest of all GitHub Releases (auto-updated) |
| `builds/*/sources.json` | URL mappings for each database's binaries |

### databases.json

The central configuration that defines:
- Which databases are supported (`status: "in-progress"`, `"pending"`, `"unsupported"`)
- Which versions to build (`versions: { "8.4.3": true, "8.0.40": true }`)
- Which platforms are supported (`platforms: { "linux-x64": true, ... }`)
- Licensing information (`commercialUse: true/false`)

**Status values:**
- `completed` - Fully built and released
- `in-progress` - Currently being implemented
- `pending` - Planned, not yet started
- `unsupported` - Not planned (licensing, niche use case, etc.)

### releases.json

Auto-generated manifest updated after each GitHub Release. Structure:

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

## Current Status

| Database | Status | Versions | Notes |
|----------|--------|----------|-------|
| MySQL | Completed | 8.4.7, 8.0.40 | Official binaries for all platforms |
| PostgreSQL | In Progress | 18.1.0, 17.7.0, 16.11.0, 15.15.0 | Via zonky.io binaries |
| MariaDB | In Progress | 11.8.5, 11.4.5, 10.6.24 | Official + source builds |
| Redis | In Progress | 8.4.0, 8.2.3, 8.0.5, 7.4.7 | Source builds |
| SQLite | In Progress | 3.51.1 | Official amalgamation |

See `pnpm dbs` for the full list.

## GitHub Actions

Each database has a release workflow triggered via `workflow_dispatch`:

1. Go to Actions → "Release [Database]" → Run workflow
2. Select version and platforms
3. Workflow downloads/builds binaries for all platforms in parallel
4. Creates GitHub Release with artifacts
5. Updates `releases.json` manifest

## Project Structure

```
hostdb/
├── databases.json          # Source of truth for all databases
├── releases.json           # Queryable manifest of GitHub Releases
├── schemas/                # JSON schemas for validation
├── builds/
│   ├── mysql/
│   │   ├── download.ts     # Download script
│   │   ├── sources.json    # Version → URL mappings
│   │   ├── Dockerfile      # Source build fallback
│   │   └── README.md
│   ├── postgresql/
│   ├── mariadb/
│   └── ...
├── scripts/
│   ├── list-databases.ts   # pnpm dbs
│   └── update-releases.ts  # Updates releases.json after release
└── .github/workflows/
    ├── release-mysql.yml
    ├── release-postgresql.yml
    └── ...
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Visual representation of how this repo works
- [CHECKLIST.md](./CHECKLIST.md) - Checklist for adding a new database

## Inspiration

- [embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries) - PostgreSQL binaries built from source
- [MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) - Embedded MariaDB for Java

## License

[PolyForm Noncommercial 1.0.0](./LICENSE)
