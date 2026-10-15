# PostgreSQL Builds

Build PostgreSQL from source for distribution via GitHub Releases.

## Platform Coverage

**All 5 platforms are fully supported for stable (GA) versions.** Prereleases
(alpha/beta/rc) build 4 platforms only - EDB does not publish Windows binaries
until the RC stage, so `win32-x64` is intentionally omitted for betas.

| Platform | Method | Runner | Build Time |
|----------|--------|--------|------------|
| linux-x64 | Docker source build | ubuntu-latest | ~15-25 min |
| linux-arm64 | Docker source build (QEMU) | ubuntu-latest | ~45-90 min |
| darwin-x64 | Native source build | macos-15-intel | ~20-40 min |
| darwin-arm64 | Native source build | macos-14 | ~15-30 min |
| win32-x64 | Official EDB binary | ubuntu-latest | ~2-5 min |

## Binary Sources

| Source | Platforms | Notes |
|--------|-----------|-------|
| Source Build (Docker) | linux-x64, linux-arm64 | Built from official source tarball |
| Source Build (Native macOS) | darwin-x64, darwin-arm64 | Built with Homebrew dependencies |
| EnterpriseDB (EDB) | win32-x64 | Official Windows binary ZIP |

### Source Builds (ftp.postgresql.org)

For Linux and macOS, we build PostgreSQL from source using the official tarballs:

**URL pattern:**
```
https://ftp.postgresql.org/pub/source/v{VERSION}/postgresql-{VERSION}.tar.gz
```

**Source-version mapping:** hostdb version strings are normalized to the
upstream tarball name before download:

- Stable: strip the trailing `.0` - `18.4.0` → `18.4` (tarball `postgresql-18.4.tar.gz`).
- Prerelease: `^{major}.0.0-(alpha|beta|rc).{n}$` → `{major}{type}{n}` - e.g.
  `19.0.0-beta.1` → `19beta1` (tarball `postgresql-19beta1.tar.gz`).

This mapping lives in both `build-local.sh` and the `Parse version for source
download` step of `.github/workflows/release-postgresql.yml`; keep them in sync.

**Features included:**
- SSL support (`--with-openssl`)
- Readline support (`--with-readline`)
- XML support (`--with-libxml`, `--with-libxslt`)
- ICU support (`--with-icu`)
- UUID support (`--with-uuid=e2fs`) - required for the `uuid-ossp` extension
- All contrib modules (pg_stat_statements, uuid-ossp, etc.)
- pg_cron 1.6.8 (checksum-pinned) in linux-x64 builds of PostgreSQL 18 and newer

**pg_cron is part of the standard build, not a separate artifact.**
`pg-cron.sh` is the one copy of the recipe: `applies <version> <platform>`
decides the scope, `install` builds the pinned source against the fresh
`pg_config`, and `verify` asserts the library, control file and install/upgrade
SQL. The Dockerfile (builder and packager stages), `build-local.sh` and the
release workflow all call it, so changing the scope or the pin is a one-file
edit. For every build it scopes in, the release workflow also runs
`smoke-pg-cron.sh` against the finished archive in an unprivileged,
network-isolated container before upload (real scheduled SQL, coexistence with
pg_stat_statements and uuid-ossp, restart persistence, no catch-up burst after a
stopped interval). The extension is inert until a server lists it in
`shared_preload_libraries`; spindb and Cloud own that configuration and the
scheduler lifecycle. pg_net is a separate feasibility effort and is not included.

Scope is linux-x64 only:

- **linux-arm64** builds 18.6.0 and 19.0.0-beta.3 from the same Dockerfile, so
  turning it on is a one-line scope change, but the smoke gate is timing-based
  (scheduled ticks, a 125 second stopped interval) and would run under QEMU
  emulation on the amd64 runner, and the 15/16/17 arm64 archives are Percona
  repacks that cannot carry it. Nothing that runs on arm64 needs it yet.
- **darwin** is built inline in the workflow and needs its own recipe:
  `PG_LDFLAGS="-undefined dynamic_lookup"` (see the documentdb build) plus the
  ad hoc re-signing loop extended to `lib/*.so`, since `install_name_tool`
  invalidates the signature and arm64 refuses to load unsigned modified code.
