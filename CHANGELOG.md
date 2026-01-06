# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2025-01-06

### Added

- **MariaDB support** with full 5-platform coverage
  - `builds/mariadb/download.ts` - Downloads official binaries or MariaDB4j JARs
  - `builds/mariadb/sources.json` - URL mappings for 3 LTS versions (11.8.5, 11.4.5, 10.6.24)
  - `builds/mariadb/Dockerfile` - Source builds for Linux platforms
  - `builds/mariadb/build-local.sh` - Local Docker build script
  - `.github/workflows/release-mariadb.yml` - Parallel builds across all 5 platforms
  - Native macOS builds on GitHub Actions (macos-13 for Intel, macos-14 for Apple Silicon)

- **databases.json as single source of truth**
  - Workflows now validate version input against `databases.json`
  - Version input changed from dropdown to text field
  - Invalid versions fail fast with helpful error messages showing available options
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
  - Prints next steps for Claude Code to implement

### Changed

- All release workflows now have a `validate` job that checks:
  - Version is enabled in `databases.json`
  - Version exists in `builds/<db>/sources.json`
- Workflow version input changed from `type: choice` to `type: string`
- Platform matrix for MariaDB uses different runners per platform:
  - `ubuntu-latest` for Linux (Docker builds)
  - `macos-13` for darwin-x64 (native Intel build)
  - `macos-14` for darwin-arm64 (native Apple Silicon build)

## [0.1.0] - 2025-01-04

### Changed

**Major pivot in project direction.** Originally hostdb was an npm monorepo using turborepo to publish platform-specific database packages (`@host-db/mysql-darwin-arm64`, etc.). This approach was abandoned in favor of hosting binaries on GitHub Releases.

#### Old Approach (0.0.x)
- Turborepo monorepo with platform-specific npm packages
- Binaries downloaded during `npm postinstall`
- Complex package generation scripts
- Manifests for each database version

#### New Approach (0.1.0+)
- Download official binaries from vendor CDNs (fast, seconds not hours)
- Repackage with metadata and host on GitHub Releases
- Queryable `releases.json` manifest for consumers (like SpinDB)
- Build from source only as fallback when official binaries unavailable

### Added

- `builds/mysql/download.ts` - Downloads official MySQL binaries
- `builds/mysql/sources.json` - Maps versions/platforms to official URLs
- `releases.json` - Manifest of all GitHub Releases (queryable by SpinDB)
- `schemas/sources.schema.json` - Validates sources.json files
- `schemas/releases.schema.json` - Validates releases.json
- `scripts/update-releases.ts` - Updates releases.json after GitHub Release
- `.github/workflows/release-mysql.yml` - GitHub Actions workflow for MySQL releases
- `status` field in `databases.json` (`in-progress`, `pending`, `unsupported`)

### Removed

- Turborepo configuration (`turbo.json`, `tsconfig.base.json`)
- Platform-specific npm packages (`packages/`)
- Database manifests (`manifests/`)
- Old package generation scripts
- pnpm workspace configuration (monorepo no longer needed)

## [0.0.1] - 2025-01-03

### Added

- Initial project setup as npm monorepo
- `databases.json` with metadata for 24 databases
- `downloads.json` with CLI tools and prerequisites
- JSON schemas for configuration validation
- `pnpm dbs` command for listing databases
