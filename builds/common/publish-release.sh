#!/usr/bin/env bash
# publish-release.sh - Create a GitHub Release as a draft, upload its assets one
#                      at a time with retries, verify them against
#                      checksums.txt, and only then publish it.
#
# Usage:
#   publish-release.sh --tag <tag> --title <title> --notes-file <file> \
#                      --assets-dir <dir> [--target <sha>] [--prerelease true|false]
#
# Why this exists:
#   Every release workflow used to hand ./release-assets to
#   softprops/action-gh-release, which uploads all assets CONCURRENTLY, has no
#   per-file retry, and publishes the release before the uploads are verified.
#   On the 2026-09-17 MariaDB wave 5 of 8 attempts failed or stalled on the
#   upload step alone: "Error saving asset", "Headers Timeout Error", "Error
#   creating asset temp dir", and one 46-minute stall on the 450 MB linux-x64
#   archive that had to be finished by hand with `gh release upload` - which
#   took 44 seconds. Six parallel multi-hundred-MB uploads is the common factor.
#
#   Two properties this script buys beyond the retries:
#
#   1. The release stays a DRAFT for the whole upload. A draft has no git tag
#      and is invisible to the unauthenticated API, so a run that dies midway
#      leaves nothing for a consumer - or for build-releases-json.ts - to
#      snapshot. A draft counted mid-upload is how releases.json briefly
#      recorded mariadb 12.3.3 with 3 platforms and `releasedAt: null`.
#   2. checksums.txt uploads LAST. releases.json is derived from it, so a
#      partial run can never leave a checksums.txt describing assets that are
#      not on the release.
#
#   Re-running against an ALREADY PUBLISHED release (the partial-platform
#   re-dispatch case) updates its title, notes and assets in place and leaves it
#   published - it is never demoted back to a draft.
#
# Env:
#   GH_TOKEN / GITHUB_TOKEN - `gh` auth. Needs `contents: write`, nothing more.
#   GITHUB_REPOSITORY       - owner/repo, set by Actions. Falls back to `gh`.

set -euo pipefail

TAG=""
TITLE=""
NOTES_FILE=""
ASSETS_DIR=""
TARGET="${GITHUB_SHA:-}"
PRERELEASE="false"

# Three attempts per file. The delays sit between attempts, so a file gets one
# immediate try, then +5s, then +15s. A GitHub asset upload either fails fast
# with a 5xx/timeout or stalls; `gh` has its own per-request timeouts, so the
# retry is about the former and the operator alert about the latter.
UPLOAD_ATTEMPTS=3
RETRY_DELAYS=(5 15)

usage() {
  cat >&2 <<'USAGE'
usage: publish-release.sh --tag <tag> --title <title> --notes-file <file>
                          --assets-dir <dir> [--target <sha>]
                          [--prerelease true|false]
USAGE
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --title)
      TITLE="${2:-}"
      shift 2
      ;;
    --notes-file)
      NOTES_FILE="${2:-}"
      shift 2
      ;;
    --assets-dir)
      ASSETS_DIR="${2:-}"
      shift 2
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --prerelease)
      PRERELEASE="${2:-false}"
      shift 2
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      ;;
  esac
done

[[ -n "$TAG" ]] || usage
[[ -n "$TITLE" ]] || usage
[[ -n "$NOTES_FILE" ]] || usage
[[ -n "$ASSETS_DIR" ]] || usage

if [[ ! -f "$NOTES_FILE" ]]; then
  echo "ERROR: notes file not found: $NOTES_FILE" >&2
  exit 1
fi

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "ERROR: assets directory not found: $ASSETS_DIR" >&2
  exit 1
fi

if [[ "$PRERELEASE" != "true" && "$PRERELEASE" != "false" ]]; then
  echo "ERROR: --prerelease takes 'true' or 'false', got '$PRERELEASE'" >&2
  exit 1
fi

