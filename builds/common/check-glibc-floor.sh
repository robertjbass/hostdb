#!/usr/bin/env bash
# check-glibc-floor.sh - Fail a release whose Linux artifacts need a newer glibc
#                        than our oldest supported Linux target.
#
# Usage: check-glibc-floor.sh <database> <release-assets-dir>
#
# Why this exists:
#   Two 2026-08 releases shipped green and only broke two repos downstream, in
#   spindb's Ubuntu 22.04 CI:
#     - qdrant 1.18.3: the upstream gnu build referenced GLIBC_2.38.
#     - couchdb 3.5.2: the docker-extract followed the upstream image from
#       bookworm to trixie and inherited glibc 2.41.
#   Nothing in the release pipeline looked at what the binaries actually
#   require, so a binary that cannot start on our oldest supported distro
#   passed every gate.
#
# What it does:
#   For every linux-x64 / linux-arm64 archive in the release-assets directory,
#   extracts it, finds every ELF file, and reads the highest GLIBC_x.y.z symbol
#   version the file references. If any file needs more than GLIBC_FLOOR, the
#   release fails loudly and names the offending files.
#
#   Static binaries (musl, Go, Zig) reference no GLIBC versions at all and pass
#   trivially. Non-ELF payloads (jars, scripts, .a archives, data files) are
#   skipped gracefully - engines like QuestDB and TypeDB ship JVM artifacts with
#   nothing to inspect.
#
#   darwin-* and win32-* archives are not examined: there is no glibc there.

set -euo pipefail

# =============================================================================
# THE FLOOR - the single value to change if the oldest supported Linux target
# moves. 2.35 is Ubuntu 22.04 LTS (jammy): the oldest distro hostdb binaries
# must run on, the base image used by builds/*/Dockerfile, and the runner
# spindb's CI matrix pins.
# =============================================================================
GLIBC_FLOOR="2.35"

DB="${1:?Usage: check-glibc-floor.sh <database> <release-assets-dir>}"
ASSETS_DIR="${2:?Usage: check-glibc-floor.sh <database> <release-assets-dir>}"

if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::Release assets directory not found: $ASSETS_DIR"
  exit 1
fi

echo "=== GLIBC Floor Check for $DB ==="
echo "Floor: GLIBC_$GLIBC_FLOOR (Ubuntu 22.04 / jammy)"

# Pick an ELF reader. Both ship in binutils on the GitHub runners; readelf is
# preferred because its version-needs output is stable across architectures.
ELF_READER=""
if command -v readelf > /dev/null 2>&1; then
  ELF_READER="readelf"
elif command -v objdump > /dev/null 2>&1; then
  ELF_READER="objdump"
else
  echo "::error::Neither readelf nor objdump is available - cannot verify the GLIBC floor"
  echo "Install binutils on the runner, or the check cannot be trusted."
  exit 1
fi
echo "ELF reader: $ELF_READER"

# Compare two dotted versions numerically. Returns 0 when $1 > $2.
version_gt() {
  local a="$1" b="$2"
  local IFS=.
  # shellcheck disable=SC2206
  local av=($a) bv=($b)
  local i
  for i in 0 1 2; do
    local an="${av[i]:-0}" bn="${bv[i]:-0}"
    if [ "$an" -gt "$bn" ]; then return 0; fi
    if [ "$an" -lt "$bn" ]; then return 1; fi
  done
  return 1
}

# An ELF file starts with the 4-byte magic 0x7f 'E' 'L' 'F'.
is_elf() {
  [ -f "$1" ] || return 1
  [ "$(head -c 4 "$1" 2> /dev/null | od -An -tx1 | tr -d ' \n')" = "7f454c46" ]
}

