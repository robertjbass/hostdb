#!/bin/bash
# build-windows.sh - Build ClickHouse for Windows using MSYS2 CLANG64
#
# Usage:
#   ./build-windows.sh --version 25.12.3.21
#   ./build-windows.sh --version 25.12.3.21 --clean
#   ./build-windows.sh --version 25.12.3.21 --skip-clone
#   ./build-windows.sh --version 25.12.3.21 --configure-only
#
# Requirements:
#   - Run this script from MSYS2 CLANG64 terminal (not MSYS or MINGW64)
#   - Install dependencies first: see README.md
#
# Build log tracking:
#   Create clickhouse-windows-build-log.md to track iterations.
#   See WINDOWS_BUILD.md for the recommended format.

set -e  # Exit on error

# Default values
VERSION=""
CLEAN=false
CONFIGURE_ONLY=false
# Use Windows home explicitly (MSYS2 $HOME is /home/Bob, not /c/Users/Bob)
BUILD_DIR="/c/Users/$USER/clickhouse-build"
OUTPUT_DIR="$(pwd)/dist"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
    cat << 'EOF'
ClickHouse Windows Build Script (MSYS2 CLANG64)

Usage:
  ./build-windows.sh --version <VERSION> [OPTIONS]

Options:
  --version <VERSION>   ClickHouse version to build (required)
                        Example: 25.12.3.21
  --clean               Remove existing source and start fresh
  --configure-only      Only run cmake configure, don't build
  --build-dir <DIR>     Build directory (default: ./clickhouse-build)
  --output-dir <DIR>    Output directory for artifacts (default: ./dist)
  --help                Show this help message

The script automatically detects and reuses existing source code.
Use --clean to force a fresh clone.

Examples:
  # Full build (reuses existing source if present)
  ./build-windows.sh --version 25.12.3.21

  # Clean rebuild (removes cached source)
  ./build-windows.sh --version 25.12.3.21 --clean

  # Just configure to check cmake errors
  ./build-windows.sh --version 25.12.3.21 --configure-only

Requirements:
  Run from MSYS2 CLANG64 terminal with these packages installed:
    pacman -S mingw-w64-clang-x86_64-{clang,lld,cmake,ninja,openssl,zlib,zstd,lz4,xz,libxml2,python,nasm} git zip

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            VERSION="$2"
            shift 2
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --configure-only)
            CONFIGURE_ONLY=true
            shift
            ;;
        --build-dir)
            BUILD_DIR="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        --)
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate inputs
if [ -z "$VERSION" ]; then
    log_error "Version is required"
    show_help
    exit 1
fi

# Check environment
if [ "$MSYSTEM" != "CLANG64" ]; then
    log_error "This script must be run from MSYS2 CLANG64 terminal"
    log_error "Current MSYSTEM: ${MSYSTEM:-not set}"
    log_error "Launch 'MSYS2 CLANG64' from Start menu"
    exit 1
fi

echo "=========================================="
echo "ClickHouse Windows Build Script"
echo "=========================================="
echo "Version:      $VERSION"
echo "Build dir:    $BUILD_DIR"
echo "Output dir:   $OUTPUT_DIR"
echo "Clean:        $CLEAN"
echo "Config only:  $CONFIGURE_ONLY"
echo "MSYSTEM:      $MSYSTEM"
echo "=========================================="
echo ""

# Record start time
START_TIME=$(date +%s)

# Check dependencies
log_info "Checking dependencies..."
for cmd in clang clang++ cmake ninja git zip python; do
    if ! command -v $cmd &> /dev/null; then
        log_error "Missing dependency: $cmd"
        log_error "Install with: pacman -S mingw-w64-clang-x86_64-<package>"
        exit 1
    fi
done
log_success "All dependencies found"

echo ""
log_info "Clang version:"
clang --version | head -1

echo ""
log_info "CMake version:"
cmake --version | head -1

# Create directories
mkdir -p "$BUILD_DIR"
mkdir -p "$OUTPUT_DIR"
cd "$BUILD_DIR"

# Clone or clean source
if [ "$CLEAN" = true ]; then
    log_info "Cleaning existing source..."
    rm -rf ClickHouse
fi

if [ -d "ClickHouse" ] && [ -f "ClickHouse/CMakeLists.txt" ]; then
    log_info "Using existing source (use --clean to re-clone)"
    rm -rf ClickHouse/build
else
    log_info "Cloning ClickHouse v${VERSION}-stable..."
    log_info "This may take a while (large repo with submodules)..."
    rm -rf ClickHouse
    git clone --depth 1 --branch "v${VERSION}-stable" \
        --recurse-submodules --shallow-submodules \
        https://github.com/ClickHouse/ClickHouse.git
fi

cd ClickHouse

# =============================================================================
# PATCHES - All the Windows compatibility patches
# =============================================================================

echo ""
log_info "Applying Windows compatibility patches..."

# -----------------------------------------------------------------------------
# Patch 1: cmake/arch.cmake - AMD64 uppercase detection
# -----------------------------------------------------------------------------
log_info "Patch 1: cmake/arch.cmake (AMD64 uppercase)"
sed -i 's/"amd64|x86_64"/"amd64|AMD64|x86_64"/g' cmake/arch.cmake
if grep -q "AMD64" cmake/arch.cmake; then
    log_success "arch.cmake patched"
else
    log_warn "arch.cmake patch may have failed"
fi