- **win32-x64** is the EDB binary and is never built here.

PostgreSQL 15, 16 and 17 are out of scope because Cloud does not offer them for
new databases; adding them is a change to `PG_CRON_MIN_MAJOR` plus a rebuild of
each archive.

Including pg_cron changes an existing version's archive, so an affected version
is rebuilt in place like the 2026-09-09 `uuid-ossp` rebuild: dispatch the
release workflow from an up-to-date `main` for that version and platform (the
upload step runs `upload-to-r2.ts --force`, which overwrites and purges the CDN),
then ship the new checksums in a hostdb patch release. Existing extracted copies
are never refreshed by spindb (it caches by directory), so shared binary stores
must be re-warmed. Never replace a shared library under a running PostgreSQL
process: move the old directory aside instead of overwriting it.

### Rebuilding an archive in place for pg_cron (operator steps)

Order matters. `upload-to-r2` and `update-releases` always check out `main`, and
`update-releases` regenerates `databases.json` and `releases.json` from it and
publishes both to R2, so a dispatch must never run while `main` lags `dev`. A
package version bump on `main` publishes to npm immediately, so the bump must
come after the rebuild or npm ships the old checksums (0.42.1, then 0.42.2).

1. Merge the code change to `main` WITHOUT a `package.json` bump. `publish.yml`
   skips (version not newer than npm); `version-check.yml` reports a failure on
   that release PR, which is expected. Confirm `main` has
   `builds/postgresql/pg-cron.sh` and the deprecated `-cron.1` entries.
2. Keep the current archive for comparison and rollback:
   `curl -fsSL -o old.tgz https://registry.layerbase.host/postgresql-18.6.0/postgresql-18.6.0-linux-x64.tar.gz`
3. Dispatch from `main`, one version at a time:
   `gh workflow run release-postgresql.yml --repo robertjbass/hostdb --ref main -f version=18.6.0 -f platforms=linux-x64`
   and watch it (`gh run watch`). It builds, runs the pg_cron smoke gate,
   merges the release's existing checksums, swaps only the linux-x64 asset,
   overwrites R2 with `--force` (CDN purge) and commits `releases.json` to
   `main`. Then repeat with `-f version=19.0.0-beta.3`.
4. Verify each version:
   - `git diff <pre-dispatch main>..origin/main -- releases.json` changes only
     that version's linux-x64 `sha256` and `size`.
   - The live URL serves the new bytes and the sha256 matches `releases.json`
     and the release's `checksums.txt`.
   - `diff <(tar -tzf old.tgz | sort) <(tar -tzf new.tgz | sort)` adds exactly
     `lib/pg_cron.so`, `share/extension/pg_cron.control` and the eight
     `share/extension/pg_cron--*.sql` files, and removes nothing.
   - Extract both; `diff -rq` reports only `.hostdb-metadata.json`
     (`rehosted_at`) besides the added pg_cron files. The build has been
     byte-reproducible, so any other changed file is unexpected rebuild noise
     to explain before step 5.
5. Merge `main` into `dev`, bump `package.json` to the next patch in a PR to
   `dev`, then release `dev` to `main`. `publish.yml` regenerates `releases.json`
   from the live releases, refuses on drift and publishes.
6. Downstream: bump the hostdb pin in spindb, then spindb in Cloud and Desktop,
   and re-warm every shared binary store: move the existing
   `postgresql-<version>-linux-x64` directory aside (never overwrite it under a
   running server), download the version again, confirm `lib/pg_cron.so`, and
   delete the moved copy once databases are proven up.

Rollback: put the kept `old.tgz` back on the same R2 key with
`pnpm tsx scripts/rehost-minimal-r2.ts --tag postgresql-<version> --file old.tgz`
(it backs up the current object and purges the CDN; see
`REPLACE_BINARY_PLAYBOOK.md`). The GitHub release asset, its `checksums.txt`
and `releases.json` keep describing the rebuilt archive until they are restored
the same way the playbook describes.

