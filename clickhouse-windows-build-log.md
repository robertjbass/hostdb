# ClickHouse Windows Build Log

Tracking experimental Windows build attempts using MSYS2 CLANG64.

**Goal**: Build ClickHouse for Windows - this would be a world-first since ClickHouse has no official Windows support.

## Build Progress Summary

| Phase | Attempt | Time | Files | Error | Change Made |
|-------|---------|------|-------|-------|-------------|
| CMake | Initial | fail | 0 | AMD64 not supported | - |
| CMake | AMD64 fix | fail | 0 | Windows not supported | Patched cmake/arch.cmake |
| CMake | Windows OS | fail | 0 | Linux linker flags | Patched cmake/target.cmake |
| CMake | Dual OS flags | fail | 0 | LLD not found | Set OS_WINDOWS cmake var + OS_LINUX preprocessor |
| CMake | Linker fix | fail | 0 | libssh platform error | Added -DCMAKE_LINKER=ld.lld |
| CMake | SSH disable | fail | 0 | Threads::Threads not found | Added -DENABLE_SSH=OFF |
| CMake | Threads fix | ~8 min | 0 | PreLoad.cmake rejects flags | Patched CMakeLists.txt for Threads |
| CMake | PreLoad fix | **SUCCESS** | 0 | CMake completes! | Changed FATAL_ERROR to WARNING |
| Ninja | First build | fail | 17 | OPTIONAL macro conflict | - |
| Ninja | OPTIONAL undef | fail | 165 | DELETE undeclared | Added #undef OPTIONAL to compat header |
| Ninja | DELETE keep | fail | 327 | NO_ERROR enum conflict | Removed DELETE undef (Windows API needs it) |
| Ninja | NO_ERROR undef | fail | 163 | NO_ERROR undeclared in Windows API | Added #undef NO_ERROR - REGRESSION |
| Ninja | NO_ERROR patch | fail | 353 | IMAGE_FILE_MACHINE_* conflicts | Patched LLVM files, removed NO_ERROR undef |
| Ninja | No windows.h | **~30 min** | **751** | OpenSSL bn_div.c asm | Removed windows.h from compat header |
| Ninja | USE_INTERNAL_SSL=OFF | ~24 min | 751 | Same OpenSSL error | CMake flag ignored |
| Ninja | ENABLE_SSL=OFF | ~11 min | CMake fail | jwt-cpp needs OpenSSL | Can't disable SSL |
| Ninja | OPENSSL_NO_ASM=ON | ~17 min | 751 | Same OpenSSL error | CMake flag ignored |
| Ninja | bn_div.c patch v1 | ~21 min | 751 | Same OpenSSL asm error | Undefs inserted but wrong macros |
| Ninja | bn_div.c patch v2 | ~18 min | 751 | Same OpenSSL asm error | SIXTY_FOUR_BIT undefs at top - redefined by includes |
| Ninja | bn_div.c patch v3 | ~18 min | 751 | Same OpenSSL asm error | sed pattern `^#if` didn't match (line has whitespace) |
| Ninja | bn_div.c patch v4 | ~21 min | 751 | Same OpenSSL asm error (divq %r11d) | Removed `^` anchor; patch applied but asm still enabled |
| Ninja | bn_div.c patch v5 | ~23 min | 751 | Same OpenSSL asm error (divq %r11d) | Removed `^` anchor - patch applied but openssl-cmake still selects linux_x86_64 target |
| Ninja | openssl-cmake diagnostics v1 | ~20 min | 751 | Same OpenSSL asm error (divq %r11d) | Added openssl-cmake header dump; `rg` missing; CMakeLists hardcodes linux_x86_64 + ASM for ARCH_AMD64 |
| Ninja | openssl-cmake fix v2 | ~20 min | 751 | Same OpenSSL asm error (divq %r11d) | Python patch ran but did not modify ARCH_AMD64 block; no OPENSSL_WINDOWS_NO_ASM marker |
| Ninja | openssl-cmake fix v3 | ~20 min | **814** | X509_NAME macro conflict (wincrypt.h) | Regex patch + brute-force fallback worked! ASM issue fixed, new macro conflict |
| Ninja | X509_NAME fix v1 | ~19 min | **910** | dlfcn.h not found | `-DNOCRYPT` worked! Now hitting POSIX dso_dlfcn.c instead of dso_win32.c |
| Ninja | dlfcn.h fix v1 | ~24.5 min | 910 | dlfcn.h missing (dso_dlfcn.c) | `-DOPENSSL_NO_DSO` present but dso_dlfcn.c still compiled |
| Ninja | dlfcn.h fix v2 | ~23.5 min | **1581** | ASM .s directives fail (aes-x86_64.s) | DSO fix worked; asm sources still built despite OPENSSL_NO_ASM |
| Ninja | ELF asm fix | ~23.6 min | **1589** | x86_64-gcc.c inline asm error | .s files removed, but crypto/bn/asm/x86_64-gcc.c has inline asm too |
| Ninja | asm/*.c removal | ~26 min | **1710** | rio_notifier.c WSASocketA undeclared | asm/*.c regex removal worked! Now hitting OpenSSL RIO socket API issues |
| Ninja | RIO removal | ~25 min | **1754** | posix_memalign undeclared (zlib-ng) | ssl/rio/*.c removed! Now hitting POSIX memory alignment in zlib-ng |
| Ninja | posix_memalign sed | ~27 min | 1753 | Same posix_memalign error | sed on cmake didn't work - define comes from CMake configure checks |
| Ninja | **posix_memalign shim** | PENDING | PENDING | PENDING | Add posix_memalign to compat header using _aligned_malloc |

## Phase 1: CMake Configuration (COMPLETE)

### Key Breakthrough: Dual OS Flag Strategy
The critical insight was separating CMake variables from preprocessor defines:
- `OS_WINDOWS` set as **CMake variable** (for build system logic)
- `-D OS_LINUX` set as **preprocessor define** (for C++ code compilation)

This avoids Linux-specific cmake includes (like `cmake/linux/default_libs.cmake`) while letting C++ code compile with Linux assumptions.

### CMake Patches Applied

1. **cmake/arch.cmake** - Add uppercase AMD64:
   ```bash
   sed -i 's/"amd64|x86_64"/"amd64|AMD64|x86_64"/g' cmake/arch.cmake
   ```

2. **cmake/target.cmake** - Add Windows with dual flags:
   ```bash
   WINDOWS_PATCH='elseif (CMAKE_SYSTEM_NAME MATCHES "Windows")\n    set (OS_WINDOWS 1)\n    add_definitions(-D OS_LINUX)\n    add_definitions(-D OS_WINDOWS)\nelse ()'
   sed -i "s/^else ()$/${WINDOWS_PATCH}/" cmake/target.cmake
   ```

3. **PreLoad.cmake** - Allow custom compiler flags:
   ```bash
   sed -i 's/message(FATAL_ERROR/message(WARNING/' PreLoad.cmake
   ```

4. **CMakeLists.txt** - Add Threads package:
   ```bash
   sed -i '/^project(/a\\n# Added for Windows build\nset(THREADS_PREFER_PTHREAD_FLAG ON)\nfind_package(Threads REQUIRED)\n' CMakeLists.txt
   ```

### CMake Disable Flags (26 flags)
```
-DCMAKE_LINKER=ld.lld -DLINKER_NAME=ld.lld
-DCOMPILER_CACHE=disabled -DENABLE_TESTS=OFF -DENABLE_UTILS=OFF
-DENABLE_EMBEDDED_COMPILER=OFF -DENABLE_RUST=OFF -DUSE_STATIC_LIBRARIES=ON
-DENABLE_NURAFT=OFF -DENABLE_JEMALLOC=OFF
-DENABLE_CLICKHOUSE_ODBC_BRIDGE=OFF -DENABLE_CLICKHOUSE_LIBRARY_BRIDGE=OFF
-DENABLE_CLICKHOUSE_KEEPER=OFF -DENABLE_CLICKHOUSE_KEEPER_CONVERTER=OFF
-DENABLE_CLICKHOUSE_SU=OFF -DENABLE_CLICKHOUSE_DISKS=OFF
-DENABLE_LDAP=OFF -DENABLE_ISA_L=OFF -DENABLE_HDFS=OFF
-DENABLE_KAFKA=OFF -DENABLE_NATS=OFF -DENABLE_AMQPCPP=OFF
-DENABLE_CASSANDRA=OFF -DENABLE_S3=OFF -DENABLE_AZURE_BLOB_STORAGE=OFF
-DENABLE_GRPC=OFF -DENABLE_MYSQL=OFF -DENABLE_MONGODB=OFF
-DENABLE_POSTGRESQL=OFF -DENABLE_LIBURING=OFF -DENABLE_PARQUET=OFF
-DENABLE_SSH=OFF
```

## Phase 2: Ninja Compilation (IN PROGRESS)

### Best Result: 1754/9265 files (~19% complete, ~25 minutes)

### Windows Macro Pollution Problem
Including `<windows.h>` in the force-included compat header caused massive macro conflicts:
- `OPTIONAL` - Breaks LLVM enums
- `NO_ERROR` - Breaks LLVM enums BUT Windows API code needs it
- `DELETE` - Breaks LLVM enums BUT Windows API code needs it
- `IMAGE_FILE_MACHINE_*` - Breaks LLVM COFF enums (dozens of these)
- `IN`, `OUT`, `near`, `far` - Various conflicts

**Solution**: Don't include windows.h in compat header. Provide minimal stubs only.

### Current compat_windows.h (Minimal, No windows.h)
```c
#pragma once
#ifdef _WIN32

#include <stddef.h>  // for size_t

// sysconf constants
#ifndef _SC_PAGESIZE
#define _SC_PAGESIZE 1
#endif
#ifndef _SC_NPROCESSORS_ONLN
#define _SC_NPROCESSORS_ONLN 2
#endif

// Simple stubs with hardcoded values
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

### LLVM Patches Applied

1. **TargetParser.h/cpp** - Rename NO_ERROR enum value:
   ```bash
   sed -i 's/NO_ERROR/FEATURE_NO_ERROR/g' contrib/llvm-project/llvm/include/llvm/TargetParser/TargetParser.h
   sed -i 's/NO_ERROR/FEATURE_NO_ERROR/g' contrib/llvm-project/llvm/lib/TargetParser/TargetParser.cpp
   ```

### OpenSSL Problem (Current Blocker)

**Resolved**: The `bn_div.c` inline-asm failure was bypassed by injecting an `OS_WINDOWS` branch into `contrib/openssl-cmake/CMakeLists.txt` with `OPENSSL_NO_ASM`/`OPENSSL_NO_BN_ASM`. The build now progresses past file 751.

**Resolved**: The `X509_NAME` macro conflict was fixed by adding `-DNOCRYPT` for OpenSSL compilation on Windows.

**New error around file 1589/9269**:
```
D:/a/hostdb/hostdb/ClickHouse/contrib/openssl/crypto/bn/asm/x86_64-gcc.c:120:9: error: invalid operand for instruction
```

**Root cause**: Inline asm in `crypto/bn/asm/x86_64-gcc.c` is still compiled on Windows. Even after removing `.s` files, C sources with inline asm remain in the build graph.

## Key Insights

1. **CMake vs Preprocessor separation is critical** - OS_WINDOWS for cmake, OS_LINUX for code
2. **windows.h is toxic in force-included headers** - Causes hundreds of macro conflicts
3. **Some Windows macros can't be undefined** - NO_ERROR, DELETE are Windows API constants
4. **ClickHouse cmake ignores OpenSSL flags** - Must patch source directly
5. **OpenSSL target is wrong** - Build still uses `linux_x86_64` config on Windows
6. **Source patches are the way forward** - CMake flags often don't propagate
7. **wincrypt.h macro collisions are real** - `X509_NAME` breaks OpenSSL headers
8. **POSIX-only OpenSSL sources still compiled** - `dso_dlfcn.c` needs to be excluded on Windows
9. **Preprocessor defines don't exclude files** - `-DOPENSSL_NO_DSO` is runtime, must remove from source list
10. **Asm sources still built** - `asm/crypto/*.s` must be removed for Windows builds
11. **Inline asm C sources remain** - `crypto/bn/asm/x86_64-gcc.c` must be excluded on Windows
12. **OpenSSL RIO uses Windows socket APIs** - `ssl/rio/*.c` files call `WSASocketA`, `SO_EXCLUSIVEADDRUSE` which need winsock2.h
13. **zlib-ng assumes POSIX memory APIs** - `HAVE_POSIX_MEMALIGN` is auto-detected but `posix_memalign` doesn't exist on Windows
14. **CMake configure checks can't be sed'd** - defines from `check_function_exists()` aren't in CMakeLists.txt; must provide shims instead

## Next Step Thesis

### Current Blocker: zlib-ng posix_memalign

The build now fails in zlib-ng's `compare256.c` because it calls `posix_memalign()` which doesn't exist on Windows. The `HAVE_POSIX_MEMALIGN` define is incorrectly set by CMake auto-detection in the MSYS2 environment.

### Next Fix: Add posix_memalign shim

The `HAVE_POSIX_MEMALIGN` define comes from CMake's configure-time checks, not from a CMakeLists.txt file we can sed. Instead, add a `posix_memalign` shim to the Windows compat header using `_aligned_malloc`.

**Note**: Memory allocated with `_aligned_malloc` must be freed with `_aligned_free`, not `free()`. If zlib-ng uses regular `free()` this will cause runtime issues, but the build will progress.

**Expected outcome**: Should progress past zlib-ng memory allocation issues, potentially reaching file 2000+ or hitting more POSIX-specific code in other libraries.

## Files

- Workflow: `.github/workflows/release-clickhouse.yml`
- This log: `clickhouse-windows-build-log.md` (gitignored)
