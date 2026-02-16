#!/usr/bin/env bash
# fix-macos-dylibs.sh — Bundle Homebrew dylibs and rewrite paths for relocatable macOS binaries
#
# Usage: ./builds/common/fix-macos-dylibs.sh <package-root>
#
# Takes a package directory (e.g. install/redis, install/mariadb) and:
#   1. Scans all Mach-O binaries for Homebrew dependencies
#   2. Recursively copies those dylibs into the package's lib/ directory
#   3. Rewrites all absolute paths to @loader_path relative references
#   4. Re-signs all modified binaries (required by macOS)
#   5. Verifies no Homebrew paths remain (fails CI if any found)
#
# Adapted from builds/postgresql-documentdb/build-macos.sh (steps 10-12).

set -euo pipefail

# ============================================================================
# Argument validation
# ============================================================================
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <package-root>"
    echo "Example: $0 \$GITHUB_WORKSPACE/install/redis"
    exit 1
fi

PACKAGE_ROOT="$1"

if [[ ! -d "$PACKAGE_ROOT" ]]; then
    echo "ERROR: Package root does not exist: $PACKAGE_ROOT"
    exit 1
fi

# Resolve to absolute path
PACKAGE_ROOT="$(cd "$PACKAGE_ROOT" && pwd)"

echo "=== fix-macos-dylibs: $PACKAGE_ROOT ==="

