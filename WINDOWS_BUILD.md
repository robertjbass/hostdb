# Windows Build Strategies

This document covers strategies for building database binaries for Windows when official Windows binaries don't exist.

## Overview

Many database projects are developed primarily for Unix-like systems and don't provide official Windows binaries. When this happens, we have several strategies to create Windows builds using cross-compilation or compatibility layers.

## Current Strategies

### 1. Cygwin (POSIX Emulation Layer)

**Used by:** Valkey

**How it works:** Cygwin provides a POSIX-compatible environment on Windows. Binaries built with Cygwin require the Cygwin DLL (`cygwin1.dll`) and related libraries at runtime.

**Pros:**
- Easier to build software that heavily relies on POSIX APIs
- Good compatibility with Unix-centric codebases
- Mature toolchain with extensive package support

**Cons:**
- Requires bundling Cygwin DLLs with the binary
- Slight performance overhead due to POSIX emulation
- Not "native" Windows binaries

**Implementation:**
```yaml
# GitHub Actions setup
- name: Setup Cygwin
  uses: cygwin/cygwin-install-action@master
  with:
    packages: >-
      make
      gcc-core
      gcc-g++
      libssl-devel
      pkg-config
      zip

# Build shell
shell: C:\cygwin\bin\bash.exe --login -eo pipefail -o igncr '{0}'
env:
  CYGWIN: winsymlinks:native
```

**Required DLLs to bundle:**
```bash
cp /usr/bin/cygwin1.dll      output/bin/
cp /usr/bin/cygssl-3.dll     output/bin/
cp /usr/bin/cygcrypto-3.dll  output/bin/
cp /usr/bin/cygz.dll         output/bin/
cp /usr/bin/cyggcc_s-seh-1.dll output/bin/
```