# -----------------------------------------------------------------------------
# Patch 2: cmake/target.cmake - Windows OS support
# -----------------------------------------------------------------------------
log_info "Patch 2: cmake/target.cmake (Windows OS support)"
WINDOWS_PATCH='elseif (CMAKE_SYSTEM_NAME MATCHES "Windows")\n    # Only set OS_WINDOWS as CMake var - NOT OS_LINUX (avoids Linux cmake includes)\n    set (OS_WINDOWS 1)\n    # But define OS_LINUX for preprocessor so C++ code compiles\n    add_definitions(-D OS_LINUX)\n    add_definitions(-D OS_WINDOWS)\nelse ()'
sed -i "s/^else ()$/${WINDOWS_PATCH}/" cmake/target.cmake
if grep -q "OS_WINDOWS" cmake/target.cmake; then
    log_success "target.cmake patched"
else
    log_warn "target.cmake patch may have failed"
fi

# -----------------------------------------------------------------------------
# Patch 3: PreLoad.cmake - Allow custom CMAKE_CXX_FLAGS
# -----------------------------------------------------------------------------
log_info "Patch 3: PreLoad.cmake (allow custom flags)"
sed -i 's/message(FATAL_ERROR/message(WARNING/' PreLoad.cmake
log_success "PreLoad.cmake patched"

# -----------------------------------------------------------------------------
# Patch 4: CMakeLists.txt - Add find_package(Threads)
# -----------------------------------------------------------------------------
log_info "Patch 4: CMakeLists.txt (Threads package)"
if ! grep -q "find_package(Threads REQUIRED)" CMakeLists.txt; then
    sed -i '/^project(/a\\n# Added for Windows build - create Threads::Threads target\nset(THREADS_PREFER_PTHREAD_FLAG ON)\nfind_package(Threads REQUIRED)\n' CMakeLists.txt
    log_success "CMakeLists.txt patched"
else
    log_info "CMakeLists.txt already patched"
fi

# -----------------------------------------------------------------------------
# Patch 5: LLVM TargetParser - NO_ERROR macro conflict
# -----------------------------------------------------------------------------
log_info "Patch 5: LLVM TargetParser (NO_ERROR macro conflict)"
LLVM_TARGET_PARSER="contrib/llvm-project/llvm/include/llvm/TargetParser/TargetParser.h"
if [ -f "$LLVM_TARGET_PARSER" ]; then
    sed -i 's/NO_ERROR/FEATURE_NO_ERROR/g' "$LLVM_TARGET_PARSER"
    sed -i 's/NO_ERROR/FEATURE_NO_ERROR/g' contrib/llvm-project/llvm/lib/TargetParser/TargetParser.cpp
    log_success "LLVM TargetParser patched"
else
    log_warn "LLVM TargetParser not found"
fi

# -----------------------------------------------------------------------------
# Patch 6: OpenSSL cmake - Force Windows target, disable ASM
# -----------------------------------------------------------------------------
log_info "Patch 6: OpenSSL cmake (Windows target, no ASM)"
OPENSSL_CMAKE="contrib/openssl-cmake/CMakeLists.txt"
if [ -f "$OPENSSL_CMAKE" ]; then
    # Force mingw64 target on Windows
    if ! grep -q "OPENSSL_TARGET_FORCE_WINDOWS" "$OPENSSL_CMAKE"; then
        sed -i '/project(/a\\n# OPENSSL_TARGET_FORCE_WINDOWS\nif (WIN32)\n  if (NOT OPENSSL_TARGET)\n    set(OPENSSL_TARGET "mingw64")\n  endif()\nendif()\n' "$OPENSSL_CMAKE"
    fi

    # Add Windows branch with no ASM using Python
    python -c '
from pathlib import Path
import re
path = Path("contrib/openssl-cmake/CMakeLists.txt")
text = path.read_text()
marker = "# OPENSSL_WINDOWS_NO_ASM"
if marker not in text:
    arch_start = text.find("if(ARCH_AMD64)")
    arch_end = text.find("elseif(ARCH_AARCH64)", arch_start)
    if arch_start != -1 and arch_end != -1:
        block = text[arch_start:arch_end]
        pattern = r"\n\s*else\(\)\n\s*set\(PLATFORM_DIRECTORY linux_x86_64\)\n\s*add_definitions\("
        replacement = ("\n    elseif(OS_WINDOWS)\n        " + marker + "\n        set(PLATFORM_DIRECTORY linux_x86_64)\n        add_definitions(-DOPENSSL_NO_ASM -DOPENSSL_NO_BN_ASM -DNOCRYPT -DOPENSSL_NO_DSO -DOPENSSL_NO_ASYNC -DOPENSSL_NO_POSIX_IO -DL_ENDIAN)\n    else()\n        set(PLATFORM_DIRECTORY linux_x86_64)\n        add_definitions(")
        new_block, count = re.subn(pattern, replacement, block, count=1)
        if count:
            text = text[:arch_start] + new_block + text[arch_end:]
            # Remove POSIX-only DSO sources
            for posix_file in ["crypto/dso/dso_dlfcn.c", "dso/dso_dlfcn.c", "crypto/dso/dso_dl.c", "dso/dso_dl.c"]:
                text = text.replace(posix_file, "")
            # Remove ELF asm sources
            text = re.sub(r"\n\s*asm/[^\s]+\.(s|S)\s*", "\n", text)
            # Remove inline-asm C sources under asm/
            text = re.sub(r"\n\s*[^\s]*asm/[^\s]+\.c\s*", "\n", text)
            # Remove RIO socket files
            text = re.sub(r"\n\s*ssl/rio/[^\s]+\.c\s*", "\n", text)
            path.write_text(text)