# Highest GLIBC_x.y.z referenced by an ELF file, or empty when it references
# none (static binaries, musl builds). GLIBC_PRIVATE carries no version number
# and never matches the pattern.
max_glibc_for_file() {
  local file="$1" refs=""

  if [ "$ELF_READER" = "readelf" ]; then
    refs=$(readelf -V "$file" 2> /dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+(\.[0-9]+)?' || true)
  else
    refs=$(objdump -T "$file" 2> /dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+(\.[0-9]+)?' || true)
  fi

  [ -z "$refs" ] && return 0

  echo "$refs" \
    | sed 's/^GLIBC_//' \
    | sort -t. -k1,1n -k2,2n -k3,3n \
    | tail -1
}

shopt -s nullglob
ARCHIVES=("$ASSETS_DIR"/*.tar.gz "$ASSETS_DIR"/*.zip)

if [ ${#ARCHIVES[@]} -eq 0 ]; then
  echo "::warning::No archives found in $ASSETS_DIR - skipping GLIBC floor check"
  exit 0
fi

OVERALL_FAILED=0
LINUX_ARCHIVES=0

for archive in "${ARCHIVES[@]}"; do
  FILENAME=$(basename "$archive")

  case "$FILENAME" in
    *-linux-x64.* | *-linux-arm64.*) ;;
    *)
      echo "Skip: $FILENAME (not a Linux artifact)"
      continue
      ;;
  esac

  LINUX_ARCHIVES=$((LINUX_ARCHIVES + 1))
  echo ""
  echo "--- Checking: $FILENAME ---"

  TEMP_DIR=$(mktemp -d)

  if [[ "$archive" == *.tar.gz ]]; then
    tar -xzf "$archive" -C "$TEMP_DIR"
  else
    unzip -q "$archive" -d "$TEMP_DIR"
  fi

  ARCHIVE_MAX=""
  ARCHIVE_MAX_FILE=""
  ELF_COUNT=0
  SKIPPED_COUNT=0
  OFFENDERS=""

  while IFS= read -r -d '' file; do
    if ! is_elf "$file"; then
      SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
      continue
    fi

    ELF_COUNT=$((ELF_COUNT + 1))
    FILE_MAX=$(max_glibc_for_file "$file")
    [ -z "$FILE_MAX" ] && continue

    REL="${file#"$TEMP_DIR"/}"

    if [ -z "$ARCHIVE_MAX" ] || version_gt "$FILE_MAX" "$ARCHIVE_MAX"; then
      ARCHIVE_MAX="$FILE_MAX"
      ARCHIVE_MAX_FILE="$REL"
    fi

    if version_gt "$FILE_MAX" "$GLIBC_FLOOR"; then
      OFFENDERS="${OFFENDERS}    $REL needs GLIBC_$FILE_MAX"$'\n'
    fi
  done < <(find "$TEMP_DIR" -type f -print0)

  echo "  ELF files inspected: $ELF_COUNT (skipped $SKIPPED_COUNT non-ELF)"

  if [ "$ELF_COUNT" -eq 0 ]; then
    echo "  No ELF files in this archive - nothing to check"
  elif [ -z "$ARCHIVE_MAX" ]; then
    echo "  No GLIBC symbol versions referenced (static or musl build) - OK"
  else
    echo "  Highest requirement: GLIBC_$ARCHIVE_MAX ($ARCHIVE_MAX_FILE)"
  fi

  if [ -n "$OFFENDERS" ]; then
    echo "  ABOVE FLOOR - these files need more than GLIBC_$GLIBC_FLOOR:"
    printf '%s' "$OFFENDERS"
    OVERALL_FAILED=1
  fi

  rm -rf "$TEMP_DIR"
done

echo ""

if [ "$LINUX_ARCHIVES" -eq 0 ]; then
  echo "No Linux artifacts in this release - GLIBC floor check not applicable"
  exit 0
fi

if [ $OVERALL_FAILED -eq 1 ]; then
  echo "::error::GLIBC floor check failed for $DB - one or more Linux artifacts require a newer glibc than $GLIBC_FLOOR (Ubuntu 22.04) and will not start there."
  echo ""
  echo "Fix the BUILD, not this floor. The usual causes:"
  echo "  - An upstream gnu tarball built on a newer distro (use the musl or"
  echo "    static variant, or build it ourselves)."
  echo "  - A docker-extract whose base image drifted to a newer release"
  echo "    (pin the base to ubuntu:22.04, as builds/couchdb/Dockerfile does)."
  exit 1
fi

echo "All Linux artifacts satisfy the GLIBC_$GLIBC_FLOOR floor for $DB"
