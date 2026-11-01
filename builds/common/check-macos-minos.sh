#!/usr/bin/env bash
# check-macos-minos.sh - Fail if any Mach-O file requires a newer macOS than the target
#
# Usage: ./builds/common/check-macos-minos.sh [--max <version>] [--report] <path>...
#   --max <version>  Highest allowed minimum macOS (default: the pinned target in
#                    builds/common/macos-deployment-target.env)
#   --report         Print the minimum macOS of every Mach-O file, not only failures
#   <path>           Files, directories (scanned recursively) or .tar.gz archives
#                    (extracted to a temp dir and scanned, so the check sees what ships)
#
# Reads LC_BUILD_VERSION (minos) and the older LC_VERSION_MIN_MACOSX (version)
# for every architecture slice. A binary built on a newer runner without a
# pinned deployment target carries that runner's macOS version as its minimum,
# and fails to launch on older macOS. Read-only. Exit 0 if clean, 1 otherwise.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAX=""
REPORT=false
PATHS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --max) MAX="$2"; shift 2 ;;
        --report) REPORT=true; shift ;;
        -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
        *) PATHS+=("$1"); shift ;;
    esac
done

if [[ -z "$MAX" ]]; then
    # shellcheck source=macos-deployment-target.env
    MAX="$(source "$SCRIPT_DIR/macos-deployment-target.env" && echo "$MACOSX_DEPLOYMENT_TARGET")"
fi

if [[ ${#PATHS[@]} -eq 0 ]]; then
    echo "ERROR: no path given. Usage: $0 [--max <version>] [--report] <path>..." >&2
    exit 1
fi

if ! command -v otool >/dev/null 2>&1; then
    echo "ERROR: otool not found. Run on macOS with the Xcode command line tools installed (xcode-select --install)." >&2
    exit 1
fi

version_gt() {
    awk -v a="$1" -v b="$2" 'BEGIN {
        na = split(a, x, "."); nb = split(b, y, ".")
        n = na > nb ? na : nb
        for (i = 1; i <= n; i++) {
            xi = (i <= na) ? x[i] + 0 : 0; yi = (i <= nb) ? y[i] + 0 : 0
            if (xi > yi) exit 0
            if (xi < yi) exit 1
        }
        exit 1
    }'
}

minos_of() {
    otool -arch all -l "$1" 2>/dev/null | awk '
        /cmd LC_BUILD_VERSION/ { want = "minos"; next }
        /cmd LC_VERSION_MIN_MACOSX/ { want = "version"; next }
        /cmd / { want = "" }
        want != "" && $1 == want { print $2; want = "" }
    ' | sort -u
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SCAN_PATHS=()
for p in "${PATHS[@]}"; do
    if [[ ! -e "$p" ]]; then
        echo "ERROR: path does not exist: $p" >&2
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

SCANNED=0
FAILED=0

list_macho_candidates() {
    find "$@" -type f -print0 | perl -0 -ne '
        chomp; open(my $f, "<", $_) or next; binmode $f;
        read($f, my $m, 4) == 4 or next;
        print "$_\0" if unpack("H8", $m) =~ /^(cffaedfe|cefaedfe|cafebabe|feedfacf|feedface)$/'
}

while IFS= read -r -d '' file; do
    versions=$(minos_of "$file")
    [[ -n "$versions" ]] || continue
    SCANNED=$((SCANNED + 1))
    bad=false
    while IFS= read -r v; do
        if version_gt "$v" "$MAX"; then bad=true; fi
    done <<< "$versions"
    joined=$(echo "$versions" | paste -sd, -)
    label="${file#"$TMP_DIR"/}"
    if $bad; then
        FAILED=$((FAILED + 1))
        echo "  FAIL: $label (minos $joined > $MAX)"
    elif $REPORT; then
        echo "  ok:   $label (minos $joined)"
    fi
done < <(list_macho_candidates "${SCAN_PATHS[@]}")

echo "Scanned $SCANNED Mach-O files, max allowed minimum macOS $MAX: $FAILED above it."
if [[ $SCANNED -eq 0 ]]; then
    echo "ERROR: no Mach-O files found under ${PATHS[*]}. Point the check at the build output directory." >&2
    exit 1
fi
if [[ $FAILED -gt 0 ]]; then
    echo "ERROR: $FAILED file(s) require a newer macOS than $MAX. Export MACOSX_DEPLOYMENT_TARGET (source builds/common/macos-deployment-target.env) before configuring the build, or for a repackaged upstream binary raise the documented minimum deliberately." >&2
    exit 1
fi
