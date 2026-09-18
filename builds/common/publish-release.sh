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
#   re-dispatch case) cannot use a draft, because demoting a published release
#   would retract a tag consumers already resolve. It gets the equivalent
#   protection from a STAGED SWAP instead: every replacement asset is uploaded
#   under a throwaway `<name>.staging-<stamp>` name, the whole set is verified
#   there, and only then is each one renamed onto its public name (one PATCH per
#   asset, checksums.txt last). No unverified byte ever carries a public name,
#   and a failure before the swap deletes the staging assets and leaves the
#   public asset set exactly as it was. A published release is never demoted
#   back to a draft.
#
# Env:
#   GH_TOKEN / GITHUB_TOKEN - `gh` auth. Needs `contents: write`, nothing more.
#   GITHUB_REPOSITORY       - owner/repo, set by Actions. Falls back to `gh`.
#   GITHUB_RUN_ID           - used as the staging-name stamp. Falls back to a
#                             timestamp.
#   PUBLISH_RETRY_DELAYS    - test-only override for the retry backoff seconds.

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
# retry is about the former and the operator alert about the latter. The same
# backoff covers the rename/delete API calls of the staged swap.
read -r -a RETRY_DELAYS <<<"${PUBLISH_RETRY_DELAYS:-5 15}"
UPLOAD_ATTEMPTS=$((${#RETRY_DELAYS[@]} + 1))

# A rename or delete is retried only when the failure looks transient. Anything
# else - a 404, a 422, a permissions error, an endpoint this API does not offer
# - is final: the swap refuses rather than falling back to clobbering a live
# asset name, which is the behavior this script exists to remove.
API_TRANSIENT_PATTERN='HTTP 5[0-9][0-9]|timeout|timed out|connection reset|connection refused|EOF|temporarily|try again|rate limit'

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

STAMP="${GITHUB_RUN_ID:-$(date +%s)}"
STAGING_SUFFIX=".staging-$STAMP"
RETIRED_SUFFIX=".superseded-$STAMP"

WORK_DIR="$(mktemp -d)"
STAGE_DIR="$WORK_DIR/staging"
mkdir -p "$STAGE_DIR"

# Set once the swap has made its first change to the published asset set. Until
# then a failure is fully recoverable: the staging assets are deleted and the
# public release is exactly as it was.
STAGED_SWAP="false"
SWAP_TOUCHED="false"
# Set while an asset's previous copy has been renamed aside but its verified
# replacement has not yet taken the public name. If the swap fails in that
# window the public name is absent rather than still holding the old asset, so
# the failure report has to name the retired copy.
RETIRED_PENDING=""

cleanup_staging_assets() {
  local list id
  list="$(
    gh api "repos/$REPO/releases/tags/$TAG" 2>/dev/null \
      | jq -r --arg sfx "$STAGING_SUFFIX" \
        '.assets[]? | select(.name | endswith($sfx)) | .id' \
      || true
  )"
  [[ -n "$list" ]] || return 0
  echo "Removing the staging assets this run uploaded" >&2
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    if gh api --method DELETE "repos/$REPO/releases/assets/$id" >/dev/null 2>&1; then
      echo "  deleted staging asset $id" >&2
    else
      echo "  WARNING: could not delete staging asset $id" >&2
    fi
  done <<<"$list"
}

on_exit() {
  local status=$?
  if [[ $status -ne 0 && "$STAGED_SWAP" == "true" && "$SWAP_TOUCHED" == "false" ]]; then
    cleanup_staging_assets
    echo "The published release $TAG was left untouched" >&2
  fi
  rm -rf "$WORK_DIR"
  return $status
}
trap on_exit EXIT

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
# The tag is filtered with an external `jq --arg` rather than gh's `--jq`, which
# takes only a literal program: splicing the tag into that program would let a
# crafted tag rewrite the filter. `jq -s` joins the paginated pages.
EXISTING="$(
  gh api "repos/$REPO/releases?per_page=100" --paginate 2>/dev/null \
    | jq -s -c --arg tag "$TAG" '[.[][] | select(.tag_name == $tag)][0] // empty' \
    || true
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
    gh release edit "$TAG" \
      --title "$TITLE" \
      --notes-file "$NOTES_FILE" \
      --prerelease="$PRERELEASE"
  else
    # A published release cannot be staged behind a draft without retracting a
    # tag consumers already resolve, so the replacement assets are staged under
    # their own names on the same release and swapped in once the whole set is
    # verified. Title and notes are edited only after that swap, so a run that
    # fails early leaves the release entirely as it was.
    echo "Release $TAG is already published; staging its replacement assets"
    PUBLISH_AT_END="false"
    STAGED_SWAP="true"
  fi
fi

# ─── Upload sequentially, with a per-file retry ──────────────────────────────

# `--clobber` only ever targets the name being uploaded. In the staged path that
# is a `.staging-<stamp>` name this run owns, so a retry overwrites its own
# partial upload and never a live asset.
upload_one() {
  local path="$1" name="$2" attempt=1 delay
  while true; do
    echo ""
    echo "Uploading $name (attempt $attempt/$UPLOAD_ATTEMPTS)"
    if gh release upload "$TAG" "$path" --clobber; then
      echo "  uploaded $name"
      return 0
    fi
    if [[ $attempt -ge $UPLOAD_ATTEMPTS ]]; then
      echo "ERROR: failed to upload $name after $UPLOAD_ATTEMPTS attempts" >&2
      return 1
    fi
    delay="${RETRY_DELAYS[$((attempt - 1))]}"
    echo "  upload failed, retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

# The upload name comes from the file's basename, so a staged upload is fed a
# symlink (a copy if the filesystem refuses one) carrying the staging name.
staged_path_for() {
  local asset="$1" name="$2" abs link
  abs="$(cd "$(dirname "$asset")" && pwd)/$(basename "$asset")"
  link="$STAGE_DIR/${name}${STAGING_SUFFIX}"
  ln -sf "$abs" "$link" 2>/dev/null || cp "$asset" "$link"
  echo "$link"
}

remote_name_for() {
  local name="$1"
  if [[ "$STAGED_SWAP" == "true" ]]; then
    echo "${name}${STAGING_SUFFIX}"
  else
    echo "$name"
  fi
}

for asset in "${ASSETS[@]}"; do
  name="$(basename "$asset")"
  if [[ "$STAGED_SWAP" == "true" ]]; then
    upload_one "$(staged_path_for "$asset" "$name")" "${name}${STAGING_SUFFIX}"
  else
    upload_one "$asset" "$name"
  fi
done

# ─── Verify what actually landed ─────────────────────────────────────────────

echo ""
echo "Verifying uploaded assets"

REMOTE="$(gh api "repos/$REPO/releases/tags/$TAG" --jq '.assets' 2>/dev/null || true)"
if [[ -z "$REMOTE" || "$REMOTE" == "null" ]]; then
  # Still a draft, so the tag endpoint cannot see it. Fall back to the list.
  REMOTE="$(
    gh api "repos/$REPO/releases?per_page=100" --paginate \
      | jq -s -c --arg tag "$TAG" '[.[][] | select(.tag_name == $tag)][0].assets // empty'
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
  remote_name="$(remote_name_for "$name")"
  entry="$(echo "$REMOTE" | jq -c --arg name "$remote_name" '[.[] | select(.name == $name)][0] // empty')"

  if [[ -z "$entry" ]]; then
    echo "ERROR: $remote_name is not attached to $TAG" >&2
    exit 1
  fi

  state="$(echo "$entry" | jq -r '.state')"
  if [[ "$state" != "uploaded" ]]; then
    echo "ERROR: $remote_name is in state '$state', expected 'uploaded'" >&2
    exit 1
  fi

  local_size="$(wc -c <"$asset" | tr -d ' ')"
  remote_size="$(echo "$entry" | jq -r '.size')"
  if [[ "$local_size" != "$remote_size" ]]; then
    echo "ERROR: $remote_name is $remote_size bytes on the release, $local_size locally" >&2
    exit 1
  fi

  digest="$(echo "$entry" | jq -r '.digest // ""')"
  if [[ -n "$digest" ]]; then
    DIGESTS_SEEN=$((DIGESTS_SEEN + 1))
  fi

  # checksums.txt does not list itself.
  if [[ "$name" == "checksums.txt" ]]; then
    echo "  $remote_name: $remote_size bytes, uploaded"
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
      echo "ERROR: $remote_name digest mismatch" >&2
      echo "  release:       $digest" >&2
      echo "  checksums.txt: sha256:$expected" >&2
      exit 1
    fi
    DIGESTS_CHECKED=$((DIGESTS_CHECKED + 1))
    echo "  $remote_name: $remote_size bytes, digest matches checksums.txt"
  else
    echo "  $remote_name: $remote_size bytes, uploaded (API exposes no digest)"
  fi
done

if [[ "$DIGESTS_SEEN" -eq 0 ]]; then
  echo "Note: this API does not expose asset digests; verified sizes only"
else
  echo "Verified $DIGESTS_CHECKED asset digest(s) against checksums.txt"
fi

# ─── Swap the verified staging assets onto their public names ────────────────

asset_id_for() {
  local wanted="$1"
  echo "$REMOTE" | jq -r --arg name "$wanted" '[.[] | select(.name == $name)][0].id // ""'
}

rename_asset() {
  local id="$1" new_name="$2" attempt=1 delay err="$WORK_DIR/api-stderr.txt"
  while true; do
    if gh api --method PATCH "repos/$REPO/releases/assets/$id" \
      -f "name=$new_name" >/dev/null 2>"$err"; then
      return 0
    fi
    if ! grep -qiE "$API_TRANSIENT_PATTERN" "$err"; then
      cat "$err" >&2
      return 1
    fi
    if [[ $attempt -ge $UPLOAD_ATTEMPTS ]]; then
      cat "$err" >&2
      return 1
    fi
    delay="${RETRY_DELAYS[$((attempt - 1))]}"
    echo "  rename failed, retrying in ${delay}s" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

# Reports the state of a swap that failed part-way and exits non-zero. Before
# the first change (SWAP_TOUCHED=false) the EXIT trap removes the staging assets
# and the public release is untouched, which is also how an unavailable rename
# endpoint is handled: refuse, never fall back to clobbering a live name.
report_swap_failure() {
  local failed_index="$1" i
  if [[ "$SWAP_TOUCHED" == "false" ]]; then
    echo "ERROR: could not rename release assets on $TAG" >&2
    echo "  refusing to replace published assets in place" >&2
    exit 1
  fi
  echo "ERROR: the asset swap on $TAG failed part-way" >&2
  echo "  swapped (now public):" >&2
  for ((i = 0; i < failed_index; i++)); do
    echo "    $(basename "${ASSETS[$i]}")" >&2
  done
  echo "  NOT swapped (public name still holds the previous asset):" >&2
  for ((i = failed_index; i < ${#ASSETS[@]}; i++)); do
    echo "    $(basename "${ASSETS[$i]}")" >&2
  done
  if [[ -n "$RETIRED_PENDING" ]]; then
    echo "  superseded asset left behind by the failed swap:" >&2
    echo "    $RETIRED_PENDING" >&2
    echo "    that public name is absent until the swap is finished" >&2
  fi
  echo "  verified replacements for those remain under ${STAGING_SUFFIX} names" >&2
  echo "  re-run this workflow to finish the swap" >&2
  exit 1
}

if [[ "$STAGED_SWAP" == "true" ]]; then
  echo ""
  echo "Swapping the verified assets onto their public names"

  # Newline separated rather than an array: an empty array under `set -u` is an
  # error on the bash 3.2 that ships with macOS, where this script is tested.
  LEFTOVERS=""

  for ((idx = 0; idx < ${#ASSETS[@]}; idx++)); do
    name="$(basename "${ASSETS[$idx]}")"
    staging_id="$(asset_id_for "${name}${STAGING_SUFFIX}")"
    old_id="$(asset_id_for "$name")"

    if [[ -z "$staging_id" ]]; then
      echo "ERROR: no id for the staged ${name}${STAGING_SUFFIX}" >&2
      report_swap_failure "$idx"
    fi

    # The old asset is renamed out of the way first rather than deleted, so the
    # very first API call of the swap is a rename: if the endpoint is
    # unavailable, nothing has been changed yet and the run refuses cleanly.
    if [[ -n "$old_id" ]]; then
      if ! rename_asset "$old_id" "${name}${RETIRED_SUFFIX}"; then
        report_swap_failure "$idx"
      fi
      SWAP_TOUCHED="true"
      RETIRED_PENDING="${name}${RETIRED_SUFFIX}"
    fi

    if ! rename_asset "$staging_id" "$name"; then
      report_swap_failure "$idx"
    fi
    SWAP_TOUCHED="true"
    RETIRED_PENDING=""
    echo "  $name swapped in"

    if [[ -n "$old_id" ]]; then
      if ! gh api --method DELETE "repos/$REPO/releases/assets/$old_id" >/dev/null 2>&1; then
        echo "  WARNING: could not delete the superseded ${name}${RETIRED_SUFFIX}" >&2
        LEFTOVERS="${LEFTOVERS}  ${name}${RETIRED_SUFFIX}"$'\n'
      fi
    fi
  done

  if [[ -n "$LEFTOVERS" ]]; then
    echo ""
    echo "Superseded assets left on $TAG (no checksums.txt line, so the manifest"
    echo "ignores them); delete them by hand:"
    printf '%s' "$LEFTOVERS"
  fi

  gh release edit "$TAG" \
    --title "$TITLE" \
    --notes-file "$NOTES_FILE" \
    --prerelease="$PRERELEASE"
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