# ============================================================================
# Detect Homebrew prefixes
# ============================================================================
is_homebrew_path() {
    local path="$1"
    [[ "$path" == /opt/homebrew/* ]] || [[ "$path" == /usr/local/Cellar/* ]] || \
    [[ "$path" == /usr/local/opt/* ]] || [[ "$path" == /usr/local/lib/* ]]
}

is_system_lib() {
    local path="$1"
    [[ "$path" == /usr/lib/* ]] || [[ "$path" == /System/* ]]
}

# ============================================================================
# Phase 1: Bundle Homebrew dependencies
# ============================================================================
echo "Phase 1: Bundling Homebrew dependencies..."

LIB_DIR="${PACKAGE_ROOT}/lib"
mkdir -p "$LIB_DIR"

# Track processed libraries to avoid infinite recursion
PROCESSED_FILE=$(mktemp)
trap 'rm -f "$PROCESSED_FILE"' EXIT

is_processed() { grep -qxF "$1" "$PROCESSED_FILE" 2>/dev/null; }
mark_processed() { echo "$1" >> "$PROCESSED_FILE"; }

copy_lib_recursive() {
    local lib_path="$1"
    local lib_name
    lib_name=$(basename "$lib_path")

    if is_processed "$lib_name"; then return 0; fi
    mark_processed "$lib_name"

    # Skip system libraries and @-prefixed references we can't resolve
    if is_system_lib "$lib_path" || [[ "$lib_path" == "@"* ]]; then
        return 0
    fi

    if [[ ! -f "$lib_path" ]]; then return 0; fi

    # Copy Homebrew libraries into the package lib/
    if is_homebrew_path "$lib_path"; then
        if [[ ! -f "${LIB_DIR}/${lib_name}" ]]; then
            echo "  Bundling: ${lib_name}"
            cp -L "$lib_path" "${LIB_DIR}/${lib_name}" 2>/dev/null || true
        fi
    fi

    # Recursively process this library's dependencies
    local deps lib_dir
    lib_dir=$(dirname "$lib_path")
    deps=$(otool -L "$lib_path" 2>/dev/null | tail -n +2 | awk '{print $1}') || return 0

    for dep in $deps; do
        if is_system_lib "$dep"; then continue; fi

        if [[ "$dep" == @loader_path/* ]]; then
            local resolved="${lib_dir}/${dep#@loader_path/}"
            if [[ -f "$resolved" ]]; then copy_lib_recursive "$resolved"; fi
            continue
        fi

        if [[ "$dep" == @rpath/* ]]; then
            local rpath_lib="${dep#@rpath/}"
            local found=""
            for search_dir in "/opt/homebrew/lib" "/usr/local/lib" "$lib_dir" "$LIB_DIR"; do
                if [[ -f "${search_dir}/${rpath_lib}" ]]; then
                    found="${search_dir}/${rpath_lib}"
                    break
                fi
            done
            if [[ -n "$found" ]]; then copy_lib_recursive "$found"; fi
            continue
        fi

        if [[ "$dep" == "@"* ]]; then continue; fi
        if [[ -f "$dep" ]]; then copy_lib_recursive "$dep"; fi
    done
}

# Scan binaries in bin/
if [[ -d "${PACKAGE_ROOT}/bin" ]]; then
    for binary in "${PACKAGE_ROOT}/bin/"*; do
        [[ -f "$binary" ]] || continue
        file "$binary" | grep -q "Mach-O" || continue
        deps=$(otool -L "$binary" 2>/dev/null | tail -n +2 | awk '{print $1}') || continue
        for dep in $deps; do copy_lib_recursive "$dep"; done
    done
fi

# Scan dylibs in lib/ (and subdirectories) — loop until no new deps discovered
prev_count=0
curr_count=1
while [[ $prev_count -ne $curr_count ]]; do
    prev_count=$curr_count
    while IFS= read -r dylib; do
        [[ -f "$dylib" ]] || continue
        deps=$(otool -L "$dylib" 2>/dev/null | tail -n +2 | awk '{print $1}') || continue
        for dep in $deps; do copy_lib_recursive "$dep"; done
    done < <(find "$LIB_DIR" -name '*.dylib' -type f 2>/dev/null)
    curr_count=$(find "$LIB_DIR" -name '*.dylib' -type f 2>/dev/null | wc -l | tr -d ' ')
done

BUNDLED_COUNT=$(wc -l < "$PROCESSED_FILE" | tr -d ' ')
echo "  Bundled ${BUNDLED_COUNT} libraries"

# ============================================================================
# Phase 2: Fix install names (set dylib IDs to @rpath/<name>)
# ============================================================================
echo "Phase 2: Fixing dylib install names..."

while IFS= read -r dylib; do
    [[ -f "$dylib" ]] || continue
    lib_name=$(basename "$dylib")
    current_id=$(otool -D "$dylib" 2>/dev/null | tail -1) || continue
    if [[ "$current_id" == "@"* ]]; then continue; fi

    # Preserve subdirectory structure in the ID (e.g. @rpath/plugin/foo.dylib)
    local_path="${dylib#${LIB_DIR}/}"
    install_name_tool -id "@rpath/${local_path}" "$dylib" 2>/dev/null || true
done < <(find "$LIB_DIR" -name '*.dylib' -type f 2>/dev/null)

# ============================================================================
# Phase 3: Fix references (rewrite Homebrew paths to @loader_path)
# ============================================================================
echo "Phase 3: Fixing library references..."

fix_references() {
    local file="$1"
    local file_type="$2"  # "dylib" or "binary"

    file "$file" | grep -q "Mach-O" || return 0

    local deps
    deps=$(otool -L "$file" 2>/dev/null | tail -n +2 | awk '{print $1}') || return 0

    # Compute how deep this file is relative to LIB_DIR (for subdirectory dylibs)
    local file_dir rel_prefix=""
    file_dir=$(dirname "$file")
    if [[ "$file_type" == "dylib" && "$file_dir" != "$LIB_DIR" ]]; then
        # e.g. lib/plugin/foo.dylib needs "../" to reach lib/
        local depth
        depth=$(echo "${file_dir#${LIB_DIR}/}" | tr '/' '\n' | wc -l | tr -d ' ')
        for ((i=0; i<depth; i++)); do rel_prefix+="../"; done
    fi

    for dep in $deps; do
        if is_system_lib "$dep" || [[ "$dep" == "@"* ]]; then continue; fi

        local lib_name new_path=""
        lib_name=$(basename "$dep")

        # Check if the lib exists in LIB_DIR (top-level) or any subdirectory
        if [[ -f "${LIB_DIR}/${lib_name}" ]]; then
            if [[ "$file_type" == "dylib" ]]; then
                new_path="@loader_path/${rel_prefix}${lib_name}"
            else
                new_path="@loader_path/../lib/${lib_name}"
            fi
        else
            # Search subdirectories of LIB_DIR
            local found_sub
            found_sub=$(find "$LIB_DIR" -name "$lib_name" -type f 2>/dev/null | head -1)
            if [[ -n "$found_sub" ]]; then
                local sub_path="${found_sub#${LIB_DIR}/}"
                if [[ "$file_type" == "dylib" ]]; then
                    new_path="@loader_path/${rel_prefix}${sub_path}"
                else
                    new_path="@loader_path/../lib/${sub_path}"
                fi
            fi
        fi

        if [[ -n "$new_path" ]]; then
            install_name_tool -change "$dep" "$new_path" "$file" 2>/dev/null || true
        fi
    done

    # Add rpath for binaries so @rpath references resolve
    if [[ "$file_type" == "binary" ]]; then
        if ! otool -l "$file" 2>/dev/null | grep -A2 "LC_RPATH" | grep -q "@loader_path/../lib"; then
            install_name_tool -add_rpath "@loader_path/../lib" "$file" 2>/dev/null || true
        fi
    fi
}

# Fix binaries in bin/
if [[ -d "${PACKAGE_ROOT}/bin" ]]; then
    for binary in "${PACKAGE_ROOT}/bin/"*; do
        [[ -f "$binary" ]] && fix_references "$binary" "binary"
    done
fi

# Fix all dylibs in lib/ (including subdirectories)
while IFS= read -r dylib; do
    [[ -f "$dylib" ]] && fix_references "$dylib" "dylib"
done < <(find "$LIB_DIR" -name '*.dylib' -type f 2>/dev/null)

# Fix rpaths on dylibs — remove Homebrew paths, add @loader_path
echo "Phase 3b: Fixing rpaths on dylibs..."
while IFS= read -r dylib; do
    [[ -f "$dylib" ]] || continue
    # Remove Homebrew rpaths
    for rpath in $(otool -l "$dylib" 2>/dev/null | grep -A2 LC_RPATH | grep "path " | awk '{print $2}'); do
        if [[ "$rpath" == *"/opt/homebrew/"* ]] || [[ "$rpath" == *"/usr/local/"* ]] || [[ "$rpath" == *"/Cellar/"* ]]; then
            install_name_tool -delete_rpath "$rpath" "$dylib" 2>/dev/null || true
        fi
    done
    # Add @loader_path if dylib references other dylibs via @rpath
    if otool -L "$dylib" 2>/dev/null | grep -q "@rpath/"; then
        if ! otool -l "$dylib" 2>/dev/null | grep -A2 "LC_RPATH" | grep -q "@loader_path"; then
            install_name_tool -add_rpath "@loader_path" "$dylib" 2>/dev/null || true
        fi
    fi
done < <(find "$LIB_DIR" -name '*.dylib' -type f 2>/dev/null)

# ============================================================================
# Phase 4: Code sign all modified Mach-O files
# ============================================================================
echo "Phase 4: Code signing..."

SIGNED_COUNT=0
if [[ -d "${PACKAGE_ROOT}/bin" ]]; then
    for f in "${PACKAGE_ROOT}/bin/"*; do
        if [[ -f "$f" ]] && file "$f" | grep -q "Mach-O"; then
            codesign -s - --force "$f" 2>/dev/null && ((SIGNED_COUNT++)) || true
        fi
    done
fi
while IFS= read -r f; do
    if [[ -f "$f" ]]; then
        codesign -s - --force "$f" 2>/dev/null && ((SIGNED_COUNT++)) || true
    fi
done < <(find "$LIB_DIR" -name '*.dylib' -type f 2>/dev/null)

echo "  Signed ${SIGNED_COUNT} files"

# ============================================================================
# Phase 5: Verify no Homebrew paths remain
# ============================================================================
echo "Phase 5: Verifying relocatable binaries..."

VERIFY_FAILED=0

check_file() {
    local file="$1"
    local label="$2"
    local remaining
    remaining=$(otool -L "$file" 2>/dev/null | grep -E "(Cellar|opt/homebrew|/usr/local/(opt|lib|Cellar))" | grep -v "^$" || true)
    if [[ -n "$remaining" ]]; then
        echo "  FAIL: Non-relocatable paths in ${label}:"
        echo "$remaining" | while IFS= read -r line; do echo "    $line"; done
        VERIFY_FAILED=1
    fi
}

if [[ -d "${PACKAGE_ROOT}/bin" ]]; then
    for binary in "${PACKAGE_ROOT}/bin/"*; do
        [[ -f "$binary" ]] || continue
        file "$binary" | grep -q "Mach-O" || continue
        check_file "$binary" "bin/$(basename "$binary")"
    done
fi

while IFS= read -r dylib; do
    [[ -f "$dylib" ]] || continue
    local_path="${dylib#${LIB_DIR}/}"
    check_file "$dylib" "lib/${local_path}"
done < <(find "$LIB_DIR" -name '*.dylib' -type f 2>/dev/null)

if [[ $VERIFY_FAILED -eq 1 ]]; then
    echo "ERROR: Some binaries still have non-relocatable Homebrew paths!"
    exit 1
fi

echo "=== fix-macos-dylibs: All binaries are relocatable ==="
