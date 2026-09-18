#!/usr/bin/env bash
# merge-release-checksums.sh - Keep a partial-platform re-release from wiping
#                              the checksums of platforms it did not rebuild.
#
# Usage: merge-release-checksums.sh <release-tag> <checksums-file>
#
# Why this exists:
#   A dispatch with `platforms: linux-x64` only builds that one platform, so the
#   checksums.txt assembled by the release job contains ONE line. Handing that
#   file to softprops/action-gh-release REPLACES the release's existing
#   checksums.txt wholesale rather than merging into it.
#
#   releases.json is derived from checksums.txt: build-releases-json.ts walks
#   the release's assets and skips any asset with no checksum line. So a
#   one-platform re-release silently reduced the version's `platforms` map in
#   releases.json to that one platform, dropping the other four even though
#   their tarballs were still on the release and in R2. That is exactly what
#   happened to postgresql 18.6.0 and 18.4.0 on 2026-09-09.
#
#   This script downloads the checksums.txt already attached to the release (if
#   any) and merges it UNDER the freshly built one: a rebuilt platform's new
#   line wins, and every platform this run did not touch keeps its existing
#   line. A brand new release simply has nothing to merge.
#
# Env:
#   GH_TOKEN / GITHUB_TOKEN - passed through to `gh` for the download.
#   MERGE_RETRY_DELAYS      - test-only override for the retry backoff seconds.

set -euo pipefail

TAG="${1:?usage: merge-release-checksums.sh <release-tag> <checksums-file>}"
NEW_FILE="${2:?usage: merge-release-checksums.sh <release-tag> <checksums-file>}"

if [[ ! -f "$NEW_FILE" ]]; then
  echo "ERROR: checksums file not found: $NEW_FILE" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
EXISTING_FILE="$WORK_DIR/existing-checksums.txt"

echo "Merging checksums for release $TAG"
echo "Newly built:"
cat "$NEW_FILE"

# A first-ever release has no checksums.txt to merge - not an error. Anything
# else (auth, rate limit, a 5xx, a network blip) IS an error: treating it as
# "nothing to merge" is how a partial-platform re-run would publish a
# checksums.txt holding only the platforms it rebuilt, which is the exact
# regression this script exists to prevent. So only a genuine not-found
# proceeds with an empty file; every other failure retries, then fails the step.
DOWNLOAD_ATTEMPTS=3
# Whitespace-separated, overridable so the retry path can be tested quickly.
read -r -a RETRY_DELAYS <<<"${MERGE_RETRY_DELAYS:-5 15}"

NOT_FOUND_PATTERN='release not found|no assets match|no asset found|HTTP 404'
ERR_FILE="$WORK_DIR/gh-stderr.txt"

attempt=1
while true; do
  if gh release download "$TAG" \
    --pattern checksums.txt \
    --output "$EXISTING_FILE" \
    --clobber 2>"$ERR_FILE"; then
    echo ""
    echo "Existing checksums on $TAG:"
    cat "$EXISTING_FILE"
    break
  fi

  if grep -qiE "$NOT_FOUND_PATTERN" "$ERR_FILE"; then
    echo ""
    echo "No existing checksums.txt on $TAG (new release), nothing to merge"
    : >"$EXISTING_FILE"
    break
  fi

  if [[ $attempt -ge $DOWNLOAD_ATTEMPTS ]]; then
    echo "ERROR: could not read the existing checksums.txt of $TAG" >&2
    echo "  refusing to merge, a partial checksums.txt would drop platforms" >&2
    cat "$ERR_FILE" >&2
    exit 1
  fi

  delay="${RETRY_DELAYS[$((attempt - 1))]}"
  echo "  checksums download failed, retrying in ${delay}s" >&2
  cat "$ERR_FILE" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done

# New lines first so a rebuilt platform's checksum wins; existing lines are kept
# only for filenames the new file does not mention. The filename is the last
# whitespace-separated field ("<sha>  <name>" or "<sha> *<name>" binary mode).
awk '
  { name = $NF; sub(/^\*/, "", name) }
  name != "" && !(name in seen) { seen[name] = 1; print }
' "$NEW_FILE" "$EXISTING_FILE" | sort -k2 >"$WORK_DIR/merged.txt"

mv "$WORK_DIR/merged.txt" "$NEW_FILE"

echo ""
echo "Merged checksums:"
cat "$NEW_FILE"
