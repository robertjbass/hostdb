# Minimal Binaries

## Status

MySQL **8.4.9** and **9.6.0** `linux-x64` are re-hosted as MySQL's official `-minimal` tarball:

| Binary | Full | Minimal |
|---|---|---|
| `mysql-8.4.9` linux-x64 | 872 MB | **135 MB** |
| `mysql-9.6.0` linux-x64 | 1042 MB | **138 MB** |

The `-minimal` build keeps the entire `bin/` (every CLI tool), all runtime plugins, the bundled OpenSSL/SASL libraries, and the charset/error-message data. It drops only never-executed artifacts: the `mysql-test/` suite, debug binaries/plugins, and static `.a` libs. `resolveVersion` output is unchanged. Validated end-to-end (`spindb create -> seed -> backup -> restore`) on both versions - see `builds/mysql/test-roundtrip.sh` and `builds/mysql/test-spindb-e2e.sh`.

Shipped in hostdb 0.33.1 -> spindb 0.54.1.

## Vendor `-minimal` availability: linux-x64 ONLY

MySQL publishes a `-minimal` build only for `x86_64` Linux. Every other platform 404s (verified):

| Platform | full size (9.6.0) | vendor minimal? | worth trimming? |
|---|---|---|---|
| linux-x64 | now 138 MB | yes (in use) | done |
| linux-arm64 | ~1033 MB | no | yes (high - the other ~1 GB) |
| win32-x64 | ~290 MB | no | optional (moderate) |
| darwin-x64 | ~168 MB | no | no (already small) |
| darwin-arm64 | ~163 MB | no | no (already small) |

macOS is already small because Apple's MySQL builds do not bundle the test suite. **linux-arm64 is the only other big one (~1 GB)**, for the same reason linux-x64 was (test suite + debug + unstripped symbols) - but it has no vendor minimal.

## Adding a vendor-minimal for a NEW x64 version

If a future MySQL x64 version ships a `-minimal` tarball: point its `linux-x64` entry in `builds/mysql/sources.json` at the `-minimal` URL + sha256 (confirm the URL exists first - naming varies: `glibc2.28` for recent versions, `glibc2.17` for some). Then follow `REPLACE_BINARY_PLAYBOOK.md`. Note: 8.4.3 and the deprecated versions (8.0.40 / 9.1.0 / 9.5.0) have no vendor minimal and stay full.

## Extending to non-x64 platforms (custom trim, NOT a URL swap)

No vendor minimal exists for these, so you trim the full tarball yourself. Only do it where it pays off: **linux-arm64 (high value, ~1 GB)**; macOS (skip, already ~160 MB); Windows (optional, ~270 MB).

1. Add a trim step to `builds/mysql/download.ts` -> `repackage()`, after extract / before re-tar:
   - delete: `mysql-test/`, `lib/plugin/debug/`, `lib/*.a`, `man/`, `include/`, `docs/`
   - `strip` the ELF binaries (**Linux only** - this recovers most of the size; the full Linux binaries are unstripped). Do NOT `strip` on macOS (Mach-O `@rpath`/dylib relocatability is fragile - dir-deletion only there).
   - DENYLIST, never allowlist: keep all of `bin/` so you cannot recreate the pg_dump/pg_restore loss.
2. Build: `pnpm download:mysql -- --version <X> --platform linux-arm64 --output ./dist`.
3. Validate: `builds/mysql/test-roundtrip.sh <tarball> linux-arm64` and `builds/mysql/test-spindb-e2e.sh <tarball> <X>`. (linux-arm64 runs natively on Apple Silicon, so it tests faster than x64 did under emulation.)
4. Re-host + cascade: see `REPLACE_BINARY_PLAYBOOK.md`.

A custom-trim step is more general than the vendor swap: it also covers versions that lack a vendor minimal (e.g. 8.4.3) uniformly across all platforms.

## Known non-uniformities (the direct-overwrite residue)

The 8.4.9 / 9.6.0 linux-x64 minimal binaries were shipped via a direct R2 overwrite (fast, no full rebuild), which left these cosmetic inconsistencies. All are harmless - nothing reads size/sha for the actual download (spindb constructs the URL and verifies neither size nor sha) - but they are real:

1. **`releases.json` size/sha for those 2 entries are stale** (label 872 / 1042 MB; R2 serves 135 / 138 MB).
2. **The GitHub release assets for those 2 are still the full binaries** (diverge from R2; harmless because spindb's GitHub fallback is disabled).
3. **`_backup/mysql-8.4.9/...` and `_backup/mysql-9.6.0/...`** hold the full originals on R2 for rollback. They are not referenced by `releases.json`, so `pnpm audit:r2-orphans --delete` WOULD remove them - do not run that while you rely on them.
4. **`sources.json` mixes** minimal URLs (8.4.9 / 9.6.0 linux-x64) with full URLs (everything else).

**To fully heal #1 and #2** (make `releases.json` + the GitHub releases match R2): run `release-mysql.yml` for 8.4.9 + 9.6.0. It rebuilds, updates the GitHub releases + R2, and regenerates a correct `releases.json`. (The already-published npm 0.33.1 keeps the stale labels in its bundled snapshot until the next version bump - inert, since R2 is authoritative for the bytes.)
