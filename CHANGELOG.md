# Changelog

All notable changes to this project will be documented in this file.

## [0.14.0] - 2026-01-23

### Added

- **FerretDB support** - Open-source MongoDB alternative using PostgreSQL backend
  - Downloads official binaries for Linux x64/arm64
  - Cross-compiles from source for macOS and Windows (requires Go 1.22+)
  - Bundles mongosh and MongoDB database-tools for complete MongoDB compatibility

- **PostgreSQL + DocumentDB support** - PostgreSQL with DocumentDB extension for FerretDB backend
  - Extracts from official FerretDB Docker image for Linux x64/arm64
  - Builds from source for macOS (Intel and Apple Silicon)
  - Includes bundled extensions: DocumentDB, pg_cron, pgvector, PostGIS, rum
  - Pre-configured postgresql.conf.sample with shared_preload_libraries

- **New `docker-extract` source type** in sources.schema.json for extracting binaries from Docker images

## [0.12.5] - 2026-01-20

### Fixed

- **Invalid code signatures on macOS PostgreSQL binaries**
  - `install_name_tool` invalidates existing code signatures when modifying libraries
  - macOS kills processes that load libraries with invalid signatures ("Killed: 9")
  - Added `codesign --force --sign -` step to re-sign all modified dylibs and binaries with ad-hoc signatures

## [0.12.4] - 2026-01-20

### Fixed

- **Bash 3.2 compatibility for macOS builds**
  - Removed `declare -A` (associative arrays) which requires Bash 4+
  - macOS ships with Bash 3.2; GitHub Actions macOS runners use system bash
  - Replaced with regular arrays and helper function for linear search

## [0.12.3] - 2026-01-20

### Fixed

- **Missing ICU data library in macOS PostgreSQL builds**
  - `libicudata.78.dylib` was not being bundled because ICU uses `@loader_path` references internally
  - Updated dependency scanner to resolve `@loader_path` references relative to the source library's directory
  - Updated path fixer to also rewrite `@loader_path` references to `@rpath`
  - This caused `Killed: 9` errors when running PostgreSQL binaries

## [0.12.2] - 2026-01-20

### Fixed

- **Bash syntax error in macOS PostgreSQL build**
  - Fixed `syntax error near unexpected token '2'` caused by invalid `2>/dev/null` in for loop glob
  - Added `shopt -s nullglob` to handle missing file patterns gracefully

- **GitHub Actions `env` context error in build-missing-releases workflow**
  - Fixed `Unrecognized named-value: 'env'` error in job-level `if` conditions
  - Changed `env.ACTION` to `github.event.inputs.action` (env context not available at job level)

## [0.12.1] - 2026-01-20

### Fixed

- **macOS PostgreSQL binaries now relocatable**
  - Fixed hardcoded build paths (`/Users/runner/work/...`) that caused `dyld: Library not loaded` errors
  - Fixed Homebrew dependency paths (`/opt/homebrew/opt/icu4c@78/...`) that required users to have specific Homebrew packages installed
  - Binaries now bundle all required dylibs (ICU, OpenSSL, readline, etc.) into the package
  - Uses `install_name_tool` to rewrite paths with `@executable_path/../lib/` and `@rpath/`
  - Affects all PostgreSQL binaries: `postgres`, `psql`, `initdb`, `pg_dump`, `pg_restore`, etc.
  - Verification step ensures no hardcoded paths remain before packaging

### Added

- **Rebuild macOS PostgreSQL workflow** (`.github/workflows/rebuild-macos-postgresql.yml`)
  - Rebuilds all macOS PostgreSQL binaries for all supported versions
  - Supports both darwin-x64 (Intel) and darwin-arm64 (Apple Silicon)
  - Can rebuild a single version or all versions at once

## [0.12.0] - 2026-01-20

### Added

- **Qdrant vector database support** with full 5-platform coverage
  - High-performance vector similarity search engine
  - Version: 1.16.3 (latest stable)
  - Official binaries from GitHub releases for all platforms
  - Apache-2.0 license (fully permissive for commercial use)

## [0.11.1] - 2026-01-18

### Added

- **CLI alias** `duck` → `duckdb` for convenience

### Fixed

- **DuckDB download script cross-platform compatibility**
  - `verifyCommand()` now uses `where` on Windows instead of Unix-only `which`
  - `extractZip()` now uses PowerShell `Expand-Archive` on Windows instead of requiring `unzip`
  - Binary copy now uses `copyFileSync` for idiomatic file copying with metadata preservation

- **DuckDB workflow checksum generation**
  - Fixed "Generate checksums" step to handle Windows-only, Unix-only, and mixed builds
  - Uses `shopt -s nullglob` to properly detect available archive types

## [0.11.0] - 2026-01-18

### Added

- **DuckDB support** with full 5-platform coverage
  - Fast in-process analytical database optimized for OLAP workloads
  - Version: 1.4.3 (latest stable)
  - Official binaries from GitHub releases for all platforms
  - MIT license (fully permissive for commercial use)
  - Single CLI binary (`duckdb`) - no server/client architecture needed

