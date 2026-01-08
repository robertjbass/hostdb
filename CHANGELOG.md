# Changelog

All notable changes to this project will be documented in this file.

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
