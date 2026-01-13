# ClickHouse Build

ClickHouse binaries for all 5 platforms.

ClickHouse is a column-oriented database for real-time analytics and big data processing.

## Sources

| Platform | Source | Notes |
|----------|--------|-------|
| `linux-x64` | Official binary | GitHub releases (clickhouse-common-static tarball) |
| `linux-arm64` | Official binary | GitHub releases (clickhouse-common-static tarball) |
| `darwin-x64` | Official binary | GitHub releases (single executable) |
| `darwin-arm64` | Official binary | GitHub releases (single executable) |
| `win32-x64` | Source build | **EXPERIMENTAL** - Cygwin on windows-latest |

**Note:** ClickHouse does not officially support Windows. Our Windows builds use Cygwin for POSIX compatibility and are experimental. These builds may fail or have limited functionality. For production Windows use, consider WSL.

## Building

### Download Linux/macOS binaries

```bash
# Download for current platform
pnpm download:clickhouse -- --version 25.12.3.21

# Download for specific platform
pnpm download:clickhouse -- --version 25.12.3.21 --platform linux-x64

# Download for all platforms (skips Windows)
pnpm download:clickhouse -- --version 25.12.3.21 --all-platforms
```

### Windows build

Windows builds are handled by the GitHub Actions workflow using Cygwin. They cannot be built locally with this script.

## Versions

Currently configured versions (from `databases.json`):

- 25.12.3.21 (latest stable)

## Binary Structure

ClickHouse uses a single monolithic binary with subcommands:

```
clickhouse/
├── bin/
│   ├── clickhouse              # Main binary (~130-200MB)
│   ├── clickhouse-server       # Symlink to clickhouse
│   ├── clickhouse-client       # Symlink to clickhouse
│   ├── clickhouse-local        # Symlink to clickhouse
│   ├── clickhouse-benchmark    # Symlink to clickhouse
│   ├── clickhouse-compressor   # Symlink to clickhouse
│   ├── clickhouse-format       # Symlink to clickhouse
│   └── clickhouse-obfuscator   # Symlink to clickhouse
└── .hostdb-metadata.json
```

### Usage Modes

The single `clickhouse` binary supports multiple modes via subcommands or symlinks:

```bash
# Start server
./clickhouse server
# or via symlink:
./clickhouse-server

# Connect as client
./clickhouse client
# or via symlink:
./clickhouse-client

# Run queries locally without server
./clickhouse local
# or via symlink:
./clickhouse-local
```

## Build Notes

### Linux

Official tarballs from GitHub releases contain the binary at `usr/bin/clickhouse`. We extract and repackage into our standard `clickhouse/bin/` structure.

### macOS

GitHub releases provide single executable files (not tarballs). We wrap these in tar.gz archives with the standard directory structure and symlinks.

### Windows (Experimental)

No official Windows binaries exist. Our CI attempts to build ClickHouse using Cygwin's POSIX compatibility layer. This is highly experimental:

- Cygwin provides Clang 20+ (meets ClickHouse's Clang 19+ requirement)
- Build may fail due to Linux-specific code (epoll, io_uring, etc.)
- Build time may exceed GitHub Actions limits (~6 hours)
- Resulting binary requires Cygwin DLLs at runtime

If the Windows build consistently fails, we may mark `win32-x64: false` and recommend WSL instead.

## License

ClickHouse is licensed under Apache-2.0, making it fully permissive for commercial use.