'

    if grep -q "OPENSSL_WINDOWS_NO_ASM" "$OPENSSL_CMAKE"; then
        log_success "OpenSSL cmake patched"
    else
        log_warn "OpenSSL cmake patch may have failed, applying fallback..."
        sed -i 's/-D[A-Z0-9_]*_ASM//g' "$OPENSSL_CMAKE"
        sed -i 's/-DOPENSSL_BN_ASM_[A-Z0-9_]*//g' "$OPENSSL_CMAKE"
        sed -i 's/-DOPENSSL_CPUID_OBJ//g' "$OPENSSL_CMAKE"
        sed -i 's/-DOPENSSL_IA32_SSE2//g' "$OPENSSL_CMAKE"
    fi

    # Verify cleanups
    sed -i 's/dso_dlfcn\.c//g' "$OPENSSL_CMAKE"
    sed -i -E 's/asm\/[^ ]+\.(s|S)//g' "$OPENSSL_CMAKE"
    sed -i 's|ssl/rio/[^ ]*\.c||g' "$OPENSSL_CMAKE"
else
    log_warn "OpenSSL cmake not found"
fi

# -----------------------------------------------------------------------------
# Patch 7: OpenSSL bn_div.c - Disable broken inline assembly
# -----------------------------------------------------------------------------
log_info "Patch 7: OpenSSL bn_div.c (disable inline asm)"
OPENSSL_BN_DIV="contrib/openssl/crypto/bn/bn_div.c"
if [ -f "$OPENSSL_BN_DIV" ]; then
    if ! grep -q "Disable broken inline asm" "$OPENSSL_BN_DIV"; then
        sed -i '/#if defined(SIXTY_FOUR_BIT_LONG)/i\/* Disable broken inline asm on Windows - must be after includes */\n#undef SIXTY_FOUR_BIT_LONG\n#undef SIXTY_FOUR_BIT\n' "$OPENSSL_BN_DIV"
    fi
    if grep -q "Disable broken inline asm" "$OPENSSL_BN_DIV"; then
        log_success "bn_div.c patched"
    else
        log_warn "bn_div.c patch may have failed"
    fi
else
    log_warn "bn_div.c not found"
fi

# -----------------------------------------------------------------------------
# Patch 8: zlib-ng - Disable posix_memalign
# -----------------------------------------------------------------------------
log_info "Patch 8: zlib-ng (disable posix_memalign)"
ZLIB_CMAKE="contrib/zlib-ng-cmake/CMakeLists.txt"
if [ -f "$ZLIB_CMAKE" ]; then
    sed -i 's/-DHAVE_POSIX_MEMALIGN//g' "$ZLIB_CMAKE"
    log_success "zlib-ng patched"
else
    log_warn "zlib-ng cmake not found"
fi

# -----------------------------------------------------------------------------
# Patch 9: boost-cmake - Windows assembly files
# -----------------------------------------------------------------------------
log_info "Patch 9: boost-cmake (Windows assembly)"
BOOST_CMAKE="contrib/boost-cmake/CMakeLists.txt"
if [ -f "$BOOST_CMAKE" ]; then
    sed -i 's/jump_x86_64_sysv_elf_gas\.S/jump_x86_64_ms_pe_clang_gas.S/g' "$BOOST_CMAKE"
    sed -i 's/make_x86_64_sysv_elf_gas\.S/make_x86_64_ms_pe_clang_gas.S/g' "$BOOST_CMAKE"
    sed -i 's/ontop_x86_64_sysv_elf_gas\.S/ontop_x86_64_ms_pe_clang_gas.S/g' "$BOOST_CMAKE"
    sed -i 's|context/src/posix/stack_traits\.cpp|context/src/windows/stack_traits.cpp|g' "$BOOST_CMAKE"
    log_success "boost-cmake patched"
else
    log_warn "boost-cmake not found"
fi

# -----------------------------------------------------------------------------
# Patch 10: cmake/git.cmake - Skip slow git status on Windows
# -----------------------------------------------------------------------------
log_info "Patch 10: cmake/git.cmake (skip slow git status)"
GIT_CMAKE="cmake/git.cmake"
if [ -f "$GIT_CMAKE" ]; then
    # Replace git.cmake with a version that hardcodes values instead of running slow git commands
    cat > "$GIT_CMAKE" << 'GITCMAKE_EOF'
# Patched for Windows: Skip slow git operations and hardcode values
# Original runs git status which takes 10+ minutes with 100+ submodules

set(GIT_HASH "windows-build")
set(GIT_BRANCH "v${VERSION}-stable")
set(GIT_DATE "2025-01-15")
set(GIT_COMMIT_SUBJECT "Windows build")

message(STATUS "Git info (hardcoded for Windows): ${GIT_HASH}")
GITCMAKE_EOF
    # Substitute VERSION variable
    sed -i "s/\${VERSION}/${VERSION}/g" "$GIT_CMAKE"
    log_success "git.cmake patched (skipping slow git status)"
else
    log_warn "git.cmake not found"
fi

# -----------------------------------------------------------------------------
# Patch 11: libarchive - Add Windows headers for crypto API
# -----------------------------------------------------------------------------
log_info "Patch 11: libarchive (Windows crypto headers)"
ARCHIVE_RANDOM="contrib/libarchive/libarchive/archive_random.c"
if [ -f "$ARCHIVE_RANDOM" ]; then
    # Add windows.h include before the first #include (after license comment)
    if ! grep -q "Added for Windows build" "$ARCHIVE_RANDOM"; then
        sed -i '/#include/i\/* Added for Windows build - include crypto headers */\n#ifdef _WIN32\n#include <windows.h>\n#include <wincrypt.h>\n#endif\n' "$ARCHIVE_RANDOM"
    fi
    log_success "archive_random.c patched"
