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

### Windows build (local)

Windows builds can be done locally using MSYS2 CLANG64. This is much faster for iteration than waiting for GitHub Actions.

**Quick start** (from PowerShell or Command Prompt):
```powershell
cd C:\Users\Bob\dev\hostdb\builds\clickhouse
.\build-windows.ps1 -Version 25.12.3.21
```

The PowerShell script automatically:
- Installs MSYS2 if not present
- Installs all required CLANG64 packages
- Runs the build inside the correct environment

**Build directory:** `~/clickhouse-build` (outside the repo to avoid bloating it)

**Build options:**
```powershell
# Full build (reuses existing source automatically)
.\build-windows.ps1 -Version 25.12.3.21

# Clean rebuild (removes cached source)
.\build-windows.ps1 -Version 25.12.3.21 -Clean

# Just configure to check cmake errors
.\build-windows.ps1 -Version 25.12.3.21 -ConfigureOnly
```

**Alternative: Run directly in MSYS2**

If you prefer to work directly in the MSYS2 terminal:

1. Launch "MSYS2 CLANG64" from Start menu
2. Run:
   ```bash
   cd /c/Users/Bob/dev/hostdb/builds/clickhouse
   ./build-windows.sh --version 25.12.3.21
   ```

**Tracking progress:**

Create `clickhouse-windows-build-log.md` to track iterations:
```markdown
# ClickHouse Windows Build Log

## Iteration 1 - 2024-01-14
**Duration:** Failed at 45 min
**Changes:** Initial attempt
**Result:** CMake configuration failed - missing Threads package
**Next:** Add find_package(Threads) to CMakeLists.txt
```

See `WINDOWS_BUILD.md` in the repo root for more details on Windows build strategies.

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
