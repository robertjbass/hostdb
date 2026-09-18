/**
 * publish-release.sh: how an ALREADY PUBLISHED release gets its assets
 * replaced.
 *
 * A partial-platform re-dispatch (rebuild only linux-arm64 for a version that
 * already shipped) cannot hide behind a draft, because demoting a published
 * release would retract a tag consumers already resolve. It used to
 * `gh release upload --clobber` each replacement straight onto the public
 * names, checksums.txt last, with no rollback: a failure halfway left the
 * public release carrying a mix of new and old archives plus a stale
 * checksums.txt.
 *
 * What is pinned here: every replacement is uploaded under a
 * `<name>.staging-<run id>` name, the whole set is verified there, and only
 * then is each asset renamed onto its public name (checksums.txt last). A
 * failure before the swap deletes the staging assets and leaves the public
 * asset set untouched, and an unavailable rename endpoint refuses rather than
 * falling back to clobbering a live name.
 *
 * The new-release path (draft -> uploads -> publish) is asserted unchanged.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'builds', 'common', 'publish-release.sh')

const REPO = 'Layerbase-LLC/hostdb'
const TAG = 'postgresql-18.6.0'
const RUN_ID = '4242'
const STAGING_SUFFIX = `.staging-${RUN_ID}`
const RETIRED_SUFFIX = `.superseded-${RUN_ID}`

const ARM64 = 'postgresql-18.6.0-linux-arm64.tar.gz'
const X64 = 'postgresql-18.6.0-linux-x64.tar.gz'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * A stateful `gh` stub. It keeps the release and its assets in a JSON file, so
 * a rename really renames and a delete really deletes, and it appends every
 * invocation to calls.log so the test can assert on the call sequence.
 */
const GH_STUB = `#!/usr/bin/env bash
set -uo pipefail

STATE="$GH_STATE/release.json"
printf '%s\\n' "$*" >>"$GH_STATE/calls.log"

sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

save() { cat >"$STATE.tmp" && mv "$STATE.tmp" "$STATE"; }

sub="$1"
shift

if [[ "$sub" == "api" ]]; then
  method="GET"
  path=""
  jqprog=""
  fieldname=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --method) method="$2"; shift 2 ;;
      --jq) jqprog="$2"; shift 2 ;;
      -f) fieldname="\${2#name=}"; shift 2 ;;
      --paginate) shift ;;
      *) path="$1"; shift ;;
    esac
  done

  case "$path" in
    *releases\\?per_page*)
      if [[ -f "$STATE" ]]; then jq -c '[.]' "$STATE"; else echo '[]'; fi
      exit 0
      ;;
    *releases/tags/*)
      if [[ ! -f "$STATE" ]] || [[ "$(jq -r '.draft' "$STATE")" == "true" ]]; then
        echo "gh: Not Found (HTTP 404)" >&2
        exit 1
      fi
      if [[ -n "$jqprog" ]]; then jq -r "$jqprog" "$STATE"; else jq -c '.' "$STATE"; fi
      exit 0
      ;;
    *releases/assets/*)
      id="\${path##*/}"
      if [[ "$method" == "DELETE" ]]; then
        jq -c --argjson id "$id" '.assets |= map(select(.id != $id))' "$STATE" | save
        exit 0
      fi
      if [[ "$method" == "PATCH" ]]; then
        patches="$(cat "$GH_STATE/patch-count" 2>/dev/null || echo 0)"
        patches=$((patches + 1))
        echo "$patches" >"$GH_STATE/patch-count"
        if [[ "\${GH_PATCH_FAILS:-}" == "1" ]] \\
          || [[ "$patches" == "\${GH_PATCH_FAIL_AT:-}" ]]; then
          echo "gh: Validation Failed (HTTP 422)" >&2
          exit 1
        fi
        jq -c --argjson id "$id" --arg name "$fieldname" \\
          '.assets |= map(if .id == $id then .name = $name else . end)' "$STATE" | save
        exit 0
      fi
      echo "gh: unsupported method $method" >&2
      exit 1
      ;;
  esac
  echo "gh: unsupported api path $path" >&2
  exit 1
fi

if [[ "$sub" == "release" ]]; then
  action="$1"
  shift
  tag="$1"
  shift

  if [[ "$action" == "create" ]]; then
    jq -n --arg tag "$tag" '{tag_name: $tag, id: 1, draft: true, next_id: 100, assets: []}' | save
    exit 0
  fi

  if [[ "$action" == "edit" ]]; then
    for arg in "$@"; do
      if [[ "$arg" == "--draft=false" ]]; then
        jq -c '.draft = false' "$STATE" | save
      fi
    done
    exit 0
  fi

  if [[ "$action" == "upload" ]]; then
    file="$1"
    name="$(basename "$file")"
    size="$(wc -c <"$file" | tr -d ' ')"
    digest="sha256:$(sha_of "$file")"
    public="\${name%${STAGING_SUFFIX}}"
    if [[ -n "\${GH_BAD_DIGEST_FOR:-}" && "$public" == "\${GH_BAD_DIGEST_FOR}" ]]; then
      digest="sha256:0000000000000000000000000000000000000000000000000000000000000000"
    fi
    jq -c --arg name "$name" --argjson size "$size" --arg digest "$digest" '
      .assets |= map(select(.name != $name))
      | .next_id as $id
      | .next_id = ($id + 1)
      | .assets += [{id: $id, name: $name, size: $size, state: "uploaded", digest: $digest}]
    ' "$STATE" | save
    exit 0
  fi
fi

echo "gh: unsupported command $sub" >&2
exit 1
`