else
    log_warn "archive_random.c not found"
fi

# Also patch archive_cryptor.c which may use similar APIs
ARCHIVE_CRYPTOR="contrib/libarchive/libarchive/archive_cryptor.c"
if [ -f "$ARCHIVE_CRYPTOR" ]; then
    if ! grep -q "Added for Windows build" "$ARCHIVE_CRYPTOR"; then
        sed -i '/#include/i\/* Added for Windows build - include crypto headers */\n#ifdef _WIN32\n#include <windows.h>\n#include <wincrypt.h>\n#include <bcrypt.h>\n#endif\n' "$ARCHIVE_CRYPTOR"
    fi
    log_success "archive_cryptor.c patched"
else
    log_warn "archive_cryptor.c not found"
fi

# Patch archive_util.c which also uses Windows crypto
ARCHIVE_UTIL="contrib/libarchive/libarchive/archive_util.c"
if [ -f "$ARCHIVE_UTIL" ]; then
    if ! grep -q "Added for Windows build" "$ARCHIVE_UTIL"; then
        sed -i '/#include/i\/* Added for Windows build - include crypto headers */\n#ifdef _WIN32\n#include <windows.h>\n#include <wincrypt.h>\n#endif\n' "$ARCHIVE_UTIL"
    fi
    log_success "archive_util.c patched"
else
    log_warn "archive_util.c not found"
fi

# Patch libarchive-cmake config.h to disable HAVE_FCHMOD/HAVE_FCHOWN and HAVE_STRUCT_TM_TM_GMTOFF on Windows
LIBARCHIVE_CONFIG="contrib/libarchive-cmake/config.h"
if [ -f "$LIBARCHIVE_CONFIG" ]; then
    # Comment out HAVE_FCHMOD and HAVE_FCHOWN (Windows struct lacks fd member)
    sed -i 's/#define HAVE_FCHMOD 1/\/* #define HAVE_FCHMOD 1 *\/ \/\/ Disabled for Windows/g' "$LIBARCHIVE_CONFIG"
    sed -i 's/#define HAVE_FCHOWN 1/\/* #define HAVE_FCHOWN 1 *\/ \/\/ Disabled for Windows/g' "$LIBARCHIVE_CONFIG"
    # Comment out HAVE_STRUCT_TM_TM_GMTOFF (Windows struct tm lacks tm_gmtoff)
    sed -i 's/#define HAVE_STRUCT_TM_TM_GMTOFF 1/\/* #define HAVE_STRUCT_TM_TM_GMTOFF 1 *\/ \/\/ Disabled for Windows/g' "$LIBARCHIVE_CONFIG"
    log_success "libarchive config.h patched (disabled fchmod/fchown/tm_gmtoff)"
else
    log_warn "libarchive config.h not found"
fi

# Patch libarchive-cmake CMakeLists.txt to not compile POSIX filter_fork on Windows
LIBARCHIVE_CMAKE="contrib/libarchive-cmake/CMakeLists.txt"
if [ -f "$LIBARCHIVE_CMAKE" ]; then
    # Remove filter_fork_posix.c from the source list (Windows should only use filter_fork_windows.c)
    sed -i '/filter_fork_posix\.c/d' "$LIBARCHIVE_CMAKE"
    log_success "libarchive CMakeLists.txt patched (removed filter_fork_posix.c)"
else
    log_warn "libarchive CMakeLists.txt not found"
fi

# -----------------------------------------------------------------------------
# Create Windows compatibility header
# -----------------------------------------------------------------------------
log_info "Creating Windows compatibility header..."
cat > compat_windows.h << 'COMPAT_EOF'
#pragma once
#ifdef _WIN32

// Minimal POSIX compatibility stubs for Windows
// We intentionally do NOT include <windows.h> globally to avoid macro pollution
// (NO_ERROR, OPTIONAL, IN, OUT, etc. conflict with LLVM and other code)

#include <stddef.h>  // for size_t
#include <malloc.h>  // for _aligned_malloc, _aligned_free
#include <errno.h>   // for ENOMEM, EINVAL
#include <io.h>      // for _commit, _write
#include <stdarg.h>  // for va_list
#include <stdio.h>   // for vsnprintf

// endian.h compatibility - Windows is always little-endian on x86/x64
#ifndef _ENDIAN_H
#define _ENDIAN_H
#define __LITTLE_ENDIAN 1234
#define __BIG_ENDIAN 4321
#define __BYTE_ORDER __LITTLE_ENDIAN
#define LITTLE_ENDIAN __LITTLE_ENDIAN
#define BIG_ENDIAN __BIG_ENDIAN
#define BYTE_ORDER __BYTE_ORDER
// Byte swap macros
#define htole16(x) (x)
#define le16toh(x) (x)
#define htole32(x) (x)
#define le32toh(x) (x)
#define htole64(x) (x)
#define le64toh(x) (x)
#define htobe16(x) __builtin_bswap16(x)
#define be16toh(x) __builtin_bswap16(x)
#define htobe32(x) __builtin_bswap32(x)
#define be32toh(x) __builtin_bswap32(x)
#define htobe64(x) __builtin_bswap64(x)
#define be64toh(x) __builtin_bswap64(x)
#endif

// sysconf constants
#ifndef _SC_PAGESIZE
#define _SC_PAGESIZE 1
#endif
#ifndef _SC_NPROCESSORS_ONLN
#define _SC_NPROCESSORS_ONLN 2
#endif