The `18.6.0-cron.1` and `19.0.0-beta.3-cron.1` linux-x64 archives published in
hostdb 0.44.0 were the preview of this change. They are `deprecated: true`:
still resolvable and downloadable at their URLs so existing installs keep
working, but hidden from new-install pickers and from the release workflow's
version list. Each one is byte-identical to the pre-rebuild standard archive plus
the ten pg_cron files, apart from `.hostdb-metadata.json`, which is what the
in-place rebuild should produce too.

**`uuid-ossp` is load-bearing, not optional.** `contrib/uuid-ossp` only compiles
when `configure` ran with `--with-uuid=<lib>`; without it `make install` skips
the module silently and `CREATE EXTENSION "uuid-ossp"` fails at runtime with
`extension "uuid-ossp" is not available`. Supabase schema dumps and most app
migrations open with that statement, so a binary missing it breaks restores
partway through. Both the Dockerfile and the macOS workflow job now assert
`lib/uuid-ossp.so` (plus `share/extension/uuid-ossp.control` on Linux) exists
before publishing, and `build-local.sh` fails on the same check.

**Linux uses `e2fs` (libuuid, `uuid-dev` at build time, `libuuid1` at runtime);
macOS uses the same `e2fs` option** - the Apple SDK ships `uuid/uuid.h` and
`uuid_generate` lives in libSystem, so no extra Homebrew package is needed.

> **Note on `linux-arm64`:** the versions sourced from Percona tarballs rather
> than built here (`sources.json`: 17.11.0, 16.15.0, 15.19.0) already shipped
> `uuid-ossp`, because Percona configures it in. Only our own source builds were
> missing it, which is why the gap showed up on some platform/version pairs and
> not others.

### EnterpriseDB Windows Binaries

Windows binaries are downloaded from EnterpriseDB's download portal. EDB uses non-predictable file IDs for downloads.

**To fetch current file IDs:**
```bash
pnpm edb:fileids              # Show available file IDs
pnpm edb:fileids -- --update  # Update sources.json with latest IDs
```

## Usage

```bash
# Local Docker build for Linux
./builds/postgresql/build-local.sh --version 17.7 --platform linux-x64

# Build linux-arm64 (requires QEMU or ARM host)
./builds/postgresql/build-local.sh --version 17.7 --platform linux-arm64

# Build without Docker cache
./builds/postgresql/build-local.sh --version 17.7 --no-cache

# Auto-cleanup extracted files after tarball creation
./builds/postgresql/build-local.sh --version 17.7 --cleanup
```

Note: macOS builds run natively on GitHub Actions runners (macos-14 for ARM64, macos-15-intel for x64).

## Output

Builds are saved to `./dist/`:

```
dist/
├── postgresql-17.7-linux-x64/
│   └── postgresql/           (extracted build)
└── postgresql-17.7-linux-x64.tar.gz  (final tarball)
```

Archives contain:
- PostgreSQL binaries in a `postgresql/` directory
- All contrib modules in `postgresql/lib/` and `postgresql/share/extension/`
- `.hostdb-metadata.json` with provenance information

## Supported Versions

| Version | Type | Notes |
|---------|------|-------|
| 19.0.0-beta.1 | Prerelease | PostgreSQL 19 Beta 1 (source `19beta1`); 4 platforms, no `win32-x64` (EDB betas start at RC). Not resolvable via bare major `19`. |
| 18.4 | Latest | PostgreSQL 18 |
| 17.10 | Current | PostgreSQL 17 |
| 16.14 | Supported | PostgreSQL 16 |
| 15.18 | Supported | PostgreSQL 15 |

## Platform Coverage Matrix

Stable versions ship all 5 platforms; the PG19 beta ships 4 (no `win32-x64`).

| Platform | 19.0.0-beta.1 | 18.4 | 17.10 | 16.14 | 15.18 | Method |
|----------|---------------|------|-------|-------|-------|--------|
| linux-x64 | ✅ | ✅ | ✅ | ✅ | ✅ | Docker source build |
| linux-arm64 | ✅ | ✅ | ✅ | ✅ | ✅ | Docker source build (QEMU) |
| darwin-x64 | ✅ | ✅ | ✅ | ✅ | ✅ | Native macOS build |
| darwin-arm64 | ✅ | ✅ | ✅ | ✅ | ✅ | Native macOS build |
| win32-x64 | ❌ | ✅ | ✅ | ✅ | ✅ | Official EDB binary (betas start at RC) |

