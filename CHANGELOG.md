# Changelog

All notable changes to this project will be documented in this file.

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
