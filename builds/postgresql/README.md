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
- Candidate immutable artifacts `18.6.0+cron.1` and `19.0.0-beta.3+cron.1` for Linux x64 additionally include checksum-pinned pg_cron 1.6.8. These cover the current Cloud new-database choices (18 and opt-in 19 beta 3). Other versions and platforms require separate qualification. The packager verifies the library, control file and install/upgrade SQL. The release workflow runs `smoke-pg-cron.sh` against each candidate archive in an unprivileged, network-isolated container before upload; SpinDB and Cloud own scheduler configuration and lifecycle safety.

The pg_cron candidate never replaces a published archive. The `+cron.1` build
metadata is part of the release tag, URL, manifest version and installed cache
directory; the upstream sources remain 18.6 and 19beta3. These are explicitly
selected artifact previews, excluded from shorthand defaults. Old versions keep
their old artifacts on every platform. Publish only the Linux x64 revisions,
record their checksums, then publish the hostdb snapshot before updating SpinDB.
Do not refresh existing same-version directories or overwrite running libraries.
A changed artifact needs a new revision. The release workflow refuses an existing
revision URL and uploads revisions without `--force`. Preserve extension-capable
revisions for rollback; a fallback to an extension-free artifact pauses jobs and
removes only the pg_cron preload, retaining its catalog for later recovery.
Never replace a shared library under a running PostgreSQL process. pg_net is a
separate feasibility effort and is not included in this build.


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