// Simple stubs - use reasonable defaults instead of calling Windows API
static inline int getpagesize(void) { return 4096; }
static inline long sysconf(int name) {
    switch(name) {
        case _SC_PAGESIZE: return 4096;
        case _SC_NPROCESSORS_ONLN: return 4;
        default: return -1;
    }
}

// Signal stack stubs (not used on Windows)
#ifndef SIGSTKSZ
#define SIGSTKSZ 8192
#endif
typedef struct { void *ss_sp; int ss_flags; size_t ss_size; } stack_t;
static inline int sigaltstack(const stack_t *ss, stack_t *old_ss) {
    (void)ss; (void)old_ss; return 0;
}

// Signal set type for pthread_sigmask compatibility
// Windows MSYS2 only has _sigset_t, need to alias it
#include <sys/types.h>  // for _sigset_t
typedef _sigset_t sigset_t;

// POSIX user/group ID types (used by libarchive)
#ifndef _UID_T_DEFINED
#define _UID_T_DEFINED
typedef unsigned int uid_t;
typedef unsigned int gid_t;
typedef unsigned int id_t;  // Generic ID type
#endif

// ssize_t - signed size type for functions that return -1 on error
#ifndef _SSIZE_T_DEFINED
#define _SSIZE_T_DEFINED
typedef long long ssize_t;
#endif

// posix_memalign shim using Windows _aligned_malloc
// Note: memory must be freed with _aligned_free, not free()
// Prefer posix_memalign_free() when available.
static inline int posix_memalign(void **memptr, size_t alignment, size_t size) {
    if (!memptr || alignment == 0 || (alignment & (alignment - 1)) != 0 ||
        (alignment % sizeof(void *)) != 0) {
        return EINVAL;
    }
    *memptr = _aligned_malloc(size, alignment);
    return (*memptr) ? 0 : ENOMEM;
}
static inline void posix_memalign_free(void *ptr) { _aligned_free(ptr); }

// fsync -> _commit on Windows
static inline int fsync(int fd) { return _commit(fd); }

// dprintf implementation for Windows (write formatted string to fd)
static inline int dprintf(int fd, const char *fmt, ...) {
    char buf[4096];
    va_list args;
    va_start(args, fmt);
    int len = vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    if (len > 0) return _write(fd, buf, len);
    return len;
}

// timegm - convert struct tm to time_t in UTC (POSIX)
// Windows equivalent is _mkgmtime
#include <time.h>
static inline time_t timegm(struct tm *tm) {
    return _mkgmtime(tm);
}

// Filesystem stubs - Windows has different symlink APIs
static inline int symlink(const char *target, const char *linkpath) {
    (void)target; (void)linkpath;
    return -1;  // Stub - symlinks require special privileges on Windows
}

static inline int link(const char *oldpath, const char *newpath) {
    (void)oldpath; (void)newpath;
    return -1;  // Stub
}

static inline ssize_t readlink(const char *path, char *buf, size_t bufsiz) {
    (void)path; (void)buf; (void)bufsiz;
    return -1;  // Stub
}

static inline int lchmod(const char *path, unsigned int mode) {
    (void)path; (void)mode;
    return -1;  // Stub - lchmod not available on Windows
}

static inline int lchown(const char *path, uid_t owner, gid_t group) {
    (void)path; (void)owner; (void)group;
    return -1;  // Stub - ownership not meaningful on Windows
}

static inline int chown(const char *path, uid_t owner, gid_t group) {
    (void)path; (void)owner; (void)group;
    return -1;  // Stub - ownership not meaningful on Windows
}

// Note: fchown and fchmod are NOT defined here because libarchive's
// Windows-specific code tries to use them with a non-existent fd member.
// Let the compiler error on these rather than provide broken stubs.

// Thread-safe time functions - Windows uses _s suffix variants with swapped args
static inline struct tm *localtime_r(const time_t *timep, struct tm *result) {
    return localtime_s(result, timep) == 0 ? result : NULL;
}

static inline struct tm *gmtime_r(const time_t *timep, struct tm *result) {
    return gmtime_s(result, timep) == 0 ? result : NULL;
}

static inline char *ctime_r(const time_t *timep, char *buf) {
    // ctime_s takes (buf, size, timep) - size should be at least 26 bytes
    return ctime_s(buf, 26, timep) == 0 ? buf : NULL;
}

static inline char *asctime_r(const struct tm *tm, char *buf) {
    return asctime_s(buf, 26, tm) == 0 ? buf : NULL;
}

#endif // _WIN32
COMPAT_EOF
log_success "compat_windows.h created"

# Create fake system headers directory for missing POSIX headers
log_info "Creating fake POSIX headers..."
mkdir -p compat_headers

# Create fake endian.h
cat > compat_headers/endian.h << 'ENDIAN_EOF'
#pragma once
// Fake endian.h for Windows - always little-endian on x86/x64
#define __LITTLE_ENDIAN 1234
#define __BIG_ENDIAN 4321
#define __BYTE_ORDER __LITTLE_ENDIAN
#define LITTLE_ENDIAN __LITTLE_ENDIAN
#define BIG_ENDIAN __BIG_ENDIAN
#define BYTE_ORDER __BYTE_ORDER
#define htole16(x) (x)
#define le16toh(x) (x)
#define htole32(x) (x)
#define le32toh(x) (x)
#define htole64(x) (x)
#define le64toh(x) (x)
#define htobe16(x) __builtin_bswap16(x)
#define be16toh(x) __builtin_bswap16(x)
#define htobe32(x) __builtin_bswap32(x)
#define be32toh(x) __builtin_bswap32(x)
#define htobe64(x) __builtin_bswap64(x)
#define be64toh(x) __builtin_bswap64(x)
ENDIAN_EOF

