#!/usr/bin/env bash
# validate-binaries.sh - Validate release archives contain all required cli_tools binaries
#
# Usage: validate-binaries.sh <database> <release-assets-dir>
#
# Reads databases.json to determine required binaries (server, client, utilities).
# Skips enhanced tools, null entries, and binaries provided by dependencies.
# For each archive in the release-assets directory, extracts and validates.

set -euo pipefail

DB="${1:?Usage: validate-binaries.sh <database> <release-assets-dir>}"
ASSETS_DIR="${2:?Usage: validate-binaries.sh <database> <release-assets-dir>}"

# Find databases.json relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATABASES_JSON="$REPO_ROOT/databases.json"

if [ ! -f "$DATABASES_JSON" ]; then
  echo "::error::databases.json not found at $DATABASES_JSON"
  exit 1
fi

if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::Release assets directory not found: $ASSETS_DIR"
  exit 1
fi

echo "=== Binary Validation for $DB ==="

# Collect required binaries from cli_tools (server, client, utilities)
# Skip null values, empty strings, and enhanced tools
REQUIRED_BINARIES=$(jq -r "
  .databases[\"$DB\"].cliTools |
  [
    .server,
    .client,
    (.utilities // [] | .[])
  ] |
  map(select(. != null and . != \"null\" and . != \"\")) |
  unique |
  .[]
" "$DATABASES_JSON")

if [ -z "$REQUIRED_BINARIES" ]; then
  echo "No required binaries defined for $DB - skipping validation"
  exit 0
fi

echo "Required binaries: $(echo "$REQUIRED_BINARIES" | tr '\n' ' ')"

# Collect binaries provided by dependencies (these are NOT expected in this tarball)
# For example, QuestDB depends on PostgreSQL and lists psql as client,
# but psql comes from the PostgreSQL install, not the QuestDB tarball
DEP_BINARIES_FILE=$(mktemp)
trap "rm -f '$DEP_BINARIES_FILE'" EXIT

DEPS=$(jq -r "
  .databases[\"$DB\"] |
  [
    (.dependencies // [] | .[].database),
    (.versions | to_entries[] | .value |
      if type == \"object\" then (.dependencies // [] | .[].database) else empty end
    )
  ] | flatten | unique | .[]
" "$DATABASES_JSON" 2>/dev/null || true)

for dep in $DEPS; do
  [ -z "$dep" ] && continue
  jq -r "
    .databases[\"$dep\"].cliTools // {} |
    [.server, .client, (.utilities // [] | .[])] |
    map(select(. != null and . != \"null\")) | .[]
  " "$DATABASES_JSON" >> "$DEP_BINARIES_FILE" 2>/dev/null || true
done

if [ -s "$DEP_BINARIES_FILE" ]; then
  echo "Binaries from dependencies (will skip): $(sort -u "$DEP_BINARIES_FILE" | tr '\n' ' ')"
fi

# Check if a binary name is provided by a dependency
is_dep_binary() {
  grep -qx "$1" "$DEP_BINARIES_FILE" 2>/dev/null
}

# Find a binary in the extracted archive directory
# Tries: exact name, .exe/.cmd/.bat extensions, underscore variants, _bin suffix
find_binary() {
  local extract_dir="$1"
  local binary="$2"

  # Build list of names to search for
  local names=("$binary" "${binary}.exe" "${binary}.cmd" "${binary}.bat")

  # Also try with hyphens replaced by underscores
  # Handles TypeDB naming: typedb-console -> typedb_console_bin
  local underscore_name="${binary//-/_}"
  if [ "$underscore_name" != "$binary" ]; then
    names+=("$underscore_name" "${underscore_name}_bin")
    names+=("${underscore_name}.exe" "${underscore_name}_bin.exe" "${underscore_name}.bat")
  fi

  for name in "${names[@]}"; do
    if find "$extract_dir" -name "$name" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  done

  return 1
}

# Get the cli_tools category for a binary (for error messages)
get_category() {
  local binary="$1"
  local server client
  server=$(jq -r ".databases[\"$DB\"].cliTools.server // \"\"" "$DATABASES_JSON")
  client=$(jq -r ".databases[\"$DB\"].cliTools.client // \"\"" "$DATABASES_JSON")

  if [ "$binary" = "$server" ]; then
    echo "cli_tools.server"
  elif [ "$binary" = "$client" ]; then
    echo "cli_tools.client"
  else
    echo "cli_tools.utilities"
  fi
}

# Track overall validation result
OVERALL_FAILED=0

# Find all archives
shopt -s nullglob
ARCHIVES=("$ASSETS_DIR"/*.tar.gz "$ASSETS_DIR"/*.zip)

if [ ${#ARCHIVES[@]} -eq 0 ]; then
  echo "::warning::No archives found in $ASSETS_DIR - skipping validation"
  exit 0
fi

echo "Found ${#ARCHIVES[@]} archive(s) to validate"
echo ""

for archive in "${ARCHIVES[@]}"; do
  FILENAME=$(basename "$archive")
  echo "--- Validating: $FILENAME ---"

  # Extract to temp directory
  TEMP_DIR=$(mktemp -d)

  if [[ "$archive" == *.tar.gz ]]; then
    tar -xzf "$archive" -C "$TEMP_DIR"
  elif [[ "$archive" == *.zip ]]; then
    unzip -q "$archive" -d "$TEMP_DIR"
  fi

  # Validate each required binary
  ARCHIVE_FAILED=0
  while IFS= read -r binary; do
    [ -z "$binary" ] && continue

    # Skip if provided by a dependency
    if is_dep_binary "$binary"; then
      echo "  Skip: $binary (provided by dependency)"
      continue
    fi

    if find_binary "$TEMP_DIR" "$binary"; then
      echo "  Found: $binary"
    else
      CATEGORY=$(get_category "$binary")
      echo "  MISSING: $binary (listed in $CATEGORY)"
      ARCHIVE_FAILED=1
      OVERALL_FAILED=1
    fi
  done <<< "$REQUIRED_BINARIES"

  if [ $ARCHIVE_FAILED -eq 1 ]; then
    echo ""
    echo "  Archive contents:"
    find "$TEMP_DIR" -type f -o -type l | sed "s|$TEMP_DIR/||" | sort | head -50
  fi

  rm -rf "$TEMP_DIR"
  echo ""
done

if [ $OVERALL_FAILED -eq 1 ]; then
  echo "::error::Binary validation failed for $DB - see above for details"
  exit 1
fi

echo "All required binaries validated for $DB"