### Changed

- **Sources schema** updated to support `gz` format for gzip-compressed single binaries

## [0.10.1] - 2026-01-17

### Added
- **NPM publishing**
  - Added GH workflows to version checking and publishing


## [0.10.0] - 2026-01-17

### Added

- **Build missing releases workflow** (`.github/workflows/build-missing-releases.yml`)
  - Scans `databases.json` and `releases.json` to find missing releases
  - `check-only` mode reports discrepancies without building
  - `build-missing` mode triggers release workflows, waits for completion, repairs checksums, and updates `releases.json`
  - Supports filtering to a specific database

- **Shared checksums module** (`lib/checksums.ts`)
  - Extracted checksum parsing/fetching logic for reuse across scripts
  - Used by `repair-checksums.ts` and `reconcile-releases.ts`

- **CLI error messages now show available options**
  - Database not found: shows all available databases
  - Version not found: shows available versions (sorted descending)
  - Platform not found: already showed alternatives, now consistent across all commands

### Changed

- **Type consolidation in `lib/databases.ts`**
  - Added canonical type exports: `Platform`, `DatabaseEntry`, `DatabasesJson`, `PlatformAsset`, `VersionRelease`, `ReleasesJson`
  - Added `loadReleasesJson()` function
  - Scripts now import shared types instead of defining local duplicates

- **CLI refactoring** (`cli/bin.ts`)
  - `sortVersionsDesc()` is now non-mutating (uses `[...versions].sort()`)
  - Added `resolveTargetPlatform()` helper to deduplicate platform resolution logic
  - `cmdUrl` and `cmdInfo` simplified from ~40 lines to ~20 lines each

- **ClickHouse workflow simplified** (`release-clickhouse.yml`)
  - Removed dead `build-source` job (Windows experimental code)
  - Simplified prepare job outputs

### Fixed

- **Command injection vulnerability in `repair-checksums.ts`**
  - Now uses `execFileSync` with argument arrays instead of `execSync` with string interpolation
  - Added validation for `--release` tag argument (alphanumeric, dots, hyphens, underscores only)

- **Checksum repair robustness**
  - Tracks failed checksum computations and aborts upload if any fail
  - Prevents partial/corrupt checksums.txt from being uploaded

- **Signal handling in CLI launcher** (`bin/cli.js`)
  - Forwards SIGINT, SIGTERM, SIGHUP to child process
  - Properly cleans up signal handlers on exit
  - Exits with correct signal-based exit codes

## [0.9.3] - 2026-01-11

### Fixed

- **SQLite Linux binaries GLIBC compatibility**
  - Official SQLite binaries from sqlite.org require GLIBC 2.38+, breaking Ubuntu 22.04 and older
  - Both `linux-x64` and `linux-arm64` now build from source on Ubuntu 20.04
  - Binaries now require only GLIBC 2.31+ (compatible with Ubuntu 20.04+)
  - macOS and Windows continue using official binaries (unaffected by GLIBC)

### Changed

- **SQLite Dockerfile** updated to use Ubuntu 20.04 base image and support both x64/arm64
- **SQLite workflow** restructured with `build-linux` matrix job for source builds
- **SQLite build-local.sh** now supports `--platform linux-x64` in addition to `linux-arm64`

## [0.9.2] - 2026-01-11

### Added

- **Release reconciliation script** (`pnpm reconcile:releases`)
  - Validates `releases.json` against actual GitHub releases
  - Removes stale entries for releases that no longer exist (deleted binaries)
  - Supports `--dry-run` flag to preview changes without modifying
  - Handles pagination for repositories with many releases
  - Uses `GITHUB_TOKEN` env var if available to avoid rate limits

### Changed

- **`update:releases` script** now automatically runs reconciliation after appending new releases
  - Ensures `releases.json` stays in sync with GitHub even when releases are deleted

## [0.9.1] - 2026-01-11

### Added

- **MySQL 9.5.0** (Innovation release) - First MySQL 9.x version
  - Official binaries from Oracle CDN for all 5 platforms
  - Uses `macos15` (Sequoia) binaries instead of `macos14` (Sonoma)
  - Note: MySQL 9.x is an Innovation release with shorter support window (~3-6 months)
  - LTS users should continue using 8.4.x

## [0.9.0] - 2026-01-10

### Added

- **SQLite support** with full 5-platform coverage
  - Version 3.51.2 (latest stable)
  - Official binaries from `sqlite.org` for linux-x64, darwin-x64, darwin-arm64, win32-x64
  - Source build from amalgamation for linux-arm64 (no official binary available)
  - Includes sqlite3 CLI, sqldiff, sqlite3_analyzer, sqlite3_rsync
  - Public domain license (no restrictions)

- **Checksums documentation** added to CLAUDE.md
  - Most databases use SHA-256 (auto-populated via `pnpm checksums:populate`)
  - SQLite uses SHA3-256 (copied manually from vendor)
  - Guidance for handling different checksum algorithms

### Changed

