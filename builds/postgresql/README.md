# PostgreSQL Builds

Build PostgreSQL from source for distribution via GitHub Releases.

## Platform Coverage

**All 5 platforms are fully supported for all versions.**

| Platform | Method | Runner | Build Time |
|----------|--------|--------|------------|
| linux-x64 | Docker source build | ubuntu-latest | ~15-25 min |
| linux-arm64 | Docker source build (QEMU) | ubuntu-latest | ~45-90 min |
| darwin-x64 | Native source build | macos-15-intel | ~20-40 min |
| darwin-arm64 | Native source build | macos-14 | ~15-30 min |
| win32-x64 | Official EDB binary | ubuntu-latest | ~2-5 min |

## Binary Sources

| Source | Platforms | Notes |
|--------|-----------|-------|
| Source Build (Docker) | linux-x64, linux-arm64 | Built from official source tarball |
| Source Build (Native macOS) | darwin-x64, darwin-arm64 | Built with Homebrew dependencies |
| EnterpriseDB (EDB) | win32-x64 | Official Windows binary ZIP |

### Source Builds (ftp.postgresql.org)

For Linux and macOS, we build PostgreSQL from source using the official tarballs:

**URL pattern:**
```
https://ftp.postgresql.org/pub/source/v{VERSION}/postgresql-{VERSION}.tar.gz
```

**Features included:**
- SSL support (`--with-openssl`)
- Readline support (`--with-readline`)
- XML support (`--with-libxml`, `--with-libxslt`)
- ICU support (`--with-icu`)
- All contrib modules (pg_stat_statements, etc.)

### EnterpriseDB Windows Binaries

Windows binaries are downloaded from EnterpriseDB's download portal. EDB uses non-predictable file IDs for downloads.

**To fetch current file IDs:**
```bash
pnpm edb:fileids              # Show available file IDs
pnpm edb:fileids -- --update  # Update sources.json with latest IDs
```

## Usage

```bash
# Local Docker build for Linux
./builds/postgresql/build-local.sh --version 17.7 --platform linux-x64

# Build linux-arm64 (requires QEMU or ARM host)
./builds/postgresql/build-local.sh --version 17.7 --platform linux-arm64

# Build without Docker cache
./builds/postgresql/build-local.sh --version 17.7 --no-cache

# Auto-cleanup extracted files after tarball creation
./builds/postgresql/build-local.sh --version 17.7 --cleanup
```

Note: macOS builds run natively on GitHub Actions runners (macos-14 for ARM64, macos-15-intel for x64).

## Output

Builds are saved to `./dist/`:

```
dist/
├── postgresql-17.7-linux-x64/
│   └── postgresql/           (extracted build)
└── postgresql-17.7-linux-x64.tar.gz  (final tarball)
```

Archives contain:
- PostgreSQL binaries in a `postgresql/` directory
- All contrib modules in `postgresql/lib/` and `postgresql/share/extension/`
- `.hostdb-metadata.json` with provenance information

## Supported Versions

| Version | Type | Notes |
|---------|------|-------|
| 18.1 | Latest | PostgreSQL 18 |
| 17.7 | Current | PostgreSQL 17 |
| 16.11 | Supported | PostgreSQL 16 |
| 15.15 | Supported | PostgreSQL 15 |

## Platform Coverage Matrix

**Full coverage: 5 platforms × 4 versions = 20 binaries**

| Platform | 18.1 | 17.7 | 16.11 | 15.15 | Method |
|----------|------|------|-------|-------|--------|
| linux-x64 | ✅ | ✅ | ✅ | ✅ | Docker source build |
| linux-arm64 | ✅ | ✅ | ✅ | ✅ | Docker source build (QEMU) |
| darwin-x64 | ✅ | ✅ | ✅ | ✅ | Native macOS build |
| darwin-arm64 | ✅ | ✅ | ✅ | ✅ | Native macOS build |
| win32-x64 | ✅ | ✅ | ✅ | ✅ | Official EDB binary |

## GitHub Actions

The release workflow builds all platforms in parallel:

1. Go to Actions → "Release PostgreSQL" → Run workflow
2. Select version and platforms (default: all)
3. Click "Run workflow"

| Platform | Runner | Build Type |
|----------|--------|------------|
| linux-x64 | ubuntu-latest | Docker source build |
| linux-arm64 | ubuntu-latest | Docker source build (QEMU) |
| darwin-x64 | macos-15-intel | Native source build |
| darwin-arm64 | macos-14 | Native source build |
| win32-x64 | ubuntu-latest | Download EDB binary |

## Adding New Versions

1. Add version to `databases.json`:
   ```json
   "versions": { "19.0.0": true, "18.1.0": true, ... }
   ```

2. Fetch EDB file ID for Windows:
   ```bash
   pnpm edb:fileids -- --update
   ```

3. Sync workflow and populate checksums:
   ```bash
   pnpm prep
   ```

4. Commit changes and run the workflow

## Why Source Builds?

Previously, PostgreSQL binaries were sourced from [zonky.io embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries). We switched to source builds to address:

1. **Missing contrib modules**: zonky.io binaries didn't include pg_stat_statements and other contrib modules
2. **Dependency issues**: Runtime library incompatibilities on some platforms
3. **Reliability**: No dependency on third-party binary availability

## Build Dependencies

### Docker (Linux)

The Dockerfile installs these dependencies on Ubuntu 22.04:
- build-essential, flex, bison
- libreadline-dev, libssl-dev, zlib1g-dev
- libxml2-dev, libxslt1-dev, libicu-dev
- pkg-config

### macOS (Native)

GitHub Actions installs via Homebrew:
- openssl@3, readline
- libxml2, libxslt
- icu4c, pkg-config

The macOS builds include the Xcode SDK fix for Xcode 16+ to prevent header conflicts.

## Related Links

- [PostgreSQL Downloads](https://www.postgresql.org/download/)
- [PostgreSQL FTP](https://ftp.postgresql.org/pub/source/)
- [EnterpriseDB Downloads](https://www.enterprisedb.com/downloads)
- [EDB Binary Archives](https://www.enterprisedb.com/download-postgresql-binaries)