# Create fake sys/uio.h (scatter/gather I/O - used by snappy)
mkdir -p compat_headers/sys
cat > compat_headers/sys/uio.h << 'UIO_EOF'
#pragma once
// Fake sys/uio.h for Windows - defines iovec for scatter/gather I/O
#include <stddef.h>

struct iovec {
    void  *iov_base;  // Base address
    size_t iov_len;   // Length
};
UIO_EOF

# Create fake sys/mman.h (memory mapping - used by snappy, stringzilla)
cat > compat_headers/sys/mman.h << 'MMAN_EOF'
#pragma once
// Fake sys/mman.h for Windows - memory mapping stubs
// These are no-ops since we don't actually use mmap in this build

#include <stddef.h>

#define PROT_READ   0x1
#define PROT_WRITE  0x2
#define PROT_EXEC   0x4
#define PROT_NONE   0x0

#define MAP_SHARED    0x01
#define MAP_PRIVATE   0x02
#define MAP_FIXED     0x10
#define MAP_ANONYMOUS 0x20
#define MAP_ANON      MAP_ANONYMOUS
#define MAP_FAILED    ((void *)-1)

// Stub implementations - return failure
static inline void *mmap(void *addr, size_t length, int prot, int flags, int fd, long offset) {
    (void)addr; (void)length; (void)prot; (void)flags; (void)fd; (void)offset;
    return MAP_FAILED;
}

static inline int munmap(void *addr, size_t length) {
    (void)addr; (void)length;
    return -1;
}

static inline int mprotect(void *addr, size_t len, int prot) {
    (void)addr; (void)len; (void)prot;
    return -1;
}

static inline int madvise(void *addr, size_t length, int advice) {
    (void)addr; (void)length; (void)advice;
    return -1;
}

#define MADV_NORMAL     0
#define MADV_RANDOM     1
#define MADV_SEQUENTIAL 2
#define MADV_WILLNEED   3
#define MADV_DONTNEED   4
MMAN_EOF

# Create fake sys/utsname.h (system information)
cat > compat_headers/sys/utsname.h << 'UTSNAME_EOF'
#pragma once
// Fake sys/utsname.h for Windows - system information stubs
#include <string.h>

struct utsname {
    char sysname[65];    // OS name
    char nodename[65];   // Network node hostname
    char release[65];    // OS release
    char version[65];    // OS version
    char machine[65];    // Hardware type
};

static inline int uname(struct utsname *buf) {
    if (!buf) return -1;
    // Return reasonable defaults for Windows
    strcpy(buf->sysname, "Windows");
    strcpy(buf->nodename, "localhost");
    strcpy(buf->release, "10.0");
    strcpy(buf->version, "Windows");
    strcpy(buf->machine, "x86_64");
    return 0;
}
UTSNAME_EOF

# Create fake sys/wait.h (process waiting)
cat > compat_headers/sys/wait.h << 'WAIT_EOF'
#pragma once
// Fake sys/wait.h for Windows - process wait stubs
// Note: We don't define waitpid() here because libarchive provides its own __la_waitpid

// Wait status macros (stubs)
#define WIFEXITED(status)   (((status) & 0x7f) == 0)
#define WEXITSTATUS(status) (((status) >> 8) & 0xff)
#define WIFSIGNALED(status) (((status) & 0x7f) != 0)
#define WTERMSIG(status)    ((status) & 0x7f)
#define WIFSTOPPED(status)  0
#define WSTOPSIG(status)    0

// Wait options
#define WNOHANG   1
#define WUNTRACED 2

// pid_t should be defined by sys/types.h
#include <sys/types.h>
WAIT_EOF

# Create fake sys/ioctl.h (device I/O control)
cat > compat_headers/sys/ioctl.h << 'IOCTL_EOF'
#pragma once
// Fake sys/ioctl.h for Windows - ioctl stubs

// ioctl is not available on Windows - stub returns error
static inline int ioctl(int fd, unsigned long request, ...) {
    (void)fd; (void)request;
    return -1;
}

// Common ioctl requests (won't work, but allows compilation)
#define TIOCGWINSZ 0x5413
#define TIOCSWINSZ 0x5414

struct winsize {
    unsigned short ws_row;
    unsigned short ws_col;
    unsigned short ws_xpixel;
    unsigned short ws_ypixel;
};
IOCTL_EOF

# Create fake spawn.h (process spawning)
cat > compat_headers/spawn.h << 'SPAWN_EOF'
#pragma once
// Fake spawn.h for Windows - posix_spawn stubs
// Windows uses CreateProcess instead

#include <sys/types.h>

typedef struct {
    int __dummy;
} posix_spawnattr_t;

typedef struct {
    int __dummy;
} posix_spawn_file_actions_t;

// Spawn attribute flags
#define POSIX_SPAWN_RESETIDS            0x01
#define POSIX_SPAWN_SETPGROUP           0x02
#define POSIX_SPAWN_SETSIGDEF           0x04
#define POSIX_SPAWN_SETSIGMASK          0x08
#define POSIX_SPAWN_SETSCHEDPARAM       0x10
#define POSIX_SPAWN_SETSCHEDULER        0x20

// All stubs return error - Windows uses different APIs
static inline int posix_spawn(int *pid, const char *path,
    const posix_spawn_file_actions_t *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[], char *const envp[]) {
    (void)pid; (void)path; (void)file_actions; (void)attrp; (void)argv; (void)envp;
    return -1;
}

static inline int posix_spawnp(int *pid, const char *file,
    const posix_spawn_file_actions_t *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[], char *const envp[]) {
    (void)pid; (void)file; (void)file_actions; (void)attrp; (void)argv; (void)envp;
    return -1;
}

