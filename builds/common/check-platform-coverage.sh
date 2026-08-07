#!/usr/bin/env bash
# check-platform-coverage.sh - Fail a release that silently shipped fewer
#                              platforms than were asked for.
#
# Usage: check-platform-coverage.sh <database> <version> <requested-platforms> <release-assets-dir>
#
#   <requested-platforms> is the workflow's `platforms` input verbatim:
#   either the literal string "all" or a comma/space separated list.
#
# Why this exists:
#   Every engine's download.ts loops over platforms and counts a failed
#   download, a missing cross-compiler, or a build error as a "skip". The loop
#   then exits 0, so as long as ONE platform produced a tarball the release
#   completed green. weaviate 1.38.8 shipped 2 of 5 platforms that way and
#   nobody found out from the release run.
#
# Supported vs failed:
#   A platform is EXPECTED only when the engine declares it for this version,
#   in BOTH databases.json (the registry's platform list) and the engine's
#   builds/<db>/sources.json (the build recipe). Engines that legitimately have
#   no win32 build - libsql, postgresql - simply do not declare it, so it is
#   never expected and never fails. The skip is driven by the declared platform
#   list, never by the build outcome.
#
#   Anything expected that produced no artifact is a hard failure.

set -euo pipefail

DB="${1:?Usage: check-platform-coverage.sh <database> <version> <requested-platforms> <release-assets-dir>}"
VERSION="${2:?Usage: check-platform-coverage.sh <database> <version> <requested-platforms> <release-assets-dir>}"
REQUESTED_RAW="${3:?Usage: check-platform-coverage.sh <database> <version> <requested-platforms> <release-assets-dir>}"
ASSETS_DIR="${4:?Usage: check-platform-coverage.sh <database> <version> <requested-platforms> <release-assets-dir>}"

# Find the repo root relative to this script. HOSTDB_ROOT overrides it so the
# unit tests can point the script at a fixture tree.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${HOSTDB_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DATABASES_JSON="$REPO_ROOT/databases.json"
SOURCES_JSON="$REPO_ROOT/builds/$DB/sources.json"

if [ ! -f "$DATABASES_JSON" ]; then
  echo "::error::databases.json not found at $DATABASES_JSON"
  exit 1
fi

if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::Release assets directory not found: $ASSETS_DIR"
  exit 1
fi

echo "=== Platform Coverage Check for $DB $VERSION ==="

# --- Declared platforms, per databases.json -----------------------------------
# Mirrors getVersionPlatforms() in lib/databases.ts: a version-level `platforms`
# (array or object) fully replaces the engine-level list; otherwise the
# engine-level list applies.
DECLARED_REGISTRY=$(jq -r "
  .databases[\"$DB\"] as \$engine |
  (\$engine.versions[\"$VERSION\"] // null) as \$v |
  (
    if (\$v | type) == \"object\" and (\$v.platforms != null) then
      (if (\$v.platforms | type) == \"array\" then \$v.platforms else (\$v.platforms | keys) end)
    else
      (\$engine.platforms // [])
    end
  ) |
  if length == 0 then (\$engine.platforms // []) else . end |
  .[]
" "$DATABASES_JSON" | sort -u)

if [ -z "$DECLARED_REGISTRY" ]; then
  echo "::error::No platforms declared for $DB in databases.json - cannot verify coverage"
  exit 1
fi

# --- Declared platforms, per the engine's sources.json ------------------------
DECLARED_SOURCES=""
if [ -f "$SOURCES_JSON" ]; then
  DECLARED_SOURCES=$(jq -r "
    .versions[\"$VERSION\"] // {} | keys | .[]
  " "$SOURCES_JSON" 2> /dev/null | sort -u || true)
fi

if [ -n "$DECLARED_SOURCES" ]; then
  DECLARED=$(comm -12 <(echo "$DECLARED_REGISTRY") <(echo "$DECLARED_SOURCES"))
else
  # Engines without a sources.json entry for this version (or without the file
  # at all) fall back to the registry list.
  DECLARED="$DECLARED_REGISTRY"
fi

echo "Declared platforms: $(echo "$DECLARED" | tr '\n' ' ')"

# --- Requested platforms ------------------------------------------------------
REQUESTED_NORM=$(echo "$REQUESTED_RAW" | tr ',' '\n' | tr ' ' '\n' | sed '/^$/d' | sort -u)

if [ "$REQUESTED_RAW" = "all" ] || echo "$REQUESTED_NORM" | grep -qx "all"; then
  REQUESTED="$DECLARED"
  echo "Requested platforms: all -> $(echo "$REQUESTED" | tr '\n' ' ')"
else
  REQUESTED="$REQUESTED_NORM"
  echo "Requested platforms: $(echo "$REQUESTED" | tr '\n' ' ')"
fi

# Requested but not declared: a legitimate, declared-driven skip. Loud enough to
# notice in the log, but never a failure - this is how "no win32 by design"
# stays green.
NOT_DECLARED=$(comm -23 <(echo "$REQUESTED") <(echo "$DECLARED"))
if [ -n "$NOT_DECLARED" ]; then
  for platform in $NOT_DECLARED; do
    echo "::warning::$platform was requested but $DB $VERSION does not declare it - skipping (not a build failure)"
  done
fi

EXPECTED=$(comm -12 <(echo "$REQUESTED") <(echo "$DECLARED"))

if [ -z "$EXPECTED" ]; then
  echo "::error::No requested platform is declared for $DB $VERSION - nothing could have been built"
  exit 1
fi

# --- Built platforms, from the artifact filenames -----------------------------
# Artifacts are named <db>-<version>-<platform>.<ext>; matching on the platform
# suffix keeps compound versions like postgresql-documentdb 17-0.107.0 working.
shopt -s nullglob
ARCHIVES=("$ASSETS_DIR"/*.tar.gz "$ASSETS_DIR"/*.zip)

BUILT=""
for archive in "${ARCHIVES[@]}"; do
  FILENAME=$(basename "$archive")
  PLATFORM=$(echo "$FILENAME" | sed -nE 's/.*-((linux|darwin|win32)-(x64|arm64))\.(tar\.gz|zip)$/\1/p')
  [ -n "$PLATFORM" ] && BUILT="${BUILT}${PLATFORM}"$'\n'
done
BUILT=$(echo "$BUILT" | sed '/^$/d' | sort -u)

echo "Built platforms: $(echo "$BUILT" | tr '\n' ' ')"
echo ""

MISSING=$(comm -23 <(echo "$EXPECTED") <(echo "$BUILT" | sed '/^$/d'))

if [ -n "$MISSING" ]; then
  echo "::error::Platform coverage check failed for $DB $VERSION - these platforms were requested and declared but produced no artifact: $(echo "$MISSING" | tr '\n' ' ')"
  echo ""
  echo "A platform that fails to download, cross-compile, or build is NOT a skip."
  echo "Read the build job log for the platform above: the engine's download.ts"
  echo "logs the real error and then continues, which is why the run got this far."
  echo ""
  echo "If the platform genuinely is not buildable for this version, remove it"
  echo "from builds/$DB/sources.json and databases.yml so it stops being expected."
  exit 1
fi

echo "All expected platforms produced an artifact for $DB $VERSION"