type RunResult = {
  status: number
  output: string
  calls: string[]
  state: {
    draft: boolean
    assets: { id: number; name: string; size: number; digest: string }[]
  } | null
}

function runPublish({
  published,
  badDigestFor,
  patchFails,
  patchFailAt,
}: {
  /** Seed an already-published release carrying the previous asset set. */
  published: boolean
  badDigestFor?: string
  patchFails?: boolean
  /** Fail only the Nth PATCH (1-based), to break the swap part-way through. */
  patchFailAt?: number
}): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'hostdb-publish-'))
  try {
    const binDir = join(dir, 'bin')
    const stateDir = join(dir, 'state')
    const assetsDir = join(dir, 'release-assets')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(stateDir, { recursive: true })
    mkdirSync(assetsDir, { recursive: true })

    // The freshly built assets: linux-arm64 is the rebuild, linux-x64 is the
    // untouched platform carried through by merge-release-checksums.sh.
    const newArm64 = 'rebuilt linux-arm64 archive\n'
    const keptX64 = 'unchanged linux-x64 archive\n'
    writeFileSync(join(assetsDir, ARM64), newArm64)
    writeFileSync(join(assetsDir, X64), keptX64)
    const checksums = [
      `${sha256(newArm64)}  ${ARM64}`,
      `${sha256(keptX64)}  ${X64}`,
      '',
    ].join('\n')
    writeFileSync(join(assetsDir, 'checksums.txt'), checksums)

    const notesFile = join(dir, 'body.md')
    writeFileSync(notesFile, '## PostgreSQL 18.6.0\n')

    if (published) {
      const oldArm64 = 'the previously published linux-arm64 archive\n'
      const oldChecksums = `${sha256(oldArm64)}  ${ARM64}\n`
      writeFileSync(
        join(stateDir, 'release.json'),
        JSON.stringify({
          tag_name: TAG,
          id: 1,
          draft: false,
          next_id: 100,
          assets: [
            {
              id: 10,
              name: ARM64,
              size: oldArm64.length,
              state: 'uploaded',
              digest: `sha256:${sha256(oldArm64)}`,
            },
            {
              id: 11,
              name: X64,
              size: keptX64.length,
              state: 'uploaded',
              digest: `sha256:${sha256(keptX64)}`,
            },
            {
              id: 12,
              name: 'checksums.txt',
              size: oldChecksums.length,
              state: 'uploaded',
              digest: `sha256:${sha256(oldChecksums)}`,
            },
          ],
        }),
      )
    }

    const ghPath = join(binDir, 'gh')
    writeFileSync(ghPath, GH_STUB)
    chmodSync(ghPath, 0o755)

    const result = spawnSync(
      'bash',
      [
        SCRIPT,
        '--tag',
        TAG,
        '--title',
        'PostgreSQL 18.6.0',
        '--notes-file',
        notesFile,
        '--assets-dir',
        assetsDir,
      ],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          GITHUB_REPOSITORY: REPO,
          GITHUB_RUN_ID: RUN_ID,
          GH_STATE: stateDir,
          // Exercise the retry paths without waiting out the real backoff.
          PUBLISH_RETRY_DELAYS: '0 0',
          ...(badDigestFor ? { GH_BAD_DIGEST_FOR: badDigestFor } : {}),
          ...(patchFails ? { GH_PATCH_FAILS: '1' } : {}),
          ...(patchFailAt ? { GH_PATCH_FAIL_AT: String(patchFailAt) } : {}),
        },
      },
    )

    const callsFile = join(stateDir, 'calls.log')
    const statePath = join(stateDir, 'release.json')

    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      calls: existsSync(callsFile)
        ? readFileSync(callsFile, 'utf-8').split('\n').filter(Boolean)
        : [],
      state: existsSync(statePath)
        ? JSON.parse(readFileSync(statePath, 'utf-8'))
        : null,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const uploadCalls = (calls: string[]) =>
  calls.filter((call) => call.startsWith('release upload '))