## GitHub Actions

The release workflow builds all platforms in parallel:

1. Go to Actions → "Release PostgreSQL" → Run workflow
2. Select version and platforms (default: all)
3. Click "Run workflow"

### Partial-platform re-releases

Picking a single platform (e.g. `linux-x64`) rebuilds and re-uploads only that
tarball. The release job merges the release's existing `checksums.txt` under the
freshly built one (`builds/common/merge-release-checksums.sh`), so the platforms
you did not rebuild keep their checksums and stay in `releases.json`.

Concurrency is per version (`release-postgresql-<version>`), so back-to-back
dispatches for different versions queue independently rather than evicting each
other - GitHub keeps only ONE pending run per concurrency group, so a shared
group silently cancelled every queued duplicate but the last. The
`update-releases` job carries its own repo-wide `hostdb-releases-manifest` group
because `releases.json` is a single shared file committed to `main` and pushed
to R2 and each run rebuilds the whole manifest. Dispatching the SAME version
twice still queues behind itself.

A group holds only one PENDING entry, so a third simultaneous manifest job would
be evicted - deliberately, because an evicted job leaves a version missing from
`releases.json`, which `publish.yml`'s drift gate catches before anything ships
and one `rebuild-releases.yml` dispatch repairs. The race it prevents silently
reverts an already-published version with nothing to catch it.

| Platform | Runner | Build Type |
|----------|--------|------------|
| linux-x64 | ubuntu-latest | Docker source build |
| linux-arm64 | ubuntu-latest | Docker source build (QEMU) |
| darwin-x64 | macos-15-intel | Native source build |
| darwin-arm64 | macos-14 | Native source build |
| win32-x64 | ubuntu-latest | Download EDB binary |

## Adding New Versions

1. Add version to `databases.json`:
   ```json
   "versions": { "19.0.0": true, "18.1.0": true, ... }
   ```

2. Fetch EDB file ID for Windows:
   ```bash
   pnpm edb:fileids -- --update
   ```

3. Sync workflow and populate checksums:
   ```bash
   pnpm prep
   ```

4. Commit changes and run the workflow

## Why Source Builds?

Previously, PostgreSQL binaries were sourced from [zonky.io embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries). We switched to source builds to address:

1. **Missing contrib modules**: zonky.io binaries didn't include pg_stat_statements and other contrib modules
2. **Dependency issues**: Runtime library incompatibilities on some platforms
3. **Reliability**: No dependency on third-party binary availability

## Build Dependencies

### Docker (Linux)

The Dockerfile installs these dependencies on Ubuntu 22.04:
- build-essential, flex, bison
- libreadline-dev, libssl-dev, zlib1g-dev
- libxml2-dev, libxslt1-dev, libicu-dev
- uuid-dev (required for `--with-uuid=e2fs` / the `uuid-ossp` extension)
- pkg-config

The packaging stage additionally installs `libuuid1`, the runtime library
`uuid-ossp.so` links against. It is present in the `ubuntu:24.04` runtime image
too, so no consumer change is needed.

### macOS (Native)

GitHub Actions installs via Homebrew:
- openssl@3, readline
- libxml2, libxslt
- icu4c, pkg-config

No Homebrew package is needed for `--with-uuid=e2fs` on macOS: the Xcode SDK
provides `uuid/uuid.h` and `uuid_generate` is in libSystem.

The macOS builds include the Xcode SDK fix for Xcode 16+ to prevent header conflicts.

## Related Links

- [PostgreSQL Downloads](https://www.postgresql.org/download/)
- [PostgreSQL FTP](https://ftp.postgresql.org/pub/source/)
- [EnterpriseDB Downloads](https://www.enterprisedb.com/downloads)
- [EDB Binary Archives](https://www.enterprisedb.com/download-postgresql-binaries)