- **MongoDB database-tools** updated from 100.13.0 to 100.14.0

## [0.8.0] - 2026-01-10

### Added

- **MongoDB complete bundling** - Releases now include server, shell, and database tools
  - `mongosh` (MongoDB Shell) bundled for interactive database access
  - Database tools (`mongodump`, `mongorestore`, `mongoexport`, `mongoimport`, `mongostat`, `mongotop`, `bsondump`, `mongofiles`) bundled for backup and data management
  - Component versions tracked in `sources.json` under new `components` section
  - Metadata includes component version information

- **"Complete, Embeddable Binaries" philosophy** documented in CLAUDE.md
  - Releases should be self-contained and ready to use
  - Bundle related components when vendors distribute separately
  - Include client tools alongside server binaries

### Changed

- **MongoDB download script** rewritten to download and merge three components
- **MongoDB sources.json** restructured with `components` section for shell and tools

## [0.7.0] - 2026-01-08

### Added

- **MongoDB support** with full 5-platform coverage
  - Official binaries from `fastdl.mongodb.org` CDN
  - Versions: 8.0.17 (LTS), 8.2.3 (Rapid Release), 7.0.28 (Previous LTS)
  - License warning in README about SSPL restrictions
  - FerretDB recommended as open-source alternative for commercial use

## [0.6.0] - 2026-01-07

### Added

- **Valkey support** with full 5-platform coverage
  - Linux Foundation-backed Redis fork with BSD-3-Clause license
  - Drop-in Redis replacement for commercial/closed-source projects
  - Versions: 9.0.1, 8.0.6
  - Source builds for all platforms

## [0.5.0] - 2026-01-07

### Added

- **Redis support** with full 5-platform coverage
  - Versions: 8.4.0, 7.4.7
  - Source builds for all platforms
  - License warning about RSALv2/SSPLv1 restrictions
  - Valkey recommended as open-source alternative for commercial use

## [0.4.0] - 2026-01-06

### Added

- **MariaDB support** with full 5-platform coverage
  - `builds/mariadb/download.ts` - Downloads official binaries or MariaDB4j JARs
  - `builds/mariadb/sources.json` - URL mappings for 3 LTS versions (11.8.5, 11.4.5, 10.11.15)
  - `builds/mariadb/Dockerfile` - Source builds for Linux platforms
  - `builds/mariadb/build-local.sh` - Local Docker build script
  - `.github/workflows/release-mariadb.yml` - Parallel builds across all 5 platforms
  - Native macOS builds on GitHub Actions (macos-13 for Intel, macos-14 for Apple Silicon)

## [0.3.0] - 2026-01-05

### Added

- **MySQL support** with full 5-platform coverage
  - Official binaries from Oracle CDN
  - Versions: 8.4.7, 8.0.40
  - `builds/mysql/download.ts` - Downloads and repackages official binaries
  - `builds/mysql/sources.json` - URL mappings for all versions/platforms

## [0.2.0] - 2026-01-04

### Added

- **PostgreSQL support** with full 5-platform coverage
  - Via [zonky.io embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries)
  - Versions: 18.1.0, 17.7.0, 16.11.0, 15.15.0

- **databases.json as single source of truth**
  - Workflows now validate version input against `databases.json`
  - Invalid versions fail fast with helpful error messages
  - Adding new versions no longer requires workflow file changes

- **Documentation overhaul**
  - `README.md` - Rewritten with philosophy section and automation details
  - `CLAUDE.md` - Streamlined with validation flow diagrams
  - `ARCHITECTURE.md` - Visual diagrams of system architecture
  - `CHECKLIST.md` - Step-by-step guide for adding new databases

- **Scaffolding script** (`pnpm add:engine <database>`)
  - Creates `builds/<id>/` directory with template files
  - Creates `.github/workflows/release-<id>.yml`
  - Adds `download:<id>` script to package.json

## [0.1.0] - 2026-01-03

### Changed

**Major pivot in project direction.** Originally hostdb was an npm monorepo using turborepo to publish platform-specific database packages. This approach was abandoned in favor of hosting binaries on GitHub Releases.

#### New Approach
- Download official binaries from vendor CDNs (fast, seconds not hours)
- Repackage with metadata and host on GitHub Releases
- Queryable `releases.json` manifest for consumers (like SpinDB)
- Build from source only as fallback when official binaries unavailable

### Added

- `releases.json` - Manifest of all GitHub Releases (queryable by SpinDB)
- `schemas/sources.schema.json` - Validates sources.json files
- `schemas/releases.schema.json` - Validates releases.json
- `scripts/update-releases.ts` - Updates releases.json after GitHub Release
- `status` field in `databases.json` (`completed`, `in-progress`, `pending`, `unsupported`)
- `pnpm dbs` command for listing databases
- `pnpm prep` command for pre-commit checks
- `pnpm sync:versions` command for syncing workflow dropdowns

### Removed

- Turborepo configuration
- Platform-specific npm packages
- Old package generation scripts
- pnpm workspace configuration
