# hostdb

Pre-built database binaries for multiple platforms, distributed via GitHub Releases.

**Primary consumer:** [SpinDB](https://github.com/robertjbass/spindb)

## Quick Start

```bash
# Download MySQL 8.4.3 for current platform
pnpm download:mysql

# Download for all platforms
pnpm download:mysql -- --all-platforms

# List supported databases
pnpm dbs
```

## Querying Available Binaries

SpinDB (or any consumer) can fetch `releases.json` for available binaries:

```bash
curl https://raw.githubusercontent.com/robertjbass/hostdb/main/releases.json
```

Download URL pattern:
```
https://github.com/robertjbass/hostdb/releases/download/{tag}/{filename}
# Example:
https://github.com/robertjbass/hostdb/releases/download/mysql-8.4.3/mysql-8.4.3-darwin-arm64.tar.gz
```

## What's Been Done

See plan: `~/.claude/plans/mossy-meandering-babbage.md`

### Phase 1: Cleanup (Complete)
- [x] Added `status` field to databases.json (`in-progress`, `pending`, `unsupported`)
- [x] Removed turborepo (turbo.json, tsconfig.base.json, pnpm-workspace.yaml)
- [x] Removed legacy code (old npm monorepo packages)
- [x] Updated CLAUDE.md with new project structure

### Phase 2: MySQL Download Infrastructure (Complete)
- [x] Created `builds/mysql/download.ts` - downloads official binaries
- [x] Created `builds/mysql/sources.json` - maps versions/platforms to URLs
- [x] Created `schemas/sources.schema.json` - validates sources.json
- [x] Tested local download: MySQL 8.4.3 darwin-arm64 works
- [x] Created `releases.json` manifest for querying available binaries
- [x] Created `schemas/releases.schema.json` - validates releases.json
- [x] Created `.github/workflows/release-mysql.yml` - GitHub Actions workflow
- [x] Created `scripts/update-releases.ts` - updates manifest after release

## Status

| Database | Status | Notes |
|----------|--------|-------|
| MySQL | ✅ Complete | 8.4.3, 8.0.40, 9.1.0 available |
| PostgreSQL | 🔄 Next | Official binary downloads |
| Redis | 🔄 Next | Build from source |
| SQLite | 🔄 Next | Official amalgamation |
| MongoDB | 🔄 Next | Official binaries (SSPL license) |
| MariaDB | ⏳ Pending | Copy MySQL pattern |

## Next Steps

### Phase 3: Additional Databases
- [ ] PostgreSQL - official binary downloads available
- [ ] Redis - builds from source (no official binaries for all platforms)
- [ ] SQLite - small, official amalgamation downloads
- [ ] MongoDB - official binaries (note: SSPL license restricts commercial use)

### Phase 4: CLI Tool
- [ ] Create `cli/` package
- [ ] TUI for browsing/downloading binaries
- [ ] Publish to npm as `@hostdb/cli` or `hostdb`

## Supported Platforms

| Platform | Description |
|----------|-------------|
| `linux-x64` | Linux x86_64 (glibc 2.28+) |
| `linux-arm64` | Linux ARM64 (glibc 2.28+) |
| `darwin-x64` | macOS Intel |
| `darwin-arm64` | macOS Apple Silicon |
| `win32-x64` | Windows x64 |

## Project Structure

```
hostdb/
├── databases.json          # Database metadata
├── downloads.json          # CLI tools, prerequisites
├── releases.json           # Manifest of GitHub Releases (queryable)
├── schemas/                # JSON schemas
├── builds/
│   └── mysql/
│       ├── download.ts     # Downloads official binaries
│       ├── sources.json    # Version → URL mappings
│       ├── Dockerfile      # Fallback: build from source
│       └── README.md
├── scripts/
│   ├── list-databases.ts   # pnpm dbs
│   └── update-releases.ts  # Updates releases.json
├── .github/workflows/
│   ├── release-mysql.yml   # Creates GitHub Releases
│   └── version-check.yml   # PR version check (for future CLI package)
└── cli/                    # TUI tool (Phase 4, not yet created)
```

## License

[PolyForm Noncommercial 1.0.0](./LICENSE)