static inline int posix_spawnattr_init(posix_spawnattr_t *attr) { (void)attr; return 0; }
static inline int posix_spawnattr_destroy(posix_spawnattr_t *attr) { (void)attr; return 0; }
static inline int posix_spawn_file_actions_init(posix_spawn_file_actions_t *actions) { (void)actions; return 0; }
static inline int posix_spawn_file_actions_destroy(posix_spawn_file_actions_t *actions) { (void)actions; return 0; }
SPAWN_EOF

# Create fake poll.h (I/O multiplexing)
cat > compat_headers/poll.h << 'POLL_EOF'
#pragma once
// Fake poll.h for Windows - poll() stubs
// Windows uses WSAPoll from winsock2.h instead

struct pollfd {
    int   fd;         // File descriptor
    short events;     // Requested events
    short revents;    // Returned events
};

// Poll event flags
#define POLLIN     0x0001
#define POLLPRI    0x0002
#define POLLOUT    0x0004
#define POLLERR    0x0008
#define POLLHUP    0x0010
#define POLLNVAL   0x0020
#define POLLRDNORM 0x0040
#define POLLRDBAND 0x0080
#define POLLWRNORM 0x0100
#define POLLWRBAND 0x0200

typedef unsigned long nfds_t;

// Stub - returns error
static inline int poll(struct pollfd *fds, nfds_t nfds, int timeout) {
    (void)fds; (void)nfds; (void)timeout;
    return -1;
}
POLL_EOF

# Create fake langinfo.h (locale information)
cat > compat_headers/langinfo.h << 'LANGINFO_EOF'
#pragma once
// Fake langinfo.h for Windows - locale information stubs

// nl_item type
typedef int nl_item;

// Common nl_langinfo constants
#define CODESET     0
#define D_T_FMT     1
#define D_FMT       2
#define T_FMT       3
#define AM_STR      4
#define PM_STR      5
#define DAY_1       6
#define DAY_2       7
#define DAY_3       8
#define DAY_4       9
#define DAY_5       10
#define DAY_6       11
#define DAY_7       12
#define ABDAY_1     13
#define MON_1       20
#define ABMON_1     32
#define RADIXCHAR   44
#define THOUSEP     45
#define YESEXPR     46
#define NOEXPR      47
#define CRNCYSTR    48

// Return reasonable defaults
static inline char *nl_langinfo(nl_item item) {
    switch (item) {
        case CODESET: return "UTF-8";
        case RADIXCHAR: return ".";
        case THOUSEP: return ",";
        default: return "";
    }
}
LANGINFO_EOF

# Create fake grp.h (group database - used by libarchive)
cat > compat_headers/grp.h << 'GRP_EOF'
#pragma once
// Fake grp.h for Windows - group database stubs
#include <stddef.h>

struct group {
    char   *gr_name;    // Group name
    char   *gr_passwd;  // Group password
    unsigned int gr_gid; // Group ID
    char  **gr_mem;     // Group members
};

static inline struct group *getgrgid(unsigned int gid) {
    (void)gid;
    return NULL;
}

static inline struct group *getgrnam(const char *name) {
    (void)name;
    return NULL;
}

// Thread-safe variants (return error, groups don't exist on Windows)
static inline int getgrgid_r(unsigned int gid, struct group *grp, char *buf,
                             size_t buflen, struct group **result) {
    (void)gid; (void)grp; (void)buf; (void)buflen;
    *result = NULL;
    return -1;
}

static inline int getgrnam_r(const char *name, struct group *grp, char *buf,
                             size_t buflen, struct group **result) {
    (void)name; (void)grp; (void)buf; (void)buflen;
    *result = NULL;
    return -1;
}
GRP_EOF

# Create fake pwd.h (password/user database - often needed with grp.h)
cat > compat_headers/pwd.h << 'PWD_EOF'
#pragma once
// Fake pwd.h for Windows - user database stubs
#include <stddef.h>

struct passwd {
    char   *pw_name;    // Username
    char   *pw_passwd;  // Password
    unsigned int pw_uid; // User ID
    unsigned int pw_gid; // Group ID
    char   *pw_gecos;   // Real name
    char   *pw_dir;     // Home directory
    char   *pw_shell;   // Shell program
};

static inline struct passwd *getpwuid(unsigned int uid) {
    (void)uid;
    return NULL;
}

static inline struct passwd *getpwnam(const char *name) {
    (void)name;
    return NULL;
}

// Thread-safe variants (return error, passwd entries don't exist on Windows)
static inline int getpwuid_r(unsigned int uid, struct passwd *pwd, char *buf,
                             size_t buflen, struct passwd **result) {
    (void)uid; (void)pwd; (void)buf; (void)buflen;
    *result = NULL;
    return -1;
}

static inline int getpwnam_r(const char *name, struct passwd *pwd, char *buf,
                             size_t buflen, struct passwd **result) {
    (void)name; (void)pwd; (void)buf; (void)buflen;
    *result = NULL;
    return -1;
}
PWD_EOF

log_success "Fake POSIX headers created"

echo ""
log_info "All patches applied!"

# =============================================================================
# CMAKE CONFIGURE
# =============================================================================

echo ""
log_info "Configuring with CMake..."
mkdir -p build && cd build

# Convert to Windows path - MSYS2 paths like /c/users/... don't work with clang.exe
COMPAT_HEADER="$(cygpath -m "$(pwd)/../compat_windows.h")"
COMPAT_HEADERS_DIR="$(cygpath -m "$(pwd)/../compat_headers")"

