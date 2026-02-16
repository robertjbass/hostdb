#!/usr/bin/env bash
# check-macos-dylibs.sh — Scan macOS packages for non-relocatable Homebrew dependencies
#
# Usage: ./builds/common/check-macos-dylibs.sh [<path>]
#   <path>    Package dir or parent dir containing packages (default: ./dist)
#
# Examples:
#   ./builds/common/check-macos-dylibs.sh ./dist/redis
#   ./builds/common/check-macos-dylibs.sh ./dist          # scans all packages
#   pnpm check:dylibs                                      # alias via package.json
#   pnpm check:dylibs -- ./dist/mariadb
#
# Read-only — does NOT modify any files. Exit code 0 if clean, 1 if issues found.

set -euo pipefail

SCAN_PATH="${1:-./dist}"

if [[ ! -e "$SCAN_PATH" ]]; then
    echo "ERROR: Path does not exist: $SCAN_PATH"
    echo "Usage: $0 [<path>]"
    exit 1
fi

# Homebrew path pattern for grep
BREW_PATTERN="(/opt/homebrew/|/usr/local/(Cellar|opt|lib)/)"

TOTAL_FILES=0
PROBLEM_FILES=0
PROBLEM_DETAILS=()

scan_file() {
    local file="$1"
    local label="$2"

    file "$file" | grep -q "Mach-O" || return 0
    ((TOTAL_FILES++)) || true

    local bad_deps
    bad_deps=$(otool -L "$file" 2>/dev/null | tail -n +2 | awk '{print $1}' | grep -E "$BREW_PATTERN" || true)

    if [[ -n "$bad_deps" ]]; then
        ((PROBLEM_FILES++)) || true
        PROBLEM_DETAILS+=("$label")
        echo "  FAIL: $label"
        while IFS= read -r dep; do
            echo "    -> $dep"
            PROBLEM_DETAILS+=("    $dep")
        done <<< "$bad_deps"
    fi
}

scan_directory() {
    local dir="$1"
    local prefix="$2"

    # Scan bin/
    if [[ -d "${dir}/bin" ]]; then
        for f in "${dir}/bin/"*; do
            [[ -f "$f" ]] || continue
            scan_file "$f" "${prefix}bin/$(basename "$f")"
        done
    fi

    # Scan lib/ (including subdirectories)
    if [[ -d "${dir}/lib" ]]; then
        while IFS= read -r f; do
            [[ -f "$f" ]] || continue
            local rel="${f#${dir}/}"
            scan_file "$f" "${prefix}${rel}"
        done < <(find "${dir}/lib" -name '*.dylib' -type f 2>/dev/null)
    fi

    # Scan top-level Mach-O files (single-binary databases like duckdb, qdrant)
    for f in "${dir}/"*; do
        [[ -f "$f" ]] || continue
        [[ "$(basename "$f")" == .* ]] && continue
        [[ "$f" == *.json ]] && continue
        [[ "$f" == *.conf ]] && continue
        [[ "$f" == *.yml ]] && continue
        file "$f" | grep -q "Mach-O" || continue
        scan_file "$f" "${prefix}$(basename "$f")"
    done
}

echo "=== check-macos-dylibs: Scanning $SCAN_PATH ==="
echo ""

# Determine if this is a single package or a directory of packages
if [[ -d "${SCAN_PATH}/bin" ]] || ls "${SCAN_PATH}/"*.dylib &>/dev/null 2>&1; then
    # Single package directory
    scan_directory "$SCAN_PATH" "$(basename "$SCAN_PATH")/"
else
    # Parent directory — scan each subdirectory as a package
    for pkg_dir in "${SCAN_PATH}/"*/; do
        [[ -d "$pkg_dir" ]] || continue
        pkg_name=$(basename "$pkg_dir")
        echo "--- ${pkg_name} ---"
        scan_directory "$pkg_dir" "${pkg_name}/"
    done
fi

# Summary
echo ""
echo "=== Summary ==="
echo "  Files scanned: ${TOTAL_FILES}"
echo "  Files with issues: ${PROBLEM_FILES}"

if [[ $PROBLEM_FILES -gt 0 ]]; then
    echo ""
    echo "RESULT: FAIL — ${PROBLEM_FILES} file(s) have non-relocatable Homebrew paths"
    echo "Fix: Run builds/common/fix-macos-dylibs.sh <package-root> before creating the tarball"
    exit 1
else
    echo ""
    echo "RESULT: PASS — all binaries are relocatable"
    exit 0
fi
