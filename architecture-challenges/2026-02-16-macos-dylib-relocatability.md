# macOS Dynamic Library Relocatability

**Date:** 2026-02-16
**Affected engines:** MariaDB, Redis, Valkey, CouchDB
**Root cause:** Absolute Homebrew dylib paths baked into macOS binaries
**Resolution:** Generic dylib patching script + CDN cache purge infrastructure

---

## The Problem

A contributor reported that SpinDB was failing when installing MariaDB on their Mac. The error was a dylib-not-found crash — the binary was looking for `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib` and couldn't find it.

I couldn't replicate the issue. On my machine, MariaDB installed and ran fine. So did Redis. So did Valkey. Everything worked.

Then I realized why: I had `openssl@3` installed via Homebrew. The contributor didn't.

## Why It Went Undetected

The issue was invisible across every layer of our testing:

1. **GitHub Actions macOS runners** come with Homebrew pre-installed and a large set of common packages. On top of that, our build workflows explicitly run `brew install openssl@3` as a build dependency. The built binaries link against OpenSSL at its absolute Homebrew path — and that path resolves just fine on the CI runner.

2. **My development machine** has Homebrew with OpenSSL installed. Every Mac I've ever tested on has had Homebrew installed. The binaries worked perfectly every time.

3. **Docker images** (used for Linux builds) install OpenSSL as a build dependency too, so Linux builds were never affected — Docker builds produce self-contained binaries.

The result: binaries that referenced `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib` (ARM64) or `/usr/local/opt/openssl@3/lib/libssl.3.dylib` (Intel) via absolute paths shipped to production. They worked on any Mac with Homebrew OpenSSL. They crashed immediately on any Mac without it.

This directly violated SpinDB's core promise: zero system dependencies.

## How macOS Dynamic Libraries Work

On macOS, when a binary links against a shared library (`.dylib`), the full path to that library gets baked into the binary at compile time. You can see this with `otool -L`:

```
$ otool -L redis-server
redis-server:
    /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib
    /opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib
    /usr/lib/libz.1.dylib
    /usr/lib/libSystem.B.dylib
```

The `/usr/lib/*` paths are fine — those are system libraries present on every Mac. The `/opt/homebrew/*` paths are the problem.

macOS provides a mechanism for relocatable binaries using special path prefixes:

| Prefix | Meaning |
|--------|---------|
| `@loader_path` | Directory containing the binary that's loading the library |
| `@rpath` | Search paths defined in the binary's LC_RPATH load command |
| `@executable_path` | Directory containing the main executable |

The standard technique (used by Homebrew bottles, `.app` bundles, and frameworks) is to:
1. Copy the needed dylibs into the package
2. Rewrite the absolute paths to `@loader_path/../lib/libssl.3.dylib`
3. Re-sign the modified binaries (required on Apple Silicon)

## The Fix

### Phase 1: Generic Patching Script

Created `builds/common/fix-macos-dylibs.sh` — a standalone bash script that makes any macOS package directory relocatable. It takes a single argument (the package root) and:

1. **Scans** all Mach-O binaries in `bin/` with `otool -L` to find Homebrew dependencies
2. **Recursively bundles** those dylibs (and their transitive dependencies) into the package's `lib/` directory
3. **Rewrites** all absolute Homebrew paths to `@loader_path` relative references using `install_name_tool`
4. **Re-signs** everything with `codesign` (required by macOS after binary modification)
5. **Verifies** no Homebrew paths remain — exits non-zero if any are found, failing the CI build

The script handles both ARM64 (`/opt/homebrew/`) and Intel (`/usr/local/`) Homebrew prefixes, resolves `@rpath` and `@loader_path` references during recursive dependency discovery, and creates the `lib/` directory if it doesn't exist (Redis and Valkey didn't have one).

This was adapted from the proven inline implementation in `builds/postgresql-documentdb/build-macos.sh` (~230 lines of dylib rewriting that had been battle-tested through many PostgreSQL+DocumentDB releases), simplified and generalized for any engine.

### Phase 2: Audit Tooling

Also created:
- `builds/common/check-macos-dylibs.sh` — read-only diagnostic script. Run locally with `pnpm check:dylibs` to scan any built package for non-relocatable paths without modifying anything.
- `.github/workflows/audit-dylibs.yml` — manually triggered workflow that downloads macOS tarballs from R2, runs the check script, and produces a summary table with prescriptive rebuild actions.

### Phase 3: Integration

Added the patching step to all affected release workflows (MariaDB, Redis, Valkey, CouchDB) — three lines inserted between metadata creation and tarball creation in each macOS build step:

```bash
chmod +x "$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh"
"$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh" "$GITHUB_WORKSPACE/install/<database>"
```

## The Rebuild Cascade

After merging the fix, all existing macOS releases needed rebuilding. This triggered a second problem.