**Inspiration:** The Valkey Windows build strategy was inspired by [redis-windows](https://github.com/redis-windows/redis-windows), which provides Windows builds of Redis using Cygwin.

---

### 2. MSYS2 CLANG64 (Native Windows with Clang/LLVM)

**Used by:** ClickHouse (experimental)

**How it works:** MSYS2 provides multiple environments. CLANG64 uses Clang/LLVM to produce native Windows binaries without POSIX emulation. The resulting `.exe` files don't require Cygwin DLLs.

**Pros:**
- Produces native Windows executables
- No runtime DLL dependencies (beyond standard Windows libraries)
- Modern Clang/LLVM toolchain with good optimization

**Cons:**
- More complex setup for POSIX-heavy codebases
- May require extensive patching for Unix-specific code
- Some projects may not compile at all

**Implementation:**
```yaml
# GitHub Actions setup
- name: Setup MSYS2
  uses: msys2/setup-msys2@v2
  with:
    msystem: CLANG64
    update: true
    install: >-
      mingw-w64-clang-x86_64-clang
      mingw-w64-clang-x86_64-lld
      mingw-w64-clang-x86_64-cmake
      mingw-w64-clang-x86_64-ninja
      mingw-w64-clang-x86_64-openssl
      mingw-w64-clang-x86_64-zlib
      git
      zip

# Build shell
shell: msys2 {0}
```

**Common patches needed:**
1. **POSIX compatibility header** - Stub out missing functions like `sysconf()`, `getpagesize()`, `sigaltstack()`
2. **Macro conflicts** - Windows headers define macros like `NO_ERROR` that conflict with enums
3. **Architecture detection** - Some projects don't recognize Windows' `AMD64` (uppercase)
4. **Linker flags** - Remove Unix-specific flags like `-rdynamic`

---

### 3. MSYS2 MINGW64 (Native Windows with GCC)

**Not currently used, but available as alternative**

**How it works:** Similar to CLANG64 but uses GCC instead of Clang. Produces native Windows binaries.

**When to consider:**
- Project has GCC-specific code or build requirements
- Clang has issues with specific code patterns
- Need GCC extensions

**Implementation:**
```yaml
- name: Setup MSYS2
  uses: msys2/setup-msys2@v2
  with:
    msystem: MINGW64
    install: >-
      mingw-w64-x86_64-gcc
      mingw-w64-x86_64-cmake
      # ... other packages with mingw-w64-x86_64- prefix
```

---

## Choosing a Strategy

| Factor | Cygwin | MSYS2 CLANG64 | MSYS2 MINGW64 |
|--------|--------|---------------|---------------|
| **POSIX compatibility** | Excellent | Requires patching | Requires patching |
| **Native Windows binary** | No (needs DLLs) | Yes | Yes |
| **Build complexity** | Lower | Higher | Higher |
| **Runtime overhead** | Slight | None | None |
| **Best for** | POSIX-heavy apps | Modern C++ projects | GCC-specific projects |

**Decision tree:**
1. Does the project have heavy POSIX dependencies (signals, fork, etc.)? → **Cygwin**
2. Is it a modern C++ project with CMake? → **MSYS2 CLANG64**
3. Does it require GCC-specific features? → **MSYS2 MINGW64**
4. Is minimal patching a priority? → **Cygwin**
5. Is native performance critical? → **MSYS2 (either)**

---

## Common Workarounds

### POSIX Compatibility Header

For MSYS2 builds, create a compatibility header to stub missing POSIX functions:

```c
#pragma once
#ifdef _WIN32

#include <stddef.h>

// sysconf constants
#ifndef _SC_PAGESIZE
#define _SC_PAGESIZE 1
#endif
#ifndef _SC_NPROCESSORS_ONLN
#define _SC_NPROCESSORS_ONLN 2
#endif

static inline int getpagesize(void) { return 4096; }
static inline long sysconf(int name) {
    switch(name) {
        case _SC_PAGESIZE: return 4096;
        case _SC_NPROCESSORS_ONLN: return 4;
        default: return -1;
    }
}

// Signal stack stubs
#ifndef SIGSTKSZ
#define SIGSTKSZ 8192
#endif
typedef struct { void *ss_sp; int ss_flags; size_t ss_size; } stack_t;
static inline int sigaltstack(const stack_t *ss, stack_t *old_ss) {
    (void)ss; (void)old_ss; return 0;
}

#endif // _WIN32
```

Include it globally via CMake:
```cmake
-DCMAKE_CXX_FLAGS="-include /path/to/compat_windows.h"
```

### Windows Macro Conflicts

Windows headers (`windows.h`, `winerror.h`) define macros that conflict with code:
- `NO_ERROR` - conflicts with enums
- `OPTIONAL` - conflicts with type names
- `IMAGE_FILE_MACHINE_*` - conflicts with LLVM enums

**Solution:** Avoid including `<windows.h>` in compatibility headers, or patch conflicting code:
```bash
sed -i 's/NO_ERROR/FEATURE_NO_ERROR/g' path/to/file.h
```

### Architecture Detection

Some projects only check lowercase architecture names:
```cmake
# Original (doesn't match Windows)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64")

# Patched (includes Windows AMD64)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|AMD64|x86_64")
```

### Removing Unix-Specific Linker Flags

```bash
# Remove -rdynamic (not supported on Windows)
sed -i 's/-rdynamic//' src/Makefile
```

### Disabling Broken Inline Assembly

Some inline assembly doesn't work correctly on Windows/MSYS2:
```c
/* Add at top of file to disable broken asm */
#undef OPENSSL_BN_ASM_MONT
#undef BN_DIV3W
```

---

## Future Strategies to Explore

### Cross-Compilation from Linux

**Concept:** Use MinGW-w64 cross-compiler on Linux to build Windows binaries.

**Potential benefits:**
- Faster builds (no Windows runner overhead)
- More familiar Linux build environment
- Can use Docker for reproducibility

**Implementation sketch:**
```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
    mingw-w64 \
    cmake \
    ninja-build

# Cross-compile for Windows
RUN cmake -DCMAKE_TOOLCHAIN_FILE=mingw-w64.cmake ...
```

### Wine + MSVC Compiler

**Concept:** Run Microsoft Visual C++ (MSVC) compiler under Wine on Linux to produce native Windows binaries.

**Important clarification:** Wine runs *Windows programs on Linux* — it doesn't help Windows users run Linux binaries. This strategy is for **building** Windows binaries from a Linux CI runner, not for end-user runtime.

**When to consider:**
- Project requires MSVC-specific features (Windows SDK, ATL, MFC)
- Need to match official Windows builds exactly
- MinGW/Clang produce incompatible binaries

**Challenges:**
- Complex setup (Wine + MSVC installation)
- Licensing concerns with redistributing MSVC
- Slower than native Windows runner
- May not work for all projects

### WSL Build + Copy

**Concept:** Build in WSL on Windows runner, copy binaries out.

**Limitation:** Produces Linux binaries, not Windows binaries. Only useful if the project supports Windows natively but build system is Unix-only.

### Pre-built Docker Images

**Concept:** Maintain Docker images with pre-configured Windows cross-compilation toolchains.

**Benefits:**
- Faster CI (no toolchain setup)
- Reproducible builds
- Can cache complex patches

### Zig as Cross-Compiler

**Concept:** Use Zig's cross-compilation capabilities to target Windows from any platform.

**Potential benefits:**
- Single toolchain for all targets
- Drop-in replacement for GCC/Clang
- Excellent cross-compilation support

**Implementation sketch:**
```bash
# Cross-compile C project for Windows from Linux
CC="zig cc -target x86_64-windows-gnu" ./configure
make
```

---

## Iterating on Build Failures

Windows source builds often require multiple iterations to get working. Use this workflow to track progress:

### Setup

1. **Create tracking files** (already in `.gitignore`):
   - `<database>-windows-build-log.md` — Track iterations, timing, and changes
   - `err.log` — Paste full build logs for analysis

2. **Log format** for the markdown file:
   ```markdown
   # ClickHouse Windows Build Log

   ## Iteration 1 - 2024-01-14
   **Duration:** Failed at 45 min
   **Changes:** Initial attempt with MSYS2 CLANG64
   **Result:** CMake configuration failed - missing Threads package
   **Next:** Add find_package(Threads) to CMakeLists.txt

   ## Iteration 2 - 2024-01-14
   **Duration:** Failed at 52 min
   **Changes:** Added find_package(Threads), patched arch.cmake
   **Result:** Build failed - NO_ERROR macro conflict with Windows headers
   **Next:** Rename NO_ERROR to FEATURE_NO_ERROR in LLVM files
   ```

3. **Track key metrics**:
   - Time to failure (progress = longer before failure)
   - Which phase failed (configure vs compile vs link)
   - Specific error messages

### Why This Helps

- **Avoid re-running failed experiments** — Know what you've already tried
- **Measure progress** — Build failing at 2 hours is better than failing at 5 minutes
- **Preserve context** — GitHub Actions logs expire; your notes don't
- **Copy logs to `err.log`** — Easier to search/grep than terminal scrollback

---

## Troubleshooting

### Build fails with "undefined reference to `fork`"

The project uses `fork()` which doesn't exist on Windows. Options:
1. Use Cygwin (provides fork emulation)
2. Disable features that require fork
3. Patch code to use Windows alternatives

### Linker errors about `-lpthread`

Windows doesn't have libpthread. Options:
1. Use Cygwin (provides pthreads)
2. Use MSYS2's winpthreads: `mingw-w64-clang-x86_64-winpthreads`
3. Patch to use Windows threads API

### "No rule to make target" for `.exe`

The build system doesn't know it's targeting Windows. Check:
1. CMake's `CMAKE_SYSTEM_NAME` is set correctly
2. Autotools has correct `--host` flag
3. Build scripts detect Windows properly

### DLL not found at runtime

For Cygwin builds, ensure all required DLLs are bundled:
```bash
# Find dependencies
ldd output/bin/myapp.exe | grep cyg
```

---

## Last Resort: WSL Fallback

If all Windows build strategies fail and a native binary truly cannot be produced, the final fallback is to **not provide a Windows binary** and instead guide users to WSL.

### Implementation in hostdb

In `sources.json`, mark the platform as unsupported with a note:

```json
{
  "win32-x64": {
    "sourceType": "unsupported",
    "note": "Windows native build not possible. Use WSL with linux-x64 binary."
  }
}
```

### Implementation in SpinDB (CLI consumer)

When a user requests a database that has no Windows binary:

```typescript
// Example CLI handling
if (platform === 'win32-x64' && !release.platforms['win32-x64']) {
  console.warn(`
⚠️  Windows binary unavailable for ${database} ${version}

This database does not support native Windows builds.

Recommended alternatives:
  1. Use WSL (Windows Subsystem for Linux):
     wsl --install
     # Then run spindb inside WSL

  2. Use Docker Desktop for Windows:
     docker run -p 5432:5432 ${database}:${version}

  3. Use a Linux VM or remote server

The linux-x64 binary works in WSL without modification.
`);
  process.exit(1);
}
```

### When to Use This

Only after exhausting:
1. ✗ Official Windows binaries (none available)
2. ✗ Third-party Windows builds (none trusted)
3. ✗ Cygwin build (failed or impractical)
4. ✗ MSYS2 CLANG64/MINGW64 build (failed)
5. ✗ Cross-compilation from Linux (failed)

Document the failure in this file for future reference — someone may find a solution later.

---

## Code References

### Valkey Cygwin Build (Working Example)

**File:** `.github/workflows/release-valkey.yml`

**Cygwin setup:**
```yaml
- name: Setup Cygwin
  uses: cygwin/cygwin-install-action@master
  with:
    packages: >-
      make
      gcc-core
      gcc-g++
      libssl-devel
      pkg-config
      zip
      curl
```

**Build shell configuration:**
```yaml
shell: C:\cygwin\bin\bash.exe --login -eo pipefail -o igncr '{0}'
env:
  CYGWIN: winsymlinks:native
```

**Key patches applied:**
```bash
# Enable GNU extensions in dlfcn.h (exposes Dl_info and dladdr)
sed -i 's/\_\_GNU\_VISIBLE/1/' /usr/include/dlfcn.h

# Remove module_tests from build (not supported on Windows)
sed -i 's/all: \(.*\) module_tests$/all: \1/' src/Makefile

# Remove -rdynamic flag (Cygwin linker doesn't support it)
sed -i 's/-rdynamic//' src/Makefile
```

**Build command:**
```bash
make -j$(nproc) BUILD_TLS=yes CFLAGS="-Wno-char-subscripts -O0"
```

**Bundling Cygwin DLLs:**
```bash
cp /usr/bin/cygwin1.dll valkey/bin/
cp /usr/bin/cygssl-3.dll valkey/bin/
cp /usr/bin/cygcrypto-3.dll valkey/bin/
cp /usr/bin/cygz.dll valkey/bin/
cp /usr/bin/cyggcc_s-seh-1.dll valkey/bin/
```

**Packaging (zip for Windows):**
```bash
zip -r "../dist/valkey-${VERSION}-${PLATFORM}.zip" valkey
```

---

### ClickHouse MSYS2 CLANG64 Build (Experimental)

**Files:**
- `.github/workflows/release-clickhouse.yml` - Workflow that calls build script
- `builds/clickhouse/build-windows.sh` - Main build script with all patches

**Architecture:** The workflow sets up MSYS2 CLANG64, then calls the build script:

```yaml
# Workflow calls the build script (single source of truth)
- name: Build ClickHouse (MSYS2 CLANG64 - EXPERIMENTAL)
  shell: msys2 {0}
  run: |
    ./builds/clickhouse/build-windows.sh \
      --version "$VERSION" \
      --build-dir "$GITHUB_WORKSPACE/clickhouse-build" \
      --output-dir "$GITHUB_WORKSPACE/dist"
```

**Key patches in build-windows.sh (11+ patches):**
1. `cmake/arch.cmake` - AMD64 uppercase detection
2. `cmake/target.cmake` - Windows OS support
3. `PreLoad.cmake` - Allow custom CMAKE_CXX_FLAGS
4. `CMakeLists.txt` - Add find_package(Threads)
5. LLVM TargetParser - NO_ERROR macro conflict
6. OpenSSL cmake - Disable ASM, remove POSIX sources
7. OpenSSL bn_div.c - Disable broken inline assembly
8. zlib-ng - Disable posix_memalign
9. boost-cmake - Windows PE assembly files
10. cmake/git.cmake - Skip slow git status
11. libarchive - Windows crypto headers and config

**Fake POSIX headers created:**
- `endian.h`, `sys/uio.h`, `sys/mman.h`, `sys/utsname.h`, `sys/wait.h`
- `sys/ioctl.h`, `spawn.h`, `poll.h`, `langinfo.h`, `grp.h`, `pwd.h`

**CMake configuration (see build-windows.sh for full list):**
- Uses `-include compat_windows.h` for POSIX stubs
- Uses `-isystem compat_headers` for fake system headers
- Disables 20+ features (jemalloc, S3, gRPC, Kafka, etc.)

**Output:** Native `.exe` without Cygwin DLLs

---

### Key Differences in Binary Extraction

| Aspect | Cygwin (Valkey) | MSYS2 CLANG64 (ClickHouse) |
|--------|-----------------|----------------------------|
| **Output format** | `.exe` + Cygwin DLLs | Native `.exe` only |
| **Archive format** | `.zip` | `.zip` |
| **DLL bundling** | Required (`cygwin1.dll`, etc.) | Not needed |
| **Binary location** | `make install` to PREFIX | CMake build directory |
| **Symlinks** | Not typically used | May need `.exe` copies |

### Archive Format by Platform

```bash
# Unix platforms: tar.gz
tar -czvf "database-${VERSION}-${PLATFORM}.tar.gz" database

# Windows: zip (native convention)
zip -r "database-${VERSION}-${PLATFORM}.zip" database
```

---

## When Developing on a Windows VM

For complex Windows builds like ClickHouse, iterating via GitHub Actions is too slow (each run can take hours). Instead, develop locally on a Windows machine or VM.

### Setup

Databases with local build scripts (e.g., ClickHouse) provide a PowerShell launcher:

```powershell
cd C:\Users\Bob\hostdb\builds\clickhouse
.\build-windows.ps1 -Version 25.12.3.21
```

The launcher automatically installs MSYS2 and required packages on first run.

### What Gets Cached

After the first run, subsequent builds are much faster:

| Step | First run | Subsequent runs |
|------|-----------|-----------------|
| MSYS2 install | ~5 min | Skipped |
| Package install | ~5-10 min | Skipped (detected) |
| Git clone + submodules | ~10-20 min | Skipped (reuses source) |
| Patches | ~30 sec | ~30 sec |
| CMake configure | ~5-10 min | ~5-10 min |
| Ninja build | Hours (until failure) | Hours (until failure) |

You save **20-35 minutes** of setup on each iteration. The main time sink becomes the compile step.

### Iteration Workflow

1. **First attempt** - Full build, will likely fail somewhere:
   ```powershell
   .\build-windows.ps1 -Version 25.12.3.21
   ```

2. **Test cmake changes quickly** - Only configure, skip compile:
   ```powershell
   .\build-windows.ps1 -Version 25.12.3.21 -ConfigureOnly
   ```

3. **Re-run after editing patches** - Just run again (source is reused automatically):
   ```powershell
   .\build-windows.ps1 -Version 25.12.3.21
   ```

4. **Clean rebuild** - Remove cached source and start fresh:
   ```powershell
   .\build-windows.ps1 -Version 25.12.3.21 -Clean
   ```

### Tips

- **Use `-ConfigureOnly`** to quickly validate cmake changes without waiting for compile
- **Source is reused automatically** - no flag needed, just re-run the script
- **Track progress** in `<database>-windows-build-log.md` (see "Iterating on Build Failures" above)
- **Edit the `.sh` script directly** - patches are in `build-windows.sh`, not the workflow
- **Sync with CI** - After successful local build, copy patches back to the GitHub workflow

### Syncing Local Changes with GitHub Actions

The GitHub Actions workflow now **calls the same build script** (`builds/<db>/build-windows.sh`) that you use locally. This means:

1. **No manual syncing needed** - Changes to `build-windows.sh` automatically apply to CI
2. **Single source of truth** - All patches live in the build script, not duplicated in the workflow
3. **Test locally first** - Your local build and CI use identical code

To test in CI after local changes:
1. Commit your changes to `builds/<db>/build-windows.sh`
2. Push to a branch and run the workflow
3. Select `win32-x64` in the workflow dispatch dropdown to test just Windows

---

## References

- [Cygwin](https://www.cygwin.com/) - POSIX compatibility layer
- [MSYS2](https://www.msys2.org/) - Software distribution and building platform
- [redis-windows](https://github.com/redis-windows/redis-windows) - Inspiration for Valkey Cygwin build
- [MinGW-w64](https://www.mingw-w64.org/) - GCC for Windows
- [Zig Cross-Compilation](https://ziglang.org/learn/overview/#cross-compiling-made-easy)