REPO="${GITHUB_REPOSITORY:-}"
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

# ─── Collect the assets, deterministically, checksums.txt last ───────────────

ARCHIVES=()
while IFS= read -r file; do
  ARCHIVES+=("$file")
done < <(
  find "$ASSETS_DIR" -maxdepth 1 -type f \
    \( -name '*.tar.gz' -o -name '*.zip' \) | LC_ALL=C sort
)

if [[ ${#ARCHIVES[@]} -eq 0 ]]; then
  echo "ERROR: no .tar.gz or .zip assets in $ASSETS_DIR" >&2
  exit 1
fi

CHECKSUMS_FILE="$ASSETS_DIR/checksums.txt"
if [[ ! -f "$CHECKSUMS_FILE" ]]; then
  echo "ERROR: $CHECKSUMS_FILE not found - releases.json is derived from it" >&2
  exit 1
fi

ASSETS=("${ARCHIVES[@]}" "$CHECKSUMS_FILE")

echo "Publishing release $TAG ($REPO)"
echo "Assets to upload, in order:"
for asset in "${ASSETS[@]}"; do
  echo "  $(basename "$asset") ($(wc -c <"$asset" | tr -d ' ') bytes)"
done

# ─── Create as a draft, or adopt the existing release ────────────────────────

# Looked up through the list endpoint rather than /releases/tags/<tag> because
# the latter does not return drafts, and a re-run after a failed upload has to
# find the draft the previous run left behind.
EXISTING="$(
  gh api "repos/$REPO/releases?per_page=100" --paginate \
    --jq "[.[] | select(.tag_name == \"$TAG\")][0] // empty" 2>/dev/null || true
)"

PUBLISH_AT_END="true"

if [[ -z "$EXISTING" ]]; then
  echo ""
  echo "Creating draft release $TAG"
  CREATE_ARGS=(
    "$TAG"
    --draft
    --title "$TITLE"
    --notes-file "$NOTES_FILE"
  )
  if [[ -n "$TARGET" ]]; then
    CREATE_ARGS+=(--target "$TARGET")
  fi
  if [[ "$PRERELEASE" == "true" ]]; then
    CREATE_ARGS+=(--prerelease)
  fi
  gh release create "${CREATE_ARGS[@]}"
else
  WAS_DRAFT="$(echo "$EXISTING" | jq -r '.draft')"
  echo ""
  if [[ "$WAS_DRAFT" == "true" ]]; then
    echo "Release $TAG already exists as a draft; reusing it"
  else
    echo "Release $TAG is already published; updating it in place"
    PUBLISH_AT_END="false"
  fi
  gh release edit "$TAG" \
    --title "$TITLE" \
    --notes-file "$NOTES_FILE" \
    --prerelease="$PRERELEASE"
fi

# ─── Upload sequentially, with a per-file retry ──────────────────────────────

for asset in "${ASSETS[@]}"; do
  name="$(basename "$asset")"
  attempt=1
  while true; do
    echo ""
    echo "Uploading $name (attempt $attempt/$UPLOAD_ATTEMPTS)"
    if gh release upload "$TAG" "$asset" --clobber; then
      echo "  uploaded $name"
      break
    fi
    if [[ $attempt -ge $UPLOAD_ATTEMPTS ]]; then
      echo "ERROR: failed to upload $name after $UPLOAD_ATTEMPTS attempts" >&2
      exit 1
    fi
    delay="${RETRY_DELAYS[$((attempt - 1))]}"
    echo "  upload failed, retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
done

# ─── Verify what actually landed ─────────────────────────────────────────────

echo ""
echo "Verifying uploaded assets"

REMOTE="$(gh api "repos/$REPO/releases/tags/$TAG" --jq '.assets' 2>/dev/null || true)"
if [[ -z "$REMOTE" || "$REMOTE" == "null" ]]; then
  # Still a draft, so the tag endpoint cannot see it. Fall back to the list.
  REMOTE="$(
    gh api "repos/$REPO/releases?per_page=100" --paginate \
      --jq "[.[] | select(.tag_name == \"$TAG\")][0].assets // empty"
  )"
fi

if [[ -z "$REMOTE" || "$REMOTE" == "null" ]]; then
  echo "ERROR: could not read the assets of $TAG back from the API" >&2
  exit 1
fi

REMOTE_COUNT="$(echo "$REMOTE" | jq 'length')"
if [[ "$REMOTE_COUNT" -lt ${#ASSETS[@]} ]]; then
  echo "ERROR: $TAG has $REMOTE_COUNT assets, expected at least ${#ASSETS[@]}" >&2
  echo "$REMOTE" | jq -r '.[] | "  \(.name) \(.size) \(.state)"' >&2
  exit 1
fi

# `digest` is a newer release-asset field ("sha256:<hex>"). Where the API
# exposes it, it is checked against checksums.txt; where it does not, the size
# comparison is the verification.
DIGESTS_SEEN=0
DIGESTS_CHECKED=0

for asset in "${ASSETS[@]}"; do
  name="$(basename "$asset")"
  entry="$(echo "$REMOTE" | jq -c --arg name "$name" '[.[] | select(.name == $name)][0] // empty')"

  if [[ -z "$entry" ]]; then
    echo "ERROR: $name is not attached to $TAG" >&2
    exit 1
  fi

  state="$(echo "$entry" | jq -r '.state')"
  if [[ "$state" != "uploaded" ]]; then
    echo "ERROR: $name is in state '$state', expected 'uploaded'" >&2
    exit 1
  fi

  local_size="$(wc -c <"$asset" | tr -d ' ')"
  remote_size="$(echo "$entry" | jq -r '.size')"
  if [[ "$local_size" != "$remote_size" ]]; then
    echo "ERROR: $name is $remote_size bytes on the release, $local_size locally" >&2
    exit 1
  fi

  digest="$(echo "$entry" | jq -r '.digest // ""')"
  if [[ -n "$digest" ]]; then
    DIGESTS_SEEN=$((DIGESTS_SEEN + 1))
  fi

  # checksums.txt does not list itself.
  if [[ "$name" == "checksums.txt" ]]; then
    echo "  $name: $remote_size bytes, uploaded"
    continue
  fi

  expected="$(awk -v want="$name" '
    { n = $NF; sub(/^\*/, "", n) }
    n == want { print $1; exit }
  ' "$CHECKSUMS_FILE")"

  if [[ -z "$expected" ]]; then
    echo "ERROR: $name has no line in checksums.txt" >&2
    exit 1
  fi

  if [[ -n "$digest" ]]; then
    if [[ "$digest" != "sha256:$expected" ]]; then
      echo "ERROR: $name digest mismatch" >&2
      echo "  release:       $digest" >&2
      echo "  checksums.txt: sha256:$expected" >&2
      exit 1
    fi
    DIGESTS_CHECKED=$((DIGESTS_CHECKED + 1))
    echo "  $name: $remote_size bytes, digest matches checksums.txt"
  else
    echo "  $name: $remote_size bytes, uploaded (API exposes no digest)"
  fi
done

if [[ "$DIGESTS_SEEN" -eq 0 ]]; then
  echo "Note: this API does not expose asset digests; verified sizes only"
else
  echo "Verified $DIGESTS_CHECKED asset digest(s) against checksums.txt"
fi

# ─── Publish ─────────────────────────────────────────────────────────────────

if [[ "$PUBLISH_AT_END" == "true" ]]; then
  echo ""
  echo "Publishing $TAG"
  gh release edit "$TAG" --draft=false
else
  echo ""
  echo "$TAG was already published; left as is"
fi

echo ""
echo "Release $TAG is live with ${#ASSETS[@]} verified asset(s)"