### R2 Upload Skipping

The release workflows upload tarballs to Cloudflare R2 (our binary registry at `registry.layerbase.host`). The `upload-to-r2.ts` script was designed to skip uploads when an object already exists in R2 — an optimization for normal releases where each version gets a unique filename.

But rebuilt binaries have the **same filename** as the originals. The script saw the existing object and skipped the upload. The old, broken binaries remained on R2.

**Fix:** Added `--force` flag to `upload-to-r2.ts` and updated all release workflows to use it. With `--force`, existing R2 objects are deleted and re-uploaded.

### CDN Cache Staleness

With `--force` solving the R2 storage layer, there was still another problem: Cloudflare's CDN edge cache.

R2 tarballs are served through Cloudflare's CDN with `Cache-Control: public, max-age=31536000, immutable` (1-year cache). This is ideal for normal releases — each version gets a unique URL that's cached forever at the edge. But when re-uploading a rebuilt binary to the same URL, the CDN edge nodes continue serving the cached old version. Updating R2 does not invalidate the CDN cache.

**Fix:** Added `purgeCloudflareCache()` to `lib/r2.ts`. When `--force` is used, after uploading to R2, the script automatically purges the affected URLs from Cloudflare's CDN edge cache. This required two new GitHub Actions secrets:
- `CLOUDFLARE_API_TOKEN` — with `Zone.Cache Purge` permission for the `layerbase.host` zone
- `CLOUDFLARE_ZONE_ID` — the zone ID for `registry.layerbase.host`

Then updated all 21 release workflows to pass these secrets through to the upload step.

## The Full Rebuild

With all three layers fixed (dylib patching + R2 force upload + CDN cache purge), re-triggered builds for all affected macOS releases:

- **MariaDB**: 11.8.5, 11.4.5, 10.11.15 (x darwin-arm64, darwin-x64)
- **Redis**: 8.4.0, 7.4.7 (x darwin-arm64, darwin-x64)
- **Valkey**: 9.0.1, 8.0.6 (x darwin-arm64, darwin-x64)
- **CouchDB**: 3.5.1 (x darwin-arm64, darwin-x64)

Each rebuild now bundles the Homebrew dylibs into the package, rewrites all paths, and force-uploads to R2 with CDN cache purging.

## Timeline

| Commit | Description |
|--------|-------------|
| `6acef1d` | Initial fix: `fix-macos-dylibs.sh`, `check-macos-dylibs.sh`, `audit-dylibs.yml`, integrated into MariaDB/Redis/Valkey workflows |
| `e16718c` | Discovered R2 skipping problem during rebuilds, added `--force` flag, created `reupload-r2.yml` |
| `ed9c7c1` | Discovered CDN cache staleness, added `purgeCloudflareCache()` to `lib/r2.ts`, added Cloudflare secrets to all 21 workflows |
| `4c42851` | Added `--force` to all release workflows (not just the 3 affected ones) as a safety net |
| `c5126cc` | Extended dylib patching to CouchDB (also linked against Homebrew on macOS) |
| `683323e` | Updated changelog documenting the full chain of fixes |

## Lessons Learned

1. **"Works on my machine" is the most dangerous test.** OpenSSL was installed on every machine in the entire build and test pipeline — CI runners, development machines, Docker images. The only place it wasn't installed was on the end user's Mac.

2. **Absolute paths in binaries are a time bomb.** macOS compilers bake the full path to every linked library into the binary. If that path points to a package manager location (`/opt/homebrew/`, `/usr/local/`), the binary is only portable to machines with the same packages installed.

3. **CDN caching creates a three-layer problem for binary updates.** Rebuilding a binary requires updating storage (R2), invalidating CDN cache (Cloudflare edge), and re-uploading with force flags. Missing any layer means stale binaries continue to be served.

4. **Audit tools should exist before you need them.** The `check-macos-dylibs.sh` script and `audit-dylibs.yml` workflow now make it trivial to verify relocatability. If these had existed from the start, the problem would have been caught in the first build.

## Files Changed

```
builds/common/fix-macos-dylibs.sh       # Generic dylib patching script (317 lines)
builds/common/check-macos-dylibs.sh     # Read-only diagnostic (118 lines)
.github/workflows/audit-dylibs.yml      # CI audit workflow
.github/workflows/release-mariadb.yml   # Added patching step
.github/workflows/release-redis.yml     # Added patching step
.github/workflows/release-valkey.yml    # Added patching step
.github/workflows/release-couchdb.yml   # Added patching step
.github/workflows/reupload-r2.yml       # New: manual re-upload workflow
lib/r2.ts                               # Added purgeCloudflareCache()
scripts/upload-to-r2.ts                 # Added --force flag + CDN purge
All 21 release workflows                # Added --force + Cloudflare secrets
```
