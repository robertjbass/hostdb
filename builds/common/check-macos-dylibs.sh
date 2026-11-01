#!/usr/bin/env bash
# check-macos-dylibs.sh - Fail if any shipped Mach-O file loads a library by a
# non-relocatable absolute path
#
# Usage: ./builds/common/check-macos-dylibs.sh [<path>...]
#   <path>    Files, directories (scanned recursively) or .tar.gz archives
#             (extracted to a temp dir and scanned, so the check sees what ships).
#             Default: ./dist
#
# Examples:
#   ./builds/common/check-macos-dylibs.sh dist/*.tar.gz
#   ./builds/common/check-macos-dylibs.sh ./dist/redis
#   pnpm check:dylibs -- ./dist/mariadb
#
# Every Mach-O file is checked, wherever it sits (bin/, lib/, lib/plugin/*.so,
# bundles, helper executables), for every architecture slice. A load command
# (LC_LOAD_DYLIB and its weak/reexport/lazy/upward variants) or an LC_RPATH
# entry may only name @-relative paths (@loader_path, @executable_path,
# @rpath) or the OS itself (/usr/lib, /System). Anything else (Homebrew, the
# build machine's deps prefix, a CI work directory) loads only on a machine
# that happens to have that exact path, so it fails here.
#
# Read-only. Exit 0 if clean, 1 otherwise.

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    sed -n '2,22p' "$0"
    exit 0
fi

PATHS=("$@")
if [[ ${#PATHS[@]} -eq 0 ]]; then
    PATHS=("./dist")
fi

if ! command -v otool >/dev/null 2>&1; then
    echo "ERROR: otool not found. Run on macOS with the Xcode command line tools installed (xcode-select --install)." >&2
    exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SCAN_PATHS=()
for p in "${PATHS[@]}"; do
    if [[ ! -e "$p" ]]; then
        echo "ERROR: path does not exist: $p" >&2
        echo "Usage: $0 [<path>...]" >&2
        exit 1
    fi
    if [[ -f "$p" && ( "$p" == *.tar.gz || "$p" == *.tgz ) ]]; then
        dest="$TMP_DIR/$(basename "$p")"
        mkdir -p "$dest"
        tar -xzf "$p" -C "$dest"
        SCAN_PATHS+=("$dest")
    else
        SCAN_PATHS+=("$p")
    fi
done

# Mach-O magics: thin 64/32 (both byte orders) and fat 32/64. Java class files
# share the fat magic cafebabe: they are skipped by name below, and any other
# file otool cannot read fails the check.
list_macho_candidates() {
    find "$@" -type f -print0 | perl -0 -ne '
        chomp; open(my $f, "<", $_) or next; binmode $f;
        read($f, my $m, 4) == 4 or next;
        print "$_\0" if unpack("H8", $m) =~ /^(cffaedfe|cefaedfe|cafebabe|cafebabf|feedfacf|feedface)$/'
}

is_relocatable_path() {
    [[ "$1" == @* || "$1" == /usr/lib/* || "$1" == /System/* ]]
}

# Prints "<kind> <path>" for every library load and rpath in every slice.
load_paths_of() {
    awk '
        /^ +cmd LC_(LOAD_DYLIB|LOAD_WEAK_DYLIB|REEXPORT_DYLIB|LAZY_LOAD_DYLIB|LOAD_UPWARD_DYLIB)$/ { want = "name"; kind = "load"; next }
        /^ +cmd LC_RPATH$/ { want = "path"; kind = "rpath"; next }
        /^ +cmd / { want = "" }
        want != "" && $1 == want { print kind, $2; want = "" }
    ' <<< "$1" | sort -u
}

SCANNED=0
FAILED=0
UNREADABLE=0

while IFS= read -r -d '' file; do
    label="${file#"$TMP_DIR"/}"
    if ! commands=$(otool -arch all -l "$file" 2>&1); then
        if file -b "$file" | grep -q "Java class"; then continue; fi
        UNREADABLE=$((UNREADABLE + 1))
        echo "  FAIL: $label: otool could not read it as Mach-O: $(head -1 <<< "$commands")"
        continue
    fi
    SCANNED=$((SCANNED + 1))
    bad=$(load_paths_of "$commands" | while read -r kind path; do
        is_relocatable_path "$path" || echo "    -> $kind $path"
    done)
    if [[ -n "$bad" ]]; then
        FAILED=$((FAILED + 1))
        echo "  FAIL: $label"
        echo "$bad"
    fi
done < <(list_macho_candidates "${SCAN_PATHS[@]}")

echo "Scanned $SCANNED Mach-O files: $FAILED with non-relocatable paths, $UNREADABLE unreadable."
if [[ $SCANNED -eq 0 && $UNREADABLE -eq 0 ]]; then
    echo "ERROR: no Mach-O files found under ${PATHS[*]}. Point the check at the build output directory." >&2
    exit 1
fi
if [[ $UNREADABLE -gt 0 ]]; then
    echo "ERROR: $UNREADABLE file(s) carry a Mach-O magic but otool cannot read them, so their load paths are unverified. Inspect them with \`file\` and \`otool -l\`; a truncated or corrupt binary must not ship." >&2
    exit 1
fi
if [[ $FAILED -gt 0 ]]; then
    echo "ERROR: $FAILED file(s) load libraries by an absolute path outside /usr/lib and /System, which breaks on any Mac without that path. Run builds/common/fix-macos-dylibs.sh <package-root> before creating the tarball, or stop building the component that needs the library." >&2
    exit 1
fi
echo "PASS: all Mach-O files are relocatable."