/** The basename `gh release upload` would have given each uploaded asset. */
const uploadedNames = (calls: string[]) =>
  uploadCalls(calls).map((call) => {
    const path = call.split(' ')[3] ?? ''
    return path.slice(path.lastIndexOf('/') + 1)
  })

const patchCalls = (calls: string[]) =>
  calls.filter((call) => call.startsWith('api --method PATCH '))

/** Every name a PATCH renamed an asset to, in order. */
const renamedTo = (calls: string[]) =>
  patchCalls(calls).map((call) => call.replace(/^.*\sname=/, ''))

const deletedIds = (calls: string[]) =>
  calls
    .filter((call) => call.startsWith('api --method DELETE '))
    .map((call) => call.slice(call.lastIndexOf('/') + 1))

describe('publish-release.sh on an already published release', () => {
  test('stages every replacement, verifies it, then renames it in with checksums.txt last', () => {
    const { status, output, calls, state } = runPublish({ published: true })

    assert.equal(status, 0, output)

    // 1. Nothing is ever uploaded under a live asset name.
    const names = uploadedNames(calls)
    assert.deepEqual(names, [
      `${ARM64}${STAGING_SUFFIX}`,
      `${X64}${STAGING_SUFFIX}`,
      `checksums.txt${STAGING_SUFFIX}`,
    ])
    for (const call of uploadCalls(calls)) {
      assert.match(call, /--clobber$/)
      assert.ok(
        call.includes(STAGING_SUFFIX),
        `upload --clobber targeted a public name: ${call}`,
      )
    }

    // 2. Verification happens before the first rename.
    const firstPatch = calls.findIndex((call) =>
      call.startsWith('api --method PATCH '),
    )
    const lastUpload = calls
      .map((c) => c.startsWith('release upload '))
      .lastIndexOf(true)
    assert.ok(firstPatch > lastUpload)
    assert.match(output, /digest matches checksums\.txt/)

    // 3. Each asset is retired out of the way, then the staged one takes the
    //    public name, and checksums.txt is the last public name to change.
    assert.deepEqual(renamedTo(calls), [
      `${ARM64}${RETIRED_SUFFIX}`,
      ARM64,
      `${X64}${RETIRED_SUFFIX}`,
      X64,
      `checksums.txt${RETIRED_SUFFIX}`,
      'checksums.txt',
    ])

    // 4. The release ends up holding exactly the new asset set, still published.
    assert.equal(state?.draft, false)
    assert.ok(!calls.some((call) => call.includes('--draft=false')))
    assert.deepEqual(
      state?.assets.map((asset) => asset.name).sort(),
      [ARM64, X64, 'checksums.txt'].sort(),
    )
    const arm64 = state?.assets.find((asset) => asset.name === ARM64)
    assert.equal(
      arm64?.digest,
      `sha256:${sha256('rebuilt linux-arm64 archive\n')}`,
    )
    // every superseded asset was cleaned up
    assert.equal(deletedIds(calls).sort().join(','), '10,11,12')
  })

  test('a verification failure before the swap deletes the staging assets and renames nothing', () => {
    const { status, output, calls, state } = runPublish({
      published: true,
      badDigestFor: ARM64,
    })

    assert.notEqual(status, 0)
    assert.match(output, /digest mismatch/)
    assert.deepEqual(patchCalls(calls), [])

    // the three staging assets this run uploaded are removed again
    assert.equal(deletedIds(calls).length, 3)
    assert.match(output, /was left untouched/)

    // the public asset set is exactly what it was before the run
    assert.deepEqual(
      state?.assets.map((asset) => asset.name).sort(),
      [ARM64, X64, 'checksums.txt'].sort(),
    )
    const arm64 = state?.assets.find((asset) => asset.name === ARM64)
    assert.equal(
      arm64?.digest,
      `sha256:${sha256('the previously published linux-arm64 archive\n')}`,
    )
    assert.equal(state?.draft, false)
  })

  test('an unavailable rename endpoint refuses instead of clobbering a live name', () => {
    const { status, output, calls, state } = runPublish({
      published: true,
      patchFails: true,
    })

    assert.notEqual(status, 0)
    assert.match(output, /refusing to replace published assets in place/)
    // no upload ever targeted a public name, so nothing was clobbered
    for (const call of uploadCalls(calls)) {
      assert.ok(call.includes(STAGING_SUFFIX))
    }
    assert.equal(deletedIds(calls).length, 3)
    assert.deepEqual(
      state?.assets.map((asset) => asset.name).sort(),
      [ARM64, X64, 'checksums.txt'].sort(),
    )
    const arm64 = state?.assets.find((asset) => asset.name === ARM64)
    assert.equal(
      arm64?.digest,
      `sha256:${sha256('the previously published linux-arm64 archive\n')}`,
    )
  })

  test('a swap that fails part-way reports what moved and keeps the staging assets', () => {
    // The 4th PATCH: linux-arm64 is fully swapped, and linux-x64's previous
    // asset has already been renamed aside, so the failure lands with a public
    // name absent rather than still holding the old asset.
    const { status, output, calls, state } = runPublish({
      published: true,
      patchFailAt: 4,
    })

    assert.notEqual(status, 0)
    assert.match(output, /the asset swap on .* failed part-way/)

    // the report separates what is now public from what is not
    const swapped = output.slice(
      output.indexOf('swapped (now public):'),
      output.indexOf('NOT swapped'),
    )
    const notSwapped = output.slice(output.indexOf('NOT swapped'))
    assert.match(swapped, new RegExp(ARM64.replace(/\./g, '\\.')))
    assert.doesNotMatch(swapped, new RegExp(X64.replace(/\./g, '\\.')))
    assert.match(notSwapped, new RegExp(`\\s${X64.replace(/\./g, '\\.')}\\n`))
    assert.match(notSwapped, /\schecksums\.txt\n/)

    // the superseded asset the failed swap left behind is named
    assert.match(output, /superseded asset left behind by the failed swap/)
    assert.match(
      output,
      new RegExp(`${X64}${RETIRED_SUFFIX}`.replace(/\./g, '\\.')),
    )

    // the verified replacements stay on the release; nothing is cleaned up
    assert.doesNotMatch(output, /Removing the staging assets/)
    assert.doesNotMatch(output, /was left untouched/)
    const remaining = state?.assets.map((asset) => asset.name) ?? []
    assert.ok(remaining.includes(`${X64}${STAGING_SUFFIX}`))
    assert.ok(remaining.includes(`checksums.txt${STAGING_SUFFIX}`))
    // only the already-swapped asset's previous copy was deleted
    assert.deepEqual(deletedIds(calls), ['10'])

    // checksums.txt is swapped last, so the old one is still the public file
    assert.ok(remaining.includes('checksums.txt'))
    assert.ok(remaining.includes(ARM64))
  })
})

describe('publish-release.sh on a new release', () => {
  test('still creates a draft, uploads under public names, and publishes at the end', () => {
    const { status, output, calls, state } = runPublish({ published: false })

    assert.equal(status, 0, output)

    assert.ok(calls[1]?.startsWith(`release create ${TAG} --draft`))
    assert.deepEqual(uploadedNames(calls), [ARM64, X64, 'checksums.txt'])
    assert.ok(!calls.some((call) => call.includes(STAGING_SUFFIX)))
    assert.deepEqual(patchCalls(calls), [])
    assert.equal(calls[calls.length - 1], `release edit ${TAG} --draft=false`)
    assert.equal(state?.draft, false)
    assert.deepEqual(
      state?.assets.map((asset) => asset.name).sort(),
      [ARM64, X64, 'checksums.txt'].sort(),
    )
  })
})
