# hostdb

Pre-built database binaries for all major platforms, distributed via GitHub Releases.

**Primary consumer:** [SpinDB](https://github.com/robertjbass/spindb) - a CLI tool for spinning up local database instances

## Philosophy

This repository exists to solve one problem: **database binaries should be available for download on every major platform, for every supported version, without relying on third-party sources that may disappear.**

### Binary Sourcing Priority

When adding a database, we source binaries in this order:

1. **Official binaries** - Direct from vendor CDNs (Oracle for MySQL, MariaDB Foundation, EnterpriseDB for PostgreSQL Windows, etc.)
2. **Third-party repositories** - Trusted sources like [MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) Maven JARs
3. **Build from source** - Docker builds for Linux, native GitHub Actions builds for macOS

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
| `databases.json` | **Single source of truth** for all databases, versions, and platforms |
| `releases.json` | Queryable manifest of all GitHub Releases (auto-updated) |
| `builds/*/sources.json` | URL mappings for each database's binaries |

### databases.json

The central configuration that **drives all automation**. GitHub Actions workflows validate against this file before building.

```json
{
  "mysql": {
    "displayName": "MySQL",
    "status": "in-progress",
    "versions": { "8.4.7": true, "8.0.40": true },
    "platforms": { "linux-x64": true, "darwin-arm64": true, ... }
  }
}
```

**To enable a new version:**
1. Add it to `databases.json` with `true`
2. Add URLs to `builds/<database>/sources.json`
3. Run the workflow - it validates against databases.json automatically

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

| Database | Type | Status | Versions | Notes |
|----------|------|--------|----------|-------|
| MySQL | Relational | Completed | 9.5.0, 9.1.0, 8.4.3, 8.0.40 | Official binaries |
| PostgreSQL | Relational | In Progress | 18.1.0, 17.7.0, 16.11.0, 15.15.0 | Source builds + EDB (Windows) |
| MariaDB | Relational | Completed | 11.8.5, 11.4.5, 10.11.15 | Official + source builds |
| SQLite | Embedded | In Progress | 3.51.2 | Official amalgamation |
| MongoDB | Document | Completed | 8.2.3, 8.0.17, 7.0.28 | Official binaries (SSPL license) |
| Redis | Key-Value | Completed | 8.4.0, 7.4.7 | Source builds |
| Valkey | Key-Value | In Progress | 9.0.1, 8.0.6 | Redis-compatible, BSD-3 license |
| DuckDB | Analytical | Completed | 1.4.3 | Official binaries |
| ClickHouse | Analytical | Completed | 25.12.3.21 | Official binaries (no Windows) |
| Qdrant | Vector | Completed | 1.16.3 | Official binaries |
| Meilisearch | Search | In Progress | 1.33.1 | Official binaries |

See `pnpm dbs` for the full list.

### Licensing Notes

Some databases have restrictive licenses that limit commercial and closed-source use:

| Database | License | Commercial Use | Open-Source Alternative |
|----------|---------|----------------|------------------------|
| MongoDB | SSPL | ❌ Restricted | [FerretDB](https://www.ferretdb.com/) (Apache 2.0) |
| Redis | RSALv2 + SSPLv1 | ❌ Restricted | [Valkey](https://valkey.io/) (BSD-3-Clause) |

**FerretDB** is a MongoDB-compatible database built on PostgreSQL. **Valkey** is a Redis fork maintained by the Linux Foundation after Redis changed to a non-open-source license.

If you need MongoDB or Redis compatibility for commercial/closed-source projects, use FerretDB or Valkey instead.

### Database Dependencies

Some databases depend on other database engines for client tools or as backends:

| Database | Depends On | Cascade Delete | Notes |
|----------|------------|----------------|-------|
| FerretDB | postgresql-documentdb | Yes | postgresql-documentdb is removed when FerretDB is removed (no standalone use) |
| QuestDB | postgresql | No | PostgreSQL client tools (psql) used for wire protocol; PostgreSQL remains as standalone |

**Cascade Delete** indicates whether removing a database also removes its dependency:
- **Yes**: The dependency exists solely to support this database and is removed together
- **No**: The dependency is a standalone database that remains installed

## GitHub Actions

Each database has a release workflow triggered via `workflow_dispatch`:

1. Go to Actions → "Release [Database]" → Run workflow
2. **Select the version** from dropdown (synced from `databases.json`)
3. Select platforms (default: all)
4. Workflow **validates against databases.json** before building
5. Downloads/builds binaries for all platforms in parallel
6. Creates GitHub Release with artifacts
7. Updates `releases.json` manifest

**Validation:** The workflow validates the selected version exists in `databases.json` and `sources.json` before building.

**Sync dropdowns:** Run `pnpm sync:versions` after adding new versions to databases.json.

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
│   ├── add-engine.ts         # pnpm add:engine - scaffold new database
│   ├── fetch-edb-fileids.ts  # pnpm edb:fileids - fetch PostgreSQL Windows file IDs
│   ├── list-databases.ts     # pnpm dbs
│   ├── sync-versions.ts      # pnpm sync:versions - sync workflow dropdowns
│   └── update-releases.ts    # Updates releases.json after release
└── .github/workflows/
    ├── release-mysql.yml
    ├── release-postgresql.yml
    └── ...
```

## Adding a New Database

Use the scaffolding script:

```bash
pnpm add:engine redis    # Creates builds/redis/, workflow, and package.json script
pnpm add:engine sqlite   # Then follow printed instructions
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Visual representation of how this repo works
- [BINARIES.md](./BINARIES.md) - Archive structure reference for each database
- [CHECKLIST.md](./CHECKLIST.md) - Checklist for adding a new database

## TODO

- [ ] Add Windows filesystem support to download scripts:
  - [ ] Check `process.platform === 'win32'` for platform-specific logic
  - [ ] Use Node's `path` utilities (`path.sep`, `path.join`, `path.normalize`) instead of manual string concatenation
  - [ ] Use `os.tmpdir()` for temp file locations
  - [ ] Use `fs.mkdtemp()` for safe cross-platform temp directory creation
  - [ ] Normalize/escape backslashes when constructing download paths or invoking shell commands

## Inspiration

- [MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) - Embedded MariaDB for Java
- [embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries) - PostgreSQL binaries (we previously used this, now build from source)

## License

[PolyForm Noncommercial 1.0.0](./LICENSE)
