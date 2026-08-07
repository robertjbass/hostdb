# PostgreSQL + DocumentDB

PostgreSQL 17 with DocumentDB extension for use as FerretDB backend.

## Overview

This package bundles PostgreSQL 17 with the DocumentDB extension and several supporting extensions, providing a complete backend for FerretDB.

## Binary Sources

| Platform | Source | Notes |
|----------|--------|-------|
| linux-x64 | Build | Source build inside an `ubuntu:22.04` container |
| linux-arm64 | Build | Source build inside an `ubuntu:22.04` container (QEMU) |
| darwin-x64 | Build | Native build on macOS Intel |
| darwin-arm64 | Build | Native build on macOS Apple Silicon |
| win32-x64 | Build | Stretch goal - hybrid download + source build |

## Bundled Extensions

- **DocumentDB** (0.107.0) - MongoDB wire protocol support for PostgreSQL
- **pg_cron** (1.6.4) - Job scheduler for PostgreSQL
- **pgvector** (0.8.0) - Vector similarity search
- **PostGIS** (3.5.1) - Geospatial extension
- **rum** (1.3.14) - RUM index access method

## Version Naming

Versions follow the pattern: `{pg_major}-{documentdb_version}`

Example: `17-0.107.0` means PostgreSQL 17 with DocumentDB 0.107.0

## Download Script

```bash
# Download for current platform (Linux only via Docker)
pnpm download:postgresql-documentdb -- --version 17-0.107.0

# Download for all platforms
pnpm download:postgresql-documentdb -- --version 17-0.107.0 --all-platforms

# Download for specific platform
pnpm download:postgresql-documentdb -- --version 17-0.107.0 --platform linux-arm64
```

## Archive Structure

Extension and library file extensions vary by platform: `.so` on Linux, `.dylib` on macOS.

```
postgresql-documentdb/
├── bin/
│   ├── postgres
│   ├── initdb
│   ├── pg_ctl
│   ├── psql
│   ├── pg_dump
│   └── pg_restore
├── lib/
│   ├── postgresql/           # PostgreSQL extension modules
│   │   ├── pg_documentdb.{so,dylib}
│   │   ├── pg_documentdb_core.{so,dylib}
│   │   ├── pg_cron.{so,dylib}
│   │   ├── vector.{so,dylib}
│   │   ├── postgis-3.{so,dylib}
│   │   ├── dict_snowball.{so,dylib}
│   │   └── ...
│   ├── libpq.5.dylib         # Bundled shared libraries (macOS)
│   ├── libicuuc.78.dylib
│   ├── libbson2.2.dylib      # From mongo-c-driver (DocumentDB dep)
│   ├── libpcre2-8.0.dylib    # From pcre2 (DocumentDB dep)
│   └── ...
├── share/
│   ├── extension/
│   │   ├── documentdb.control
│   │   ├── pg_cron.control
│   │   ├── vector.control
│   │   ├── postgis.control
│   │   └── rum.control
│   └── postgresql.conf.sample
└── .hostdb-metadata.json
```

## Pre-configured Settings

The bundled `postgresql.conf.sample` includes:

```ini
shared_preload_libraries = 'pg_cron,pg_documentdb_core,pg_documentdb'
cron.database_name = 'postgres'
listen_addresses = 'localhost'
```

## Building from Source (macOS)

For macOS, the build script compiles all extensions from source:

```bash
# Build for current macOS architecture
./builds/postgresql-documentdb/build-macos.sh 17-0.107.0

# Or via the workflow on GitHub Actions
# Uses macos-14 (arm64) and macos-15-intel (x64) runners
```

### Relocatability & Dylib Bundling

macOS binaries must be fully relocatable — no hardcoded Homebrew paths. The build script handles this in Step 10:

1. **Dependency bundling**: Recursively scans all Mach-O binaries and dylibs for Homebrew dependencies, copies them into the bundle's `lib/` directory.
2. **Path rewriting**: Rewrites all absolute Homebrew paths to `@loader_path/` relative references using `install_name_tool`.
3. **Code signing**: Re-signs all modified binaries (macOS requires this after `install_name_tool` changes).

**Important**: The bundling step must scan both `lib/*.dylib` and `lib/postgresql/*.dylib`. Extension dylibs in `lib/postgresql/` (like `pg_documentdb_core.dylib`) may reference Homebrew libraries (e.g. `libbson2.2.dylib` from `mongo-c-driver`, `libpcre2-8.0.dylib` from `pcre2`) that are not dependencies of any `bin/` binary. If the `lib/postgresql/` subdirectory is not included in the scan, these transitive dependencies will be missing from the bundle, causing `dlopen` failures at runtime.

## Linux builds (Docker)

Linux binaries are **built from source** inside a container by `build-linux.sh`,
not extracted from `ghcr.io/ferretdb/postgres-documentdb`. Extracting that image
would give a tree wired to the image's own PostgreSQL layout and system
libraries; building from source is what makes the package relocatable.

```bash
# Handled by download.ts -> build-linux.sh
./build-linux.sh 17-0.107.0 linux-x64 ./dist
```

**Base image: `ubuntu:22.04` (jammy, glibc 2.35).** It was `debian:bookworm`
until 2026-08-07. Two reasons for the move:

- A "stable" distro tag is a moving target. CouchDB 3.5.2 shipped broken when
  its base followed the upstream image from bookworm to trixie and inherited
  glibc 2.41. `ubuntu:22.04` names one release and stays on it.
- bookworm's glibc is 2.36, already above hostdb's 2.35 floor. The dependency
  bundler copies host libraries into the package, and the published 17-0.107.0
  linux-x64 tarball carries a `lib/libexpat.so.1` that needs `GLIBC_2.36`, so it
  cannot load on Ubuntu 22.04. `builds/common/check-glibc-floor.sh` now fails a
  release for that.

The published 17-0.107.0 artifacts were not rebuilt when the base changed; the
next release is the first jammy build.

## Usage with FerretDB

```bash
# Start PostgreSQL with DocumentDB
./postgresql-documentdb/bin/initdb -D /path/to/data
./postgresql-documentdb/bin/pg_ctl -D /path/to/data -l logfile start

# Connect and create extension
./postgresql-documentdb/bin/psql -c "CREATE EXTENSION documentdb CASCADE;"

# Start FerretDB pointing to this PostgreSQL
./ferretdb/bin/ferretdb --postgresql-url="postgres://localhost:5432/postgres"
```

## License

Apache-2.0 - Fully permissive for commercial use.
