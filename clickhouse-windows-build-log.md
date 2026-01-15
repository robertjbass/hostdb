# ClickHouse Windows Build Log

## Change History

| Change # | Time to Break | Phase | Error Summary | Status |
|----------|---------------|-------|---------------|--------|
| 1 | 25:36 | Compile (1866/9265) | `sigset_t` undefined in xz mythread.h | ✅ Fixed |
| 2 | 25:06 | Compile (1866/9265) | Same - compat header not applied to C files | ✅ Fixed |
| 3 | 27:19 | Compile (2195/9265) | boost.context using Unix/ELF asm instead of Windows/PE | ✅ Fixed |
| 4 | 30:06 | Compile (2235/9265) | replxx: `dprintf` and `fsync` undefined | ✅ Fixed |

---

## Iteration 4 - 2026-01-15

**Duration:** Failed at 30:06 (compile phase, 2235/9265 objects) - **+2:47 progress**

**Changes:** Patched boost.context to use Windows PE assembly and Windows stack_traits

**Errors:**
- `dprintf` - POSIX function to write formatted output to file descriptor
- `fsync` - POSIX function to sync file to disk

**Root Cause:**
- replxx library uses POSIX I/O functions not available on Windows
- Windows equivalents: `fsync` → `_commit()`, `dprintf` needs custom implementation

**Proposed Fix:**
Add to `compat_windows.h`:
```c
#include <io.h>      // for _commit, _write
#include <stdio.h>   // for vsnprintf
#include <stdarg.h>  // for va_list

// fsync -> _commit on Windows
static inline int fsync(int fd) { return _commit(fd); }

// dprintf implementation for Windows
static inline int dprintf(int fd, const char *fmt, ...) {
    char buf[4096];
    va_list args;
    va_start(args, fmt);
    int len = vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    if (len > 0) return _write(fd, buf, len);
    return len;
}
```

**Files to modify:**
- `.github/workflows/release-clickhouse.yml` (compat_windows.h generation)

**Next:** Re-run build

**Fix Applied:** Added `fsync` and `dprintf` stubs to compat_windows.h

---

## Iteration 3 - 2026-01-15

**Duration:** Failed at 27:19 (compile phase, 2195/9265 objects) - **+2:13 progress**

**Changes:** Added `CMAKE_C_FLAGS` to include compat header for C files

**Errors:**
1. `jump_x86_64_sysv_elf_gas.S` - ELF assembly directives (`.type`, `.size`, `.section .note.GNU-stack`) not supported on Windows/PE
2. `src/posix/stack_traits.cpp` - `'sys/resource.h' file not found`

**Root Cause:**
- boost.context CMake is selecting Unix/POSIX source files instead of Windows files
- Should use: `jump_x86_64_ms_pe_clang_gas.S` (Windows PE assembly)
- Should use: `src/windows/stack_traits.cpp` (Windows stack traits)
- Both `-D OS_LINUX` and `-D OS_WINDOWS` are defined, confusing platform detection

**Proposed Fix:**
Patch `contrib/boost-cmake/CMakeLists.txt` to use Windows-specific files:
```bash
# Replace SYSV ELF assembly with Windows PE assembly
sed -i 's/jump_x86_64_sysv_elf_gas\.S/jump_x86_64_ms_pe_clang_gas.S/g' contrib/boost-cmake/CMakeLists.txt
sed -i 's/make_x86_64_sysv_elf_gas\.S/make_x86_64_ms_pe_clang_gas.S/g' contrib/boost-cmake/CMakeLists.txt
sed -i 's/ontop_x86_64_sysv_elf_gas\.S/ontop_x86_64_ms_pe_clang_gas.S/g' contrib/boost-cmake/CMakeLists.txt

# Replace POSIX stack_traits with Windows stack_traits
sed -i 's|src/posix/stack_traits\.cpp|src/windows/stack_traits.cpp|g' contrib/boost-cmake/CMakeLists.txt
```

**Files to modify:**
- `.github/workflows/release-clickhouse.yml` (add sed patches before cmake configuration)

**Next:** Re-run build

**Fix Applied:** `.github/workflows/release-clickhouse.yml` lines 463-477

---

## Iteration 2 - 2026-01-15

**Duration:** Failed at 25:06 (compile phase, 1866/9265 objects)

**Changes:** Added `sigset_t` typedef to compat_windows.h

**Error:** Same as iteration 1 - `sigset_t` still undefined in xz mythread.h

**Root Cause:**
- The compat header was only included via `CMAKE_CXX_FLAGS`
- xz library is **C code** (`.c` files), not C++
- C files don't receive the `-include compat_windows.h` flag

**Fix Applied:**
Added `CMAKE_C_FLAGS` with the same include directive:
```yaml
-DCMAKE_C_FLAGS="-include ${COMPAT_HEADER}" \
-DCMAKE_CXX_FLAGS="-include ${COMPAT_HEADER}" \
```

**Next:** Re-run build

---

## Iteration 1 - 2026-01-15

**Duration:** Failed at 25:36 (compile phase, 1866/9265 objects)

**Changes:** Previous iteration's patches (unknown baseline)

**Error:**
```
D:/a/hostdb/hostdb/ClickHouse/contrib/xz/src/common/mythread.h:138:33: error: unknown type name 'sigset_t'; did you mean '_sigset_t'?
  138 | mythread_sigmask(int how, const sigset_t *restrict set,
```

**Root Cause:**
- The xz-utils library's `mythread.h` uses `sigset_t` for POSIX signal handling
- Build defines `-DMYTHREAD_POSIX` expecting full POSIX threading support
- Windows MSYS2 CLANG64 only has `_sigset_t` (underscore-prefixed variant)
- The `compat_windows.h` header is missing this typedef

**Proposed Fix:**
Add to `compat_windows.h` (around line 505, after the `sigaltstack` stub):

```c
// Signal set type for pthread_sigmask compatibility
// Windows MSYS2 only has _sigset_t, need to alias it
#include <sys/types.h>  // for _sigset_t
typedef _sigset_t sigset_t;
```

In workflow `release-clickhouse.yml`, add these lines after the `sigaltstack` stub (around line 505):

```bash
'' \
'// Signal set type for pthread_sigmask compatibility' \
'#include <sys/types.h>  // for _sigset_t' \
'typedef _sigset_t sigset_t;' \
```

**Files to modify:**
- `.github/workflows/release-clickhouse.yml` (compat_windows.h generation section, ~line 505)

**Next:** Re-run build to test fix

**Fix Applied:** `.github/workflows/release-clickhouse.yml` line 507-510
