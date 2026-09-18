# builds/common

Shared build scripts used by all engine release workflows, plus general reference material for macOS native builds.

## Shared scripts

### `validate-binaries.sh <database> <release-assets-dir>`

Every release workflow validates that archives contain all required binaries before creating the GitHub Release. This prevents shipping incomplete releases (e.g., PostgreSQL 17.7.0 once shipped without `psql`, `pg_dump`, and other client tools, breaking SpinDB's backup/restore).

The script:

1. Extracts the version from archive filenames (e.g., `mysql-9.6.0-darwin-arm64.tar.gz` → `9.6.0`).
2. Checks for version-level `cliTools` overrides in `databases.json`, then falls back to engine-level `cliTools`.
3. Collects all non-null binary names (skips `enhanced` tools).
4. For each `.tar.gz` / `.zip` in the release-assets directory, extracts and searches for each required binary.
5. Fails the build with clear errors if any binary is missing.

**Dependency-aware:** Some databases depend on others for client tools. For example, QuestDB lists `psql` as its client but depends on PostgreSQL — `psql` comes from the PostgreSQL install, not the QuestDB tarball. The script reads `dependencies` from `databases.json` (top-level and per-version) and skips binaries provided by dependency databases.

**Name-variant handling:** The script handles naming differences between `cli_tools` and actual binaries:
- Windows extensions: `.exe`, `.cmd`, `.bat`
- Hyphen-to-underscore: `typedb-console` → `typedb_console`, `typedb_console_bin`
- Searches recursively through the entire extracted archive (handles `bin/`, root, and custom paths like TypeDB's `server/` and `console/`).

**Used by:** all 22 release workflows. Add a "Validate required binaries" step in each workflow's `release` job, after artifact preparation and before "Publish release":

```yaml
- name: Validate required binaries
  run: |
    chmod +x builds/common/validate-binaries.sh
    ./builds/common/validate-binaries.sh <database-id> ./release-assets
```

### `check-glibc-floor.sh <database> <release-assets-dir>`

Fails a release whose Linux artifacts need a newer glibc than hostdb's oldest supported target.

Two 2026-08 releases shipped green and only failed two repos downstream, in spindb's Ubuntu 22.04 CI: qdrant 1.18.3 (upstream gnu build referenced `GLIBC_2.38`) and couchdb 3.5.2 (docker-extract followed the upstream image from bookworm to trixie and inherited glibc 2.41). Nothing in the pipeline looked at what the binaries actually require.

For every `linux-x64` / `linux-arm64` archive the script extracts the tree, finds every ELF file by magic bytes, reads the highest `GLIBC_x.y.z` symbol version each one references (`readelf -V`, falling back to `objdump -T`), and fails if anything exceeds the floor.

**The floor is a single constant, `GLIBC_FLOOR`, at the top of the script.** It is `2.35`: Ubuntu 22.04 (jammy), the base image every `builds/*/Dockerfile` uses. Change it there and nowhere else. When the check fires, fix the build - use a musl/static upstream asset, or pin the docker base to `ubuntu:22.04` - rather than raising the floor.

Static binaries (musl, Go, Zig) reference no GLIBC versions and pass trivially. Non-ELF payloads (jars, scripts, `.a` archives, data files) are skipped, so JVM engines like QuestDB and TypeDB pass with nothing to inspect. darwin and win32 archives are not examined.

**Used by:** all 22 release workflows, in the `release` job right after "Validate required binaries":

```yaml
- name: Check GLIBC floor (Linux artifacts)
  run: |
    chmod +x builds/common/check-glibc-floor.sh
    ./builds/common/check-glibc-floor.sh <database-id> ./release-assets
```

### `check-platform-coverage.sh <database> <version> <requested-platforms> <release-assets-dir>`

Fails a release that silently shipped fewer platforms than were asked for.

Every engine's `download.ts` loops over platforms and counts a failed download, a missing cross-compiler, or a build error as a "skip", then exits 0. As long as one platform produced a tarball the release completed green: weaviate 1.38.8 shipped 2 of 5 platforms that way and the release run said nothing.

A platform is EXPECTED only when the engine declares it for that version in **both** `databases.json` (the registry platform list, resolved the same way `getVersionPlatforms()` does) and `builds/<db>/sources.json` (the build recipe). Engines with no win32 build by design, such as libsql and postgresql, simply do not declare it, so `all` never expects one. Anything expected that produced no artifact is a hard failure. The skip is driven by the declared platform list, never by the build outcome.

`<requested-platforms>` is the workflow's `platforms` input verbatim: the literal `all`, or a comma/space separated list. Built platforms are read from artifact filenames, so compound versions like `postgresql-documentdb 17-0.107.0` work.

Covered by `tests/platform-coverage.test.ts`. `HOSTDB_ROOT` overrides the repo root the script reads its JSON from.

**Used by:** all 22 release workflows, immediately after the GLIBC floor check:

```yaml
- name: Check platform coverage
  run: |
    chmod +x builds/common/check-platform-coverage.sh
    ./builds/common/check-platform-coverage.sh <database-id> "${{ github.event.inputs.version }}" "${{ github.event.inputs.platforms }}" ./release-assets
```

### `merge-release-checksums.sh <release-tag> <checksums-file>`

Merges the `checksums.txt` already attached to a release UNDER the freshly built one, so a partial-platform dispatch does not wipe the checksums of platforms it did not rebuild. `releases.json` is derived from `checksums.txt`, so an unmerged partial upload silently drops every untouched platform from the manifest (postgresql 18.6.0 and 18.4.0, 2026-09-09). A rebuilt platform's new line wins; a brand new release has nothing to merge. Covered by `tests/release-checksums-merge.test.ts`.

**Used by:** all 22 release workflows, immediately after the platform-coverage check and before the release is published.

### `publish-release.sh --tag <tag> --title <title> --notes-file <file> --assets-dir <dir> [--target <sha>] [--prerelease true|false]`

Creates the GitHub Release and uploads its assets. Replaces `softprops/action-gh-release@v2`, which uploaded every asset CONCURRENTLY with no per-file retry and published the release before anything was verified. On the 2026-09-17 MariaDB wave that step failed or stalled on 5 of 8 attempts: "Error saving asset", "Headers Timeout Error", "Error creating asset temp dir", and one 46-minute stall on the 450 MB `linux-x64` archive that a hand-run `gh release upload` then finished in 44 seconds.

The sequence for a **new release** (or one left behind as a draft by a failed run):

1. Create the release as a **draft** if it does not exist (same tag, title, notes and target as before), or adopt the existing draft.
2. Upload each asset **sequentially** with `gh release upload --clobber`, 3 attempts per file with a 5s then 15s backoff. `checksums.txt` goes **last**, so a partial run can never leave a checksums file describing assets that are not on the release.
3. Verify: every uploaded asset is attached, in state `uploaded`, and the same size as the local file. Where the API exposes the asset `digest` field, it is compared against `checksums.txt`; where it does not, the size comparison stands in and the script says so.
4. Publish with `gh release edit --draft=false`.

**Why a draft matters:** a draft has no git tag and is invisible to the unauthenticated API, so a run that dies midway leaves nothing for a consumer, or for `build-releases-json.ts`, to snapshot. A draft counted mid-upload is exactly how `releases.json` briefly recorded mariadb 12.3.3 with 3 platforms and `releasedAt: null`. `lib/github-releases.ts` closes the same gap from the manifest side.

The sequence for an **already published release** (the partial-platform re-dispatch: rebuilding only `linux-arm64` for a version that already shipped). A published release cannot hide behind a draft, because demoting it would retract a tag consumers already resolve, so it gets the same all-or-nothing property from a **staged swap**:

1. Upload every replacement asset under a throwaway `<name>.staging-<run id>` name, sequentially, with the same retries. `--clobber` only ever targets that staging name, which this run owns, so a retry overwrites its own partial upload and never a live asset.
2. Verify the whole staged set exactly as above (attached, `uploaded`, size, and `digest` against `checksums.txt` where exposed) **before any public name changes**.
3. Swap: for each asset, rename the live one aside to `<name>.superseded-<run id>`, rename the verified staging asset onto the public name (`PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}`), then delete the superseded one. `checksums.txt` is swapped **last**, so the checksums file a consumer reads describes the previous asset set until every archive has been swapped in. The swap is several API calls per asset and can fail after earlier assets are already public, so during that window the public assets can be a mix of new and old with the old `checksums.txt` still attached; the failure report names which assets were swapped and which were not, and a re-run finishes the swap. The window is API calls rather than the length of an upload, and no unverified byte ever carries a public name.
4. Title, notes and prerelease flag are edited **after** the swap, and the release is never demoted back to a draft.

**Failure behavior on a published release.** Anything that fails before the swap (an upload, a size or digest mismatch, a missing asset) deletes the staging assets this run created and exits non-zero with the public asset set exactly as it was. The first API call of each asset's swap is a rename, so if the rename endpoint is unavailable the run refuses with `refusing to replace published assets in place` having changed nothing, rather than falling back to clobbering a live name. If the swap itself fails part-way, the script prints exactly which assets were swapped and which were not, notes that the verified replacements for the rest are still on the release under their `.staging-` names, and exits non-zero: that residual window is the remaining trade-off, and a re-run finishes the swap.

Covered by `tests/release-publish-staged-swap.test.ts` (stubbed `gh`).

Needs `GH_TOKEN` with `contents: write`, which is all the `release` job grants.

**Used by:** all 22 release workflows, as the final step of the `release` job:

```yaml
- name: Publish release
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    mkdir -p ./release-notes
    cat >./release-notes/body.md <<'RELEASE_NOTES'
    ## <Display Name> ${{ github.event.inputs.version }}
    ...
    RELEASE_NOTES

    chmod +x builds/common/publish-release.sh
    ./builds/common/publish-release.sh \
      --tag "<database-id>-${{ github.event.inputs.version }}" \
      --title "<Display Name> ${{ github.event.inputs.version }}" \
      --notes-file ./release-notes/body.md \
      --assets-dir ./release-assets
```

### `fix-macos-dylibs.sh <package-root>`

macOS source builds that link against Homebrew (OpenSSL, pcre2, etc.) produce binaries with absolute paths like `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib`. These break on any Mac without those exact Homebrew packages installed.

The script makes packages relocatable by:

1. Bundling Homebrew dylibs into the package's `lib/` directory.
2. Rewriting all absolute paths to `@loader_path` relative references.
3. Re-signing modified binaries (macOS requires this after `install_name_tool` changes).
4. Verifying no Homebrew paths remain (fails the build if any found).

**When to use:** Add to any release workflow's macOS build step if the database links against Homebrew libraries at build time. Insert between metadata creation and tarball creation:

```bash
chmod +x "$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh"
"$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh" "$GITHUB_WORKSPACE/install/<database>"
```

**Currently used by:** MariaDB, Redis, Valkey, CouchDB. PostgreSQL-DocumentDB has its own inline implementation (see `builds/postgresql-documentdb/build-macos.sh`).

### `check-macos-dylibs.sh [<path>]`

Diagnostic — scans packages for non-relocatable Homebrew paths without modifying anything. Runs locally via `pnpm check:dylibs [-- <path>]`. The `audit-dylibs` workflow (`workflow_dispatch`) audits published releases on R2.

---

## macOS native build reference

Native macOS builds (darwin-x64, darwin-arm64) require careful SDK configuration and dylib path rewriting. This section is the general reference; per-engine specifics live in each engine's build script.

### SDK conflict: Xcode vs Command Line Tools

**The problem.** CMake can find libraries from Command Line Tools (`/Library/Developer/CommandLineTools/SDKs/`) while using Xcode's SDK for compilation. This causes C++ header search-path errors like:

```
error: <cstddef> tried including <stddef.h> but didn't find libc++'s <stddef.h> header.
```

**The fix.** Force all tools to use a single SDK by:

1. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (not Command Line Tools).
2. Export `SDKROOT`, `CC`, `CXX`, `CFLAGS`, `CXXFLAGS`, `LDFLAGS` with `--sysroot`.
3. Use `CMAKE_FIND_ROOT_PATH` to restrict library search to Xcode SDK + Homebrew only.
4. Run cmake via `xcrun` to inherit the correct environment.

See `release-mariadb.yml` for a working example of this configuration.

### Why build from source instead of Homebrew?

Homebrew binaries have **hardcoded absolute paths** (e.g., `/opt/homebrew/lib/libssl.3.dylib`). For relocatable binaries that work on any machine:

1. Build the database from source with relative paths.
2. Build any extensions (PostGIS, DocumentDB) from source against that build.
3. Bundle all Homebrew dependencies and rewrite their paths.

### macOS dylib path prefixes

| Prefix | Meaning | When to use |
|---|---|---|
| `@rpath` | Search paths defined in the binary's LC_RPATH | Libraries that could be in multiple locations |
| `@loader_path` | Directory containing the loading binary | Bundled libraries next to executables |
| `@executable_path` | Directory containing the main executable | App bundles |

**`fix-macos-dylibs.sh` uses `@loader_path`** because hostdb tarballs ship the binary and its dylibs side-by-side in `bin/` and `lib/`.

### Workflow for making binaries relocatable

1. **Copy dependencies recursively** — use `otool -L` to find dependencies; copy non-system libs into the bundle.
2. **Handle `@rpath` references** — resolve by searching Homebrew locations (`/opt/homebrew/lib`, `/usr/local/lib`).
3. **Rewrite paths with `install_name_tool`:**

   ```bash
   # Change library's own ID
   install_name_tool -id "@loader_path/libfoo.dylib" libfoo.dylib

   # Change a reference to another library
   install_name_tool -change "/opt/homebrew/lib/libbar.dylib" "@loader_path/libbar.dylib" libfoo.dylib

   # Add rpath
   install_name_tool -add_rpath "@loader_path" binary

   # Remove Homebrew rpaths
   install_name_tool -delete_rpath "/opt/homebrew/lib" binary
   ```

4. **Re-sign after modification** — macOS requires code signing after any binary modification:

   ```bash
   codesign -s - --force --preserve-metadata=entitlements,requirements,flags,runtime binary
   ```

### Recursive dependency bundling

Libraries have transitive dependencies. A recursive routine is needed:

```bash
copy_lib_recursive() {
  local lib_path="$1"
  # Skip system libraries (/usr/lib/*, /System/*)
  # Skip already-processed libraries (track in a file)
  # Copy to bundle if from Homebrew
  # Recursively process dependencies from otool -L
  # Handle @rpath references by searching known locations
  # Handle @loader_path references relative to library directory
}
```

**Don't miss extension dylibs.** If an engine has a `lib/postgresql/` (or similar) subdirectory of extension dylibs, scan it too — extension dylibs can reference Homebrew libraries that aren't dependencies of anything in `bin/`. The bundler must follow them or `dlopen` fails at runtime. See `builds/postgresql-documentdb/build-macos.sh` step 10 for the reference implementation.

---

## Linux ARM64 builds (QEMU)

ARM64 Linux builds use QEMU emulation on x64 runners:

- Build times: 45–90+ minutes (vs 3–5 minutes for native).
- Builds can appear "frozen" during long compilation steps — that's normal.
- Use `docker buildx` with `--platform linux/arm64`.

---

## Workflow concurrency

Release workflows use concurrency groups to prevent conflicts:

```yaml
concurrency:
  group: release-<engine>
  cancel-in-progress: false
```

Only one build runs at a time per engine — subsequent triggers are queued, not cancelled.
