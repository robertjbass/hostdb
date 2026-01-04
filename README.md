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

## To Test

### Local Download (Already Tested)
```bash
pnpm download:mysql -- --version 8.4.3
# Output: dist/mysql-8.4.3-darwin-arm64.tar.gz (165MB)
```

### GitHub Actions (Not Yet Tested)
1. Push changes to GitHub
2. Go to Actions → "Release MySQL" → Run workflow
3. Enter version `8.4.3` and platforms `all`
4. Verify release created with all platform binaries
5. Verify `releases.json` updated automatically

## Next Steps

### Immediate
- [ ] Push to GitHub and test the release workflow
- [ ] Verify checksums are captured in `sources.json` after first release

### Phase 3: Additional Databases
- [ ] MariaDB - copy MySQL pattern
- [ ] Redis - may need to build from source for Windows
- [ ] PostgreSQL - for redundancy (Zonky.io already provides)
- [ ] SQLite - lower priority

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

MIT
