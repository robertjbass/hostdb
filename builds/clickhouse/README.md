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
| `win32-x64` | Source build | **EXPERIMENTAL** - MSYS2 CLANG64 on windows-latest |

**Note:** ClickHouse does not officially support Windows. Our Windows builds use MSYS2 CLANG64 with extensive patches for POSIX compatibility. These builds are experimental and may fail or have limited functionality. For production Windows use, consider WSL.

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

No official Windows binaries exist. Our CI builds ClickHouse using MSYS2 CLANG64 with extensive patches for Windows compatibility. This is highly experimental.

**Build implementation:**
- GitHub Actions workflow calls `builds/clickhouse/build-windows.sh`
- The script applies 11+ patches for Windows compatibility
- Creates POSIX stub headers for missing system headers
- Disables Linux-specific features (epoll, io_uring, jemalloc, etc.)

**Key patches (see build-windows.sh for details):**
- `cmake/arch.cmake` - AMD64 uppercase detection
- `cmake/target.cmake` - Windows OS support
- `cmake/git.cmake` - Skip slow git status
- OpenSSL - Disable ASM, remove POSIX-only sources
- boost-cmake - Windows PE assembly files
- libarchive - Windows crypto headers
- LLVM - NO_ERROR macro conflict resolution
- Fake POSIX headers (endian.h, sys/mman.h, grp.h, pwd.h, etc.)

**Limitations:**
- Build may fail due to untested code paths
- Build time may exceed GitHub Actions limits (~6 hours)
- Some features are disabled (see CMake configuration in script)

If the Windows build consistently fails, we may mark `win32-x64: false` and recommend WSL instead.

## License

ClickHouse is licensed under Apache-2.0, making it fully permissive for commercial use.