cmake .. \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_C_FLAGS="-include ${COMPAT_HEADER} -isystem ${COMPAT_HEADERS_DIR}" \
    -DCMAKE_CXX_FLAGS="-include ${COMPAT_HEADER} -isystem ${COMPAT_HEADERS_DIR}" \
    -DCMAKE_LINKER=ld.lld \
    -DLINKER_NAME=ld.lld \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
    -DCOMPILER_CACHE=disabled \
    -DENABLE_TESTS=OFF \
    -DENABLE_UTILS=OFF \
    -DENABLE_EMBEDDED_COMPILER=OFF \
    -DENABLE_RUST=OFF \
    -DUSE_STATIC_LIBRARIES=ON \
    -DENABLE_NURAFT=OFF \
    -DENABLE_JEMALLOC=OFF \
    -DENABLE_CLICKHOUSE_ODBC_BRIDGE=OFF \
    -DENABLE_CLICKHOUSE_LIBRARY_BRIDGE=OFF \
    -DENABLE_CLICKHOUSE_KEEPER=OFF \
    -DENABLE_CLICKHOUSE_KEEPER_CONVERTER=OFF \
    -DENABLE_CLICKHOUSE_SU=OFF \
    -DENABLE_CLICKHOUSE_DISKS=OFF \
    -DENABLE_LDAP=OFF \
    -DENABLE_ISA_L=OFF \
    -DENABLE_HDFS=OFF \
    -DENABLE_KAFKA=OFF \
    -DENABLE_NATS=OFF \
    -DENABLE_AMQPCPP=OFF \
    -DENABLE_CASSANDRA=OFF \
    -DENABLE_S3=OFF \
    -DENABLE_AZURE_BLOB_STORAGE=OFF \
    -DENABLE_GRPC=OFF \
    -DENABLE_MYSQL=OFF \
    -DENABLE_MONGODB=OFF \
    -DENABLE_POSTGRESQL=OFF \
    -DENABLE_LIBURING=OFF \
    -DENABLE_PARQUET=OFF \
    -DENABLE_SSH=OFF \
    -GNinja

if [ $? -ne 0 ]; then
    log_error "CMake configuration failed!"
    log_error "Check the error output above and update patches as needed."
    exit 1
fi

log_success "CMake configuration succeeded!"

if [ "$CONFIGURE_ONLY" = true ]; then
    echo ""
    log_info "Configure-only mode, skipping build."
    log_info "To build, run: cd $BUILD_DIR/ClickHouse/build && ninja clickhouse"
    exit 0
fi

# =============================================================================
# BUILD
# =============================================================================

echo ""
log_info "Building ClickHouse (this will take a long time)..."
log_info "You can watch progress with: ninja -j1 (sequential) or ninja (parallel)"

ninja clickhouse

if [ $? -ne 0 ]; then
    log_error "Build failed!"
    log_error "Check the error output above."
    log_error "Consider adding a new patch or disabling a feature."

    # Calculate elapsed time
    END_TIME=$(date +%s)
    ELAPSED=$((END_TIME - START_TIME))
    ELAPSED_MIN=$((ELAPSED / 60))

    echo ""
    log_info "Build failed after ${ELAPSED_MIN} minutes"
    log_info "Track this in clickhouse-windows-build-log.md for next iteration"
    exit 1
fi

log_success "Build succeeded!"

# =============================================================================
# PACKAGE
# =============================================================================

echo ""
log_info "Packaging..."

cd "$BUILD_DIR"
rm -rf install
mkdir -p install/clickhouse/bin

# Copy the clickhouse binary
if [ -f ClickHouse/build/programs/clickhouse.exe ]; then
    cp ClickHouse/build/programs/clickhouse.exe install/clickhouse/bin/
    log_info "Copied clickhouse.exe"
elif [ -f ClickHouse/build/programs/clickhouse ]; then
    cp ClickHouse/build/programs/clickhouse install/clickhouse/bin/
    log_info "Copied clickhouse (no .exe extension)"
else
    log_error "Could not find clickhouse binary!"
    ls -la ClickHouse/build/programs/ || true
    exit 1
fi

# Create symlinks/copies for subcommands
cd install/clickhouse/bin
if [ -f clickhouse.exe ]; then
    for cmd in server client local benchmark compressor format obfuscator; do
        cp clickhouse.exe clickhouse-${cmd}.exe
    done
else
    for cmd in server client local benchmark compressor format obfuscator; do
        cp clickhouse clickhouse-${cmd}
    done
fi
cd "$BUILD_DIR"

# Add metadata
cat > install/clickhouse/.hostdb-metadata.json << EOF
{
  "name": "clickhouse",
  "version": "${VERSION}",
  "platform": "win32-x64",
  "source": "source-build",
  "sourceUrl": "https://github.com/ClickHouse/ClickHouse",
  "rehosted_by": "hostdb",
  "rehosted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "Local MSYS2 CLANG64 build"
}
EOF

# Create zip
cd install
zip -r "$OUTPUT_DIR/clickhouse-${VERSION}-win32-x64.zip" clickhouse

echo ""
log_success "Build complete!"
ls -la "$OUTPUT_DIR/"

# Calculate elapsed time
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
ELAPSED_MIN=$((ELAPSED / 60))

echo ""
echo "=========================================="
echo "Build Summary"
echo "=========================================="
echo "Version:     $VERSION"
echo "Platform:    win32-x64"
echo "Duration:    ${ELAPSED_MIN} minutes"
echo "Output:      $OUTPUT_DIR/clickhouse-${VERSION}-win32-x64.zip"
echo "=========================================="
