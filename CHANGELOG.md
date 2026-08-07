# Changelog

All notable changes to this project will be documented in this file.

## [0.38.4] - 2026-08-07

Release-pipeline hardening from the 0.38.x engine wave. Every problem the wave hit (qdrant's glibc, couchdb's drifting base image, weaviate shipping 2 of 5 platforms, a swallowed publish push) got through because nothing in the pipeline was looking for it. No engine version, default, or resolver behaviour changes, and no artifact was rebuilt.

### Added

- **GLIBC floor check on every release.** `builds/common/check-glibc-floor.sh` extracts each `linux-x64` / `linux-arm64` artifact, finds every ELF file by magic bytes, reads the highest `GLIBC_x.y.z` symbol version it references (`readelf -V`, falling back to `objdump -T`), and fails the release if anything exceeds the floor. The floor is one constant at the top of the script, `GLIBC_FLOOR="2.35"`, matching Ubuntu 22.04 (jammy), the oldest supported Linux target and the base image every `builds/*/Dockerfile` uses. This is what qdrant 1.18.3 (`GLIBC_2.38`, from the upstream gnu build) and couchdb 3.5.2 (glibc 2.41, inherited by a docker-extract that followed the upstream image to trixie) both needed: they shipped green in 0.38.0 and only failed two repos downstream, in spindb's Ubuntu 22.04 CI. Static binaries (musl, Go, Zig) reference no GLIBC versions and pass trivially; non-ELF payloads such as the QuestDB and TypeDB jars are skipped. Wired into all 22 release workflows next to the existing binary validation. Validated against real artifacts: upstream `qdrant-x86_64-unknown-linux-gnu.tar.gz` for 1.18.3 fails at `GLIBC_2.38`, the musl tarball we actually ship passes with no GLIBC references, and couchdb 3.5.2 passes at exactly `2.35`.
- **Platform coverage check on every release.** `builds/common/check-platform-coverage.sh` compares the platforms a run requested against the artifacts it produced, and fails when one is missing. Closes the known issue filed in 0.38.1. Covered by `tests/platform-coverage.test.ts`.

### Changed

- **A requested platform that does not build now fails the release.** Every engine's `download.ts` counts a failed download, a missing cross-compiler, or a build error as a "skipped" platform and still exits 0, so a run stayed green as long as one platform produced a tarball. Weaviate 1.38.8 shipped 2 of 5 platforms that way and nothing in the run said so. A platform is expected only when the engine declares it for that version in both `databases.json` and `builds/<db>/sources.json`, so engines with no win32 build by design (libsql, postgresql) still pass; the skip is driven by the declared platform list, never by the build outcome.
- **`postgresql-documentdb` Linux builds moved from `debian:bookworm` to `ubuntu:22.04`.** Same base-image-drift class that broke couchdb: a tag that tracks "stable" is a moving target, and bookworm's glibc 2.36 is already above the floor. The dependency bundler copies host libraries into the package, and the published 17-0.107.0 `linux-x64` tarball carries a `lib/libexpat.so.1` requiring `GLIBC_2.36`, so it cannot load on Ubuntu 22.04. Every apt dependency resolves on jammy (verified on both `linux/amd64` and `linux/arm64`: GEOS 3.10.2, PROJ 8.2.1, cmake 3.22, gcc 11), libbson and the Intel decimal math library were already built from source, and the latter already tracks the `ubuntu/jammy` branch. `DEBIAN_FRONTEND=noninteractive` was added so tzdata cannot stall the build. **No documentdb artifact was rebuilt here**; the next documentdb release is the first jammy build.
- **`publish.yml` accepts `workflow_dispatch`.** A push event that GitHub swallows used to leave an empty commit to `main` as the only way to re-fire the publish. The job's existing version guard publishes only when `package.json` is newer than npm, so a manual dispatch is a no-op when there is nothing to publish.

### Deprecated

- **Redis 7.4.10.** Now carries `deprecated: true`, the follow-up its 0.38.0 note promised once the binaries were on R2, exactly as 7.4.9 was handled in 0.32.0. The whole 7.4+ line is RSALv2/SSPLv1, which forbids offering Redis as a competing managed service, so it is desktop/local use only. Deprecation does not remove anything: 7.4.10 still resolves and its binaries stay on R2. `sync:versions` drops deprecated versions from the release-workflow dropdown, so 7.4.10 leaves the `release-redis` picker. Use 7.2.15 (BSD-3-Clause, and it carries the same CVE-2026-66373 fix) for managed-service use cases.

## [0.38.3] - 2026-08-06

Linux packaging fixes for two engines in the 0.38.0 wave. Both were caught by spindb's full engine matrix (robertjbass/spindb#268), both are repackages of the same upstream version, and no `databases.yml` entry, default or resolver behaviour changes.

### Fixed

- **Qdrant 1.18.3 `linux-x64` now runs on Ubuntu 22.04.** Upstream builds `qdrant-x86_64-unknown-linux-gnu.tar.gz` for 1.18.3 against a newer glibc than 1.16.3 was: the binary imports `GLIBC_2.38`, so on Ubuntu 22.04 (glibc 2.35) it never execs, failing at spindb's post-download `qdrant --version` verification with ``version `GLIBC_2.38' not found``. Ubuntu 24.04 (glibc 2.39) was unaffected, which is why only half the matrix went red. `linux-x64` now uses upstream's `qdrant-x86_64-unknown-linux-musl.tar.gz`, the same static musl asset `linux-arm64` has always used. Verified in `ubuntu:22.04`: the musl binary is `static-pie linked`, starts, and answers `/healthz`, `/` and `/collections`. 1.16.3 keeps the gnu asset (it only needs `GLIBC_2.34`).
- **CouchDB 3.5.2 `linux-x64` / `linux-arm64` now start on Ubuntu 22.04 and 24.04.** `builds/couchdb/Dockerfile` copied `/opt/couchdb` out of the official `couchdb:<version>` image but not the system libraries the bundled Erlang runtime links against, so the extracted tree silently inherited that image's base distro. The 3.5.2 image moved from Debian 12 (bookworm, glibc 2.36 / OpenSSL 3.0) to Debian 13 (trixie, glibc 2.41 / OpenSSL 3.5), which broke both supported baselines in different ways: on 22.04 `beam.smp` needs `GLIBC_2.38` and never execs, and on 24.04 it execs but `crypto.so` needs `OPENSSL_3.4.0`, so the crypto NIF fails to load and the node aborts with `{application_start_failure,config,{undef,{crypto,info_fips,[]}}}`. CI only saw "start timeout, then ECONNREFUSED" because `couchdb.log` was never dumped. Linux packaging now builds from the official Apache CouchDB apt repository (`couchdb=<version>~jammy`) inside `ubuntu:22.04` - our oldest supported Linux target - and unpacks the package with `dpkg-deb -x` so no maintainer script can bake a debconf admin password, node name or Erlang cookie into a redistributable tarball. Verified in `ubuntu:22.04` and `ubuntu:24.04` (x64) and `ubuntu:22.04` (arm64): CouchDB 3.5.2 starts and answers `GET /` on 5984. Rebuilding 3.5.1 through the new path was also verified and yields the same `erts-14.2.5.12` the shipping 3.5.1 tarball has.

### Changed

- **CouchDB Linux trees are normalized after unpacking**, so the tarball keeps the shape the working 3.5.1 artifact had. The package's FHS symlinks (`data -> /var/lib/couchdb`, `var/log -> /var/log/couchdb`) become real in-tree directories - `database_dir` defaults to `./data`, and with a dangling symlink `mem3` cannot create `_nodes` and the node dies with `{case_clause,{not_found,no_db_file}}`. The package's `10-filelog.ini` (which pins logging to `/var/log/couchdb`) is dropped, `etc/default.d/10-docker-default.ini` (`bind_address = any`) is restored, and the packaged `-name` line is stripped from `vm.args` so the node name comes from the caller. spindb generates its own `local.ini` and `vm.args`, so none of this changes how a spindb container is configured.

### Note

- The wave's other url-sourced `linux-x64` binaries were swept for the same glibc hazard (`objdump -T`, highest imported symbol version): influxdb 3.10.5 `2.18`, typedb 3.12.1 `2.25`, mysql 9.7.2 `2.28`, qdrant 1.16.3 `2.34`, meilisearch 1.52.0 `2.35`, mongodb 8.2.12 `2.35`, weaviate 1.38.8 none (static). All run on Ubuntu 22.04 today, and all of those engines passed spindb's 22.04 matrix. Meilisearch and MongoDB sit exactly at the 2.35 ceiling, so they are the two most likely to trip this next.

## [0.38.2] - 2026-08-06

### Fixed

- **QuestDB 9.4.3 now starts on `darwin-arm64`, `darwin-x64` and `linux-arm64`.** Those three platforms have no official QuestDB `-rt-` package, so hostdb repackages the `no-jre` tarball with an Adoptium Temurin JRE it bundles itself, and that JRE was pinned to the 21 line. QuestDB 9.4.x's `questdb.sh` passes `--sun-misc-unsafe-memory-access=allow`, a flag that only exists from JDK 24 on, so the JVM exited with `Unrecognized option` / `Could not create the Java Virtual Machine` before QuestDB ever started. The bundled JRE moves to the Temurin 25 LTS line (`api.adoptium.net/v3/binary/latest/25/ga/...`). `linux-x64` and `win32-x64` use QuestDB's own runtime bundles and were never affected.

## [0.38.1] - 2026-08-05

Metadata-only republish of the 0.38.0 engine wave. No `databases.yml` change, no resolver change, no defaults change: every version resolves exactly as it does on 0.38.0.

### Fixed

- **`releases.json` in the published package now lists all 21 versions from the wave.** 0.38.0 reached `main` and published to npm while four release workflows were still building, so its bundled `releases.json` snapshot was missing `valkey 9.0.5`, `redis 8.4.5`, `influxdb 3.10.5` and `mariadb 11.8.8`. `getReleaseInfo` returned null for those, `valkey 9.0.5` (the CVE-2026-56684 / CVE-2026-63639 fix) among them, even though the binaries were on R2. This republish carries the complete snapshot. Release-before-publish ordering is the standing rule; see the engine-version runbook.
- **Valkey Windows builds define `-D_GNU_SOURCE`.** Valkey 9.0.5 calls `asprintf()` in `valkey-benchmark.c`, which Cygwin's newlib headers gate behind `__GNU_VISIBLE`. Without it the call is an implicit declaration and a hard error, and it blocked the entire 9.0.5 release even though the other four platforms built clean. 9.0.5 now ships on all five platforms.
- **Weaviate release builds use Go 1.26.** Weaviate 1.38.8's `go.mod` requires `go >= 1.26` while the workflow pinned 1.23. Because the cross-compile runs with `GOTOOLCHAIN=local`, Go did not auto-upgrade and the darwin-x64, darwin-arm64 and win32-x64 builds failed. The build script counts a failed cross-compile as a skipped platform, so the run still reported success and 1.38.8 first shipped with only its two linux platforms. It now ships on all five.

### Known issue

- A requested-but-unbuilt platform does not fail a release run: the per-engine build scripts report it as "skipped" and the workflow still concludes success. That is how the Weaviate gap above stayed invisible until `releases.json` was inspected by hand. Worth making a platform that was requested and did not build a hard failure.

## [0.38.0] - 2026-08-05

Engine security + feature wave. Thirteen engines gain new versions in one release; no existing version was removed, and every prior version still resolves.

### Security

- **Valkey 9.0.5 and 8.0.10** (build-required, all 5 platforms). Fixes `CVE-2026-56684` (TLS use-after-free reachable by an authenticated client via `CLIENT KILL`) and `CVE-2026-63639` (corrupt stream RDB sharing a NACK across consumers, leading to RCE). Upstream advises applying as soon as possible.
- **Redis 7.2.15, 8.4.5 and 7.4.10** (build-required on the 4 unix platforms; win32-x64 from the redis-windows msys2 zip). Fixes `CVE-2026-66373`: a crafted stream `RESTORE` payload makes two consumers share a NACK, a use-after-free leading to RCE. 7.2.15 stays BSD-3-Clause, so the managed-service-safe line takes the fix without a license change.
- **MongoDB 8.0.28, 8.2.12 and 7.0.39** (url + sha256, all 5 platforms). Picks up the July 2026 MongoDB security batch, including `CVE-2026-13072` and `CVE-2026-13074`.
- **MySQL 8.4.11 and 9.7.2** (url + sha256, all 5 platforms). Picks up the July 2026 Oracle Critical Patch Update for the MySQL Server tree, including `CVE-2026-60311`.
- **MariaDB 11.8.8** (official archive.mariadb.org tarball for linux-x64 and win32-x64; build-required for linux-arm64, darwin-x64 and darwin-arm64). Picks up `CVE-2026-44171`.

### Added

- **TypeDB 3.12.1** (official repo.typedb.com archives, all 5 platforms).
- **Meilisearch 1.52.0** (official community GitHub release binaries, all 5 platforms). The enterprise assets are deliberately not used.
- **Qdrant 1.18.3** (official GitHub release archives, all 5 platforms). linux-arm64 continues to use the musl tarball while linux-x64 uses gnu, unchanged from 1.16.3.
- **Weaviate 1.38.8** (official linux-x64 and linux-arm64 archives; darwin-x64, darwin-arm64 and win32-x64 stay cross-compiled from source).
- **InfluxDB 3.10.5** (official InfluxData CDN archives for linux-x64, linux-arm64, darwin-arm64 and win32-x64). darwin-x64 stays build-required because upstream ships no macOS Intel build.
- **SQLite 3.53.4** (build-required on linux-x64 and linux-arm64 from the amalgamation; official sqlite.org tools zips for darwin-x64, darwin-arm64 and win32-x64). SHA3-256 checksums, verified against the values published on sqlite.org.
- **CouchDB 3.5.2** (docker-extract from `couchdb:3.5.2` for linux; Neighbourhoodie downloads for darwin and win32).

### Changed

Defaults shifted so a bare major resolves to the fixed or newest patch. Minor bump per the defaults-policy rule. Every superseded version stays supported and resolvable, and existing containers self-pin their stored full version, so nothing running is disturbed.

- `valkey` `'9'` 9.0.4 to 9.0.5, `'8'` 8.0.9 to 8.0.10
- `redis` `'7'` 7.2.14 to 7.2.15, `'8'` 8.4.0 to 8.4.5
- `mongodb` `'8'` 8.0.23 to 8.0.28, `'7'` 7.0.34 to 7.0.39. `'8'` deliberately stays on the 8.0 LTS line and is NOT pointed at 8.2.x; the defaults entry exists precisely to stop a bare `'8'` prefix-matching into 8.2.
- `mysql` `'8'` 8.4.9 to 8.4.11, `'9'` 9.6.0 to 9.7.2
- `mariadb` `'11'` 11.8.6 to 11.8.8. The 10.11 line is untouched.
- `typedb` `'3'` 3.12.0 to 3.12.1
- `meilisearch` `'1'` 1.43.1 to 1.52.0
- `qdrant` `'1'` 1.16.3 to 1.18.3
- `weaviate` `'1'` 1.35.7 to 1.38.8
- `influxdb` `'3'` 3.8.0 to 3.10.5
- `sqlite` `'3'` 3.53.1 to 3.53.4
- `couchdb` `'3'` 3.5.1 to 3.5.2

## [0.37.0] - 2026-08-05

### Added

- **QuestDB 9.4.3** (all 5 platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64). Repackaged from the official QuestDB 9.4.3 GitHub release: `-rt-` runtime bundles for linux-x64 and win32-x64, the `no-jre` package plus a bundled Adoptium Temurin JRE elsewhere, matching the 9.2.3 packaging.

### Changed

- **QuestDB default shifted from 9.2.3 to 9.4.3** (latest over previous stable). The `defaults` block now resolves major `9` to `9.4.3`, so a bare `questdb` request and `spindb create questdb` now provision 9.4.3. The 9.2 line stays fully supported: `9.2` still resolves to `9.2.3`, and existing containers self-pin their stored full version, so nothing on 9.2 is disturbed. Minor bump per the defaults-policy rule.

## [0.36.0] - 2026-07-24

### Added

- **DuckDB 1.5.5** (all 5 platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64). Repackaged from the official DuckDB v1.5.5 GitHub release.

### Changed

- **DuckDB default shifted from 1.4.4 to 1.5.5** (latest over previous stable). The `defaults` block now resolves major `1` to `1.5.5`, so a bare `duckdb` request and `spindb create duckdb` now provision 1.5.5. The 1.4 line stays fully supported: `1.4` still resolves to `1.4.4`, and existing containers self-pin their stored full version, so nothing on 1.4 is disturbed. Minor bump per the defaults-policy rule.

## [0.35.2] - 2026-07-24

### Documentation

- Restamp `UPGRADE_PLAYBOOK.md` as a copy of the new canonical engine-version-update runbook, which now lives in the layerbase-cloud repo (`deploy/ENGINE-VERSION-UPDATE-RUNBOOK.md`, the ecosystem doc source of truth). The playbook here now carries an outdated-warning banner pointing at the cloud original.

## [0.35.1] - 2026-07-13

### Documentation

- Add a "Sponsored by Layerbase" banner to the README, with the Layerbase icon vendored to `assets/layerbase-icon.svg` and a link to [layerbase.com](https://layerbase.com).

## [0.35.0] - 2026-07-12

### Added

- **Per-version `releaseType` manifest field (`alpha` | `beta` | `rc`).** A version entry in `databases.yml` can now carry `release_type: beta` (snake_case in YAML, mirrored to `releaseType` in `databases.json`), and the value is propagated into `releases.json` by `scripts/build-releases-json.ts`. GA versions carry no field. The `databases.schema.json` and `releases.schema.json` schemas were updated in the same change.
- **New prerelease API.** `getReleaseType(engine, version)` returns `'alpha' | 'beta' | 'rc' | 'ga' | null`; `isVersionPrerelease(engine, version)` returns a boolean; `getPrereleaseVersions(engine)` lists only the prerelease versions. `listVersions(engine, { includePrerelease })` now opts prerelease versions into the listing (excluded by default), and `getReleaseInfo` now includes `releaseType` in its return value.

### Changed

- **Prerelease resolution policy: exact-token only.** A prerelease version resolves only when the caller passes its exact token (e.g. `resolveVersion('postgresql', '19.0.0-beta.1')` → `'19.0.0-beta.1'`). Prereleases are never reached by prefix match (`'19'`, `'19.0'` → `null`), never returned as an engine's `latest`, and never used as a `defaults`-block fallback. This keeps `getEngineDefaults`, `getSupportedMajorVersions`, and the default/latest of an engine unaffected by an in-flight beta.
- **PostgreSQL 19.0.0-beta.1 added on four platforms** (linux-x64, linux-arm64, darwin-x64, darwin-arm64). win32 is deferred to RC because EDB publishes prerelease Windows binaries starting at RC. Prerelease source-version mapping was added to the postgres build pipeline (`builds/postgresql/build-local.sh`, `sources.json`), and `release-postgresql.yml` now drives a per-version platform matrix so the beta builds only its four platforms.

## [0.34.1] - 2026-07-10

### Documentation

- `BINARIES.md` now documents the two new top-level directories in TypeDB 3.12+ archives: `admin/typedb_admin_bin` (OS-socket admin CLI) and `loader/typedb_loader_bin` (bulk import). Pre-3.12 archives lack both and shipped a pre-created `server/data/` directory that 3.12 creates on first boot instead. No code or registry changes.

## [0.34.0] - 2026-07-10

### Added

- **TypeDB 3.12.0 added** across all five hosted platforms (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64). Sources and SHA-256 checksums populated in `builds/typedb/sources.json`; the release-workflow version dropdown now defaults to 3.12.0.

### Changed

- **TypeDB default for major `'3'` moved from `3.11.5` to `3.12.0` (policy change).** `resolveVersion('typedb', '3')` now returns `3.12.0`. This is a user-visible `defaults` block change, hence the minor bump.

### Deprecated

- **TypeDB 3.11.5 deprecated.** It is dropped from the release-workflow dropdown and marked deprecated in `databases.yml`/`databases.json`, but still resolves (`resolveVersion('typedb', '3.11.5')` → `3.11.5`) and its binaries remain hosted on R2 so existing consumers are unaffected.

## [0.33.6] - 2026-07-04

### Changed

- **Licensing: standardized the commercial-licensing language in `LICENSE` (matches spindb).** Added a commercial-use notice above the PolyForm Noncommercial 1.0.0 body (the grant itself is unchanged) that enumerates commercial use - commercial products/services/SaaS, internal for-profit operations, and using the software, its source, or its output to train, fine-tune, evaluate, or retrieval-augment AI/ML models, systems, or agents for any for-profit purpose - states that a one-time commercial license fee applies, and lists the licensing contact as bob@layerbase.com.

## [0.33.5] - 2026-06-06

### Changed

- **CI: bump the remaining safe actions off Node 20.** `pnpm/action-setup@v4 -> v6` (73x) and `docker/setup-buildx-action`/`docker/setup-qemu-action@v3 -> v4`. This clears the Node-20 deprecation on the everyday workflows (publish, ci, version-check). Known residual on the **dispatch-only `release-*.yml`** workflows: `upload-artifact@v4`/`download-artifact@v4` (latest v7/v8 are breaking-prone and PR CI can't validate them), `softprops/action-gh-release@v2` (latest v3), and `ilammy/msvc-dev-cmd@v1` (already the latest major) - those need a separate, manually-tested release-workflow pass.

## [0.33.4] - 2026-06-06

### Changed

- **`scripts/build-releases-json.ts`: hardened the GitHub fetches.** Added a 20s per-request timeout + retry to every fetch (the releases list and each release's `checksums.txt`), and parallelized the per-release processing (bounded to 8 concurrent). Previously the fetches were sequential with no timeout, so a single stuck connection could hang the publish indefinitely, and the step slowed as the release count grew (55 releases took ~40s locally, minutes on a bad CI run). Now it's ~3s. Output is byte-identical (the manifest is deterministically re-sorted), so `releases.json` is unchanged.

## [0.33.3] - 2026-06-06

### Changed

- **CI: upgrade GitHub Actions off the deprecated Node 20 runtime.** Bumped `actions/checkout@v4 → v6`, `actions/setup-node@v4 → v6`, `actions/github-script@v7 → v9`, `actions/setup-go@v5 → v6`, and `node-version: '22' → '24'` (current Active LTS) across all workflows. This clears the Node-20 action-runtime deprecation warnings. The artifact actions (`upload-artifact@v4`, `download-artifact@v4`) are intentionally **left for a separate, manually-tested pass** - their latest majors are v7/v8 (multi-major, breaking-prone), and they run only in dispatch-only release workflows that PR CI does not exercise.

## [0.33.2] - 2026-06-06

### Removed

- **MySQL 8.4.3 disabled (`enabled: false`).** Superseded by 8.4.9 (the current 8.4 LTS patch, which is the minimal build). `resolveVersion('mysql', '8.4.3')` now returns `null`, 8.4.3 is dropped from `listVersions` and from the release-workflow version dropdown, and `'8.4'` continues to resolve to 8.4.9. The ~953 MB R2 binary is **retained** (not deleted), so any already-running container is unaffected. Nothing in the ecosystem pins `8.4.3` explicitly (layerbase uses `'8.4'`). Note: this leaves 8.4.3's released binaries flagged as orphans by `pnpm prep`'s discrepancy check (expected for a disabled-but-retained version; would clear if the binary is later deleted via `delete:releases`).

## [0.33.1] - 2026-06-05

### Changed

- **MySQL 8.4.9 and 9.6.0 `linux-x64` re-hosted as the official MySQL `-minimal` build.** The re-hosted tarballs shrink from ~872 MB → ~135 MB (8.4.9) and ~1042 MB → ~138 MB (9.6.0) — an ~84% cut. MySQL's `-minimal` distribution removes only never-executed artifacts (the `mysql-test/` suite, debug binaries, debug plugins, and static `.a` libraries) and keeps the entire `bin/` (every CLI tool), all runtime plugins, the bundled OpenSSL/SASL libraries, and the charset/error-message data. The four binaries spindb and layerbase-cloud invoke — `mysqld`, `mysql`, `mysqldump`, `mysqladmin` — are all present, and a full `spindb create → seed → backup → restore → verify` end-to-end run passed on both versions. `resolveVersion` output is unchanged (same inputs resolve to the same full versions); only the `linux-x64` binary payload and its `releases.json` size/sha change.

### Notes

- **`linux-x64` only.** MySQL publishes a `-minimal` build for `x86_64` (glibc2.28 — the same runtime floor as the full tarball, so no new compatibility requirement) but not for `aarch64`, macOS, or Windows, which are unchanged. MySQL 8.4.3 (no vendor `-minimal` available) and the deprecated versions (8.0.40, 9.1.0, 9.5.0) are also unchanged.
- R2 retains the prior full binaries (`_backup/`), so already-cached containers keep working; new downloads pull the minimal.

### Coordination notes

This is a **patch** bump (0.33.0 → 0.33.1): a binary re-host only, with no `defaults`/resolver change. The downstream exact-pin cascade still applies — bump spindb's `hostdb` pin to 0.33.1 and run its test matrix (the MySQL integration test downloads the minimal and exercises it), then `SPINDB_VERSION` in layerbase-cloud and the `spindb` pin in layerbase-desktop.

## [0.33.0] - 2026-06-03

### Added

- **TypeDB 3.11.5** for all 5 platforms (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64), repackaged from the official Cloudsmith `typedb-all` archives. TypeDB 3.11 raised the network protocol version from 7 to 8, so the previously shipped 3.8.0 (protocol 7) could not talk to current TypeDB 3.11.x servers/drivers — 3.11.5 brings the bundled server and console back in step with the current TypeDB ecosystem.

### Changed — defaults block policy

- **TypeDB `defaults["3"]` repointed from `3.8.0` → `3.11.5`.** `resolveVersion('typedb', '3')` now returns `3.11.5`, so new `typedb 3` containers provision the current release. Existing containers pin their full version and are unaffected.

### Deprecated

- **TypeDB 3.8.0** is now `deprecated: true` — still resolvable and downloadable (so existing installs and references keep working), but hidden from default version listings and create flows in downstream UIs. Sunset in favor of 3.11.5.

## [0.32.0] - 2026-05-23

### Added

- **Redis 7.2.14** — latest patch in the BSD-3-Clause 7.2.x line, the newest Redis version permissively licensed for managed/DBaaS-style self-hosting. Built from source on linux-x64, linux-arm64, darwin-x64, darwin-arm64; Windows binary from [redis-windows](https://github.com/redis-windows/redis-windows). Adds a third Redis license tier alongside the existing 7.4.x (RSALv2/SSPLv1) and 8.x (RSALv2/SSPLv1/AGPL-3.0) lines.

### Changed — defaults block policy

- **Redis `defaults["7"]` repointed from `7.4.9` → `7.2.14`.** This is a user-visible policy change: `resolveVersion('redis', '7')` now returns the BSD-licensed 7.2.14 instead of the source-available 7.4.9. Driven by managed-service license compatibility — downstream consumers (spindb/layerbase-cloud) need a BSD path so `hostedServiceAllowed: true` is unambiguous. `defaults["8"]` is unchanged (still `8.4.0`); consumers that want a newer Redis can still pass an explicit 7.4.x or 8.x version.

### Deprecated

- **Redis 7.4.9 and 7.4.7** — marked deprecated due to RSALv2/SSPLv1 license restricting competing managed services. Existing R2 binaries remain available; the workflow dropdowns skip them and `isVersionDeprecated()` returns true. Use 7.2.14 for managed-service use or stay on 7.4.x for self-contained applications.

### Coordination notes

This is a **minor** bump (0.31.2 → 0.32.0), not patch, because the `defaults` block policy change is user-visible — per the project rule: "Always write a CHANGELOG entry when changing a `defaults` value — it's policy, not data." Downstream pin cascade applies (spindb exact-pin, layerbase-cloud `SPINDB_VERSION`, layerbase-desktop `spindb` pin).

## [0.31.2] - 2026-05-22

### Changed

- **Docs reshuffle.** `CLAUDE.md` slimmed from 43k to 14k chars (was tripping the Claude Code harness performance warning). Build-script and macOS dylib reference moved to a new `builds/common/README.md`. Cloudflare R2 hosting + secret setup moved into `ARCHITECTURE.md`. No code or shipped-file changes — the published npm tarball contents are byte-identical to 0.31.1.

## [0.31.1] - 2026-05-16

### Fixed

- **`tsx` moved from `dependencies` to `devDependencies`.** hostdb ships compiled JS in `dist/` and `bin/cli.js` is pre-compiled too, so end users do not need `tsx` at runtime. Having it as a regular dep caused downstream consumers (the spindb bundle in layerbase-desktop) to pull in platform-specific `@esbuild/<platform>` binaries via tsx's transitive deps, which broke electron-builder's universal-macOS merge with a misleading "same file in both arches" error. No functional change — `dist/index.js` and `bin/cli.js` are unchanged.

## [0.31.0] - 2026-05-15

### Added — npm package surface

hostdb now publishes a typed npm package alongside the R2 binary registry. Consumers (spindb, layerbase-cloud, layerbase-desktop) import `hostdb` and resolve versions, query CLI tools, and look up download URLs entirely offline — no runtime fetch from `registry.layerbase.host` for the registry itself.

- **Resolver API** (`lib/resolver.ts`) — `resolveVersion`, `normalizeVersion`, `listVersions`, `listEngines`, `getSupportedMajorVersions`, `getMajorDefault`, `getEngineDefaults`, `getReleaseInfo`, `getAvailablePlatforms`, `isVersionDeprecated`, `getCliTools`, `getDatabaseEntry`, `compareVersions`. Full surface locked in `tests/api-shape.test.ts` (19 names).
- **Bundled registry snapshot** — `databases.json`, `releases.json`, `downloads.json` ship in the npm tarball; programmatic loaders `loadDatabasesJson` / `loadReleasesJson` / `loadDownloadsJson` are also exported.
- **`defaults` block per engine** in `databases.yml` — explicit major→full-version policy. Encodes LTS-vs-latest decisions (`mongodb '8' → 8.0.23` LTS, NOT 8.2.x; `mysql '8' → 8.4.9` LTS, NOT 9.x).
- **Compiled `dist/`** ships in the tarball; consumers don't need TypeScript or tsx. `prepare` script auto-builds dist/ on `pnpm install` in the repo dir.
- **CI pack-and-install smoke test** (`.github/workflows/ci.yml`) verifies the tarball installs cleanly under both npm and pnpm.
- **Pre-publish drift gate** — `publish.yml` regenerates `releases.json` from live GitHub releases and aborts if it diverges from the committed file.
- **R2 orphan audit** — new `pnpm audit:r2-orphans` script lists R2 objects not referenced by `releases.json`.

### Changed

- `databases.yml` schema gained an optional `defaults` block per engine. Backward-compatible — old consumers ignore unknown fields.
- `databases.json` regenerated from `databases.yml` includes the new `defaults` block.

### Coordination notes

Spindb consumes this version as an **exact pin** (`"hostdb": "0.31.0"`, no caret/tilde). See `UPGRADE_PLAYBOOK.md` Part A3 for the full publish cascade across the 5-repo ecosystem.

## [0.30.0] - 2026-03-12

### Added

- **libSQL (sqld) engine** — SQLite fork by Turso with server mode, HTTP API, and replication
  - Version 0.24.32 with official binaries for 4 platforms (linux-x64, linux-arm64, darwin-x64, darwin-arm64)
  - No Windows binaries available upstream (WSL required, same pattern as ClickHouse)
  - MIT licensed, sqlite protocol compatible
  - Download script repackages official tar.xz archives into hostdb tar.gz format
  - Release workflow with full validation, R2 upload, and releases.json update

## [0.29.0] - 2026-03-11

### Added

- **Version deprecation support** — new `deprecated` field in database and release schemas
  - Deprecated versions retain existing binaries in `releases.json` but are excluded from workflow build dropdowns
  - `databases.schema.json`, `releases.schema.json`, and `lib/databases.ts` updated with `deprecated` field
  - `sync-versions.ts` excludes deprecated versions from GitHub Actions workflow dropdowns
  - `build-releases-json.ts` propagates `deprecated` flag into `releases.json` entries
  - `prep.ts` skips deprecated versions when checking for missing releases
- **MySQL 9.6.0** — added with official binaries for all 5 platforms

### Deprecated

- **MySQL 8.0.40** — use 8.4.x LTS instead
- **MySQL 9.1.0** — superseded by 9.6.0
- **MySQL 9.5.0** — superseded by 9.6.0

## [0.28.0] - 2026-02-20

### Added

- **Binary validation in all release workflows** (`builds/common/validate-binaries.sh`)
  - Shared script that extracts archives and verifies all required `cli_tools` binaries exist before creating GitHub Releases
  - Reads `databases.json` to determine required binaries per engine (server, client, utilities)
  - Handles dependency-aware validation — skips binaries provided by dependency databases (e.g., QuestDB depends on PostgreSQL for `psql`)
  - Handles naming variants across platforms (Windows `.exe`/`.cmd`/`.bat` extensions, hyphen-to-underscore)
  - Added as a "Validate required binaries" step in all 21 release workflows
  - Prevents shipping incomplete releases (e.g., PostgreSQL without `psql` and `pg_dump`)

## [0.27.0] - 2026-02-16

### Added

- **Generic macOS dylib patching for relocatable binaries** (`builds/common/fix-macos-dylibs.sh`)
  - Standalone script that bundles Homebrew dylibs into a package's `lib/` directory and rewrites absolute paths to `@loader_path` relative references
  - Adapted from the proven inline implementation in `builds/postgresql-documentdb/build-macos.sh`
  - Handles recursive transitive dependencies, code signing, and verification (fails CI if Homebrew paths remain)
  - Integrated into MariaDB, Redis, Valkey, and CouchDB release workflows (macOS build steps)
  - Fixes OpenSSL (and pcre2, jemalloc, lz4, zstd, snappy for MariaDB) dylib-not-found crashes on Macs without Homebrew

- **macOS dylib audit tooling**
  - `builds/common/check-macos-dylibs.sh` — read-only diagnostic that scans packages for non-relocatable Homebrew paths (`pnpm check:dylibs`)
  - `.github/workflows/audit-dylibs.yml` — manually triggered workflow that downloads macOS tarballs from R2 and audits them, producing a summary table with prescriptive rebuild actions

- **Cloudflare CDN cache purging** on R2 uploads
  - Added `purgeCloudflareCache()` to `lib/r2.ts` — purges CDN edge cache after force-uploading to R2
  - Integrated into `scripts/upload-to-r2.ts` when `--force` is used
  - All release workflows now use `--force` on upload-to-r2, ensuring rebuilds always overwrite R2 objects and purge stale CDN cache

### Changed

- **CouchDB macOS builds now run on macOS runners** (was ubuntu-latest) to enable dylib patching — downloads from Neighbourhoodie are now patched for relocatability
- **All release workflows now force-upload to R2** with automatic CDN cache purging — eliminates stale cached tarballs after rebuilds
- **Redis and Valkey macOS builds now include `lib/`** with bundled OpenSSL dylibs (`libssl.3.dylib`, `libcrypto.3.dylib`)
- **BINARIES.md** updated to reflect `lib/` directory in Redis and Valkey macOS archives
- **CHECKLIST.md** updated with Phase 5.1b for macOS dylib patching guidance

## [0.26.1] - 2026-02-16

### Fixed

- **TigerBeetle workflow: revert `fail_on_unmatched_files` to false** — Single-platform builds (e.g. linux-x64 only) produce only `.tar.gz`, no `.zip`; `true` would fail the release step on unmatched glob
- **TigerBeetle workflow: validate artifacts before checksumming** — Fail early if no archives exist instead of silently creating empty checksums.txt
- **TigerBeetle download script: specific error handling in `findBinary`** — Only ignore expected filesystem errors (ENOENT, EACCES, ENOTDIR) during recursive search; rethrow unexpected errors
- **TigerBeetle download script: remove unreachable `break` after `process.exit()`** — Clean up dead code in argument parsing
- **Removed TigerBeetle from PROSPECTS.md** — Already built and released; no longer a prospect

## [0.26.0] - 2026-02-16

### Added

- **TigerBeetle support** (new database engine)
  - High-performance financial ledger database designed for mission-critical safety and throughput
  - All 5 platforms supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - Official binaries from GitHub Releases (all platforms as zip archives)
  - Single binary architecture with built-in REPL client (`tigerbeetle start` for server, `tigerbeetle repl` for client)
  - Written in Zig; uses custom binary protocol on port 3000
  - Version 0.16.70
  - First financial ledger database in hostdb
  - License: Apache-2.0

## [0.25.1] - 2026-02-15

### Changed

- **Weaviate marked as completed** - All platforms fully implemented and ready for release

## [0.25.0] - 2026-02-15

### Added

- **Weaviate support** (new database engine)
  - AI-native vector database with built-in vectorization modules and hybrid search
  - All 5 platforms supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - Linux: Official binaries from GitHub Releases
  - macOS/Windows: Cross-compiled from source using Go (CGO_ENABLED=0, pure Go)
  - Single binary architecture (REST/gRPC API, GraphQL query language)
  - Version 1.35.7
  - Second vector database in hostdb (alongside Qdrant)
  - License: BSD-3-Clause (fully permissive)

## [0.24.0] - 2026-02-15

### Changed

- **All binary downloads now served from `registry.layerbase.host`** — Binaries are hosted on Cloudflare R2 behind `registry.layerbase.host`, replacing direct GitHub Releases download URLs. GitHub Releases are still created as the build artifact source, but all public download URLs in `releases.json` point to the R2 registry.

### Removed

- **One-off debug/rebuild workflows** — Removed `build-windows-postgresql-documentdb.yml`, `build-macos-postgresql-documentdb.yml`, and `rebuild-macos-postgresql.yml`. These were created for iterating on specific builds and are no longer needed now that the release workflows handle everything.
- **Legacy Homebrew-based macOS build script** — Removed `builds/postgresql-documentdb/legacy/` directory containing the deprecated Homebrew-based build approach, which was replaced by the current source build for relocatable binaries.

## [0.23.1] - 2026-02-15

### Changed

- **Consolidated FerretDB v1 into the ferretdb engine** — Removed the separate `ferretdb-v1` engine, workflow, and build directory. Both v1.x and v2.x are now managed under `ferretdb` with a single workflow, sources.json, and download script. The download script handles version-specific differences automatically (binary naming, v1's `version.txt` requirement).

### Fixed

- **Workflow validation rejects object-form versions** — The `validate` job in all release workflows only accepted `true` for version entries, rejecting versions with per-version config (platforms, dependencies). Now treats both `true` and config objects (without explicit `"enabled": false`) as enabled.

### Added

- **Publish databases.json and downloads.json to R2** — The `--upload-r2` flag in `build-releases-json.ts` now uploads all three manifest files (`releases.json`, `databases.json`, `downloads.json`) to R2, ensuring the registry always has up-to-date metadata. `databases.json` is regenerated from `databases.yml` before upload.

## [0.23.0] - 2026-02-14

### Added

- **Cloudflare R2 binary hosting** — Binaries are now mirrored to Cloudflare R2 behind `registry.layerbase.host`
  - New `upload-to-r2` job added to all 20 release workflows, running between `release` and `update-manifest`
  - `lib/r2.ts` — Shared R2 client utilities (S3-compatible)
  - `lib/registry.ts` — Single source of truth for `REGISTRY_BASE_URL`
  - `scripts/upload-to-r2.ts` — Per-release upload script (called by CI after each release)
  - `scripts/migrate-to-r2.ts` — One-time bulk migration of existing GitHub Releases to R2
  - `.env.example` — Documents required R2 environment variables
  - Download URLs in `releases.json` now point to R2 (`registry.layerbase.host/{tag}/{filename}`) instead of GitHub Releases
  - GitHub Releases still created as the build artifact source; R2 serves all public downloads

### Changed

- **Checksums module refactored** (`lib/checksums.ts`) — Now prefers GitHub API asset download over browser download URL, with proper token handling
- **`update-releases.ts`** — Uses shared `fetchChecksums()` from `lib/checksums.ts` instead of inline implementation; URLs generated via `getDownloadUrl()` helper
- **`reconcile-releases.ts`** — URLs generated via `getDownloadUrl()` helper instead of `browser_download_url`
- **Releases schema** — Descriptions updated to be provider-agnostic (no longer GitHub-specific)

## [0.22.1] - 2026-02-14

### Fixed

- **FerretDB v1 binary panic on startup** — Cross-compiled binaries were missing `build/version/version.txt`, which FerretDB embeds via `//go:embed` at compile time. Without it, the `init()` function panics with "Invalid build/version/version.txt file content". Now generates the file with the correct version string before `go build`.

## [0.22.0] - 2026-02-13

### Added

- **FerretDB v1 support** (new database engine variant)
  - FerretDB v1.x line using plain PostgreSQL as backend (no DocumentDB extension)
  - Separate `ferretdb-v1` database ID since v1.x and v2.x have different backend dependencies
  - v1 depends on `postgresql` (no cascade delete); v2 depends on `postgresql-documentdb` (cascade delete)
  - Lighter weight than v2 but fewer MongoDB features
  - Same binary strategy as v2: Linux from official releases, macOS/Windows cross-compiled with Go
  - Bundles mongosh and MongoDB database-tools for complete MongoDB-compatible experience
  - Version 1.24.2 (latest v1.x release)
  - All 5 platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - License: Apache-2.0

## [0.21.2] - 2026-02-08

### Added

- **sqlite-vec** added to databases.json as `pending` — SQLite loadable extension for vector similarity search with KNN queries. Pure C, zero dependencies, pre-built for all 5 platforms. Natural fit alongside existing SQLite distribution.
- **DuckDB VSS** added to databases.json as `unsupported` — DuckDB's vector similarity search extension. Marked unsupported because it's experimental (WAL recovery not implemented), has no formal releases, and is distributed through DuckDB's built-in extension hub rather than as a standalone binary.
- **IN_PROGRESS.md** updated with current work items: sqlite-vec support, TypeDB/InfluxDB integration status, FerretDB Windows/v1 considerations

### Changed

- **sync-releases.yml** — Changed from push-on-main to `workflow_dispatch` only. Was running unnecessarily on every push to main; release workflows already trigger it explicitly via their `trigger-sync` job.

### Removed

- **redis-valkey-win.yml** — Deleted temporary workflow (was marked `TODO - DELETE`)

## [0.21.1] - 2026-02-08

### Fixed

- **Workflow permission for trigger-sync job** - Added `actions: write` permission to 9 release workflows missing it (clickhouse, influxdb, mariadb, mongodb, mysql, postgresql, redis, sqlite, valkey), fixing HTTP 403 when triggering sync-releases

## [0.21.0] - 2026-02-08

### Added

- **InfluxDB support** (new database engine)
  - Purpose-built time-series database rewritten in Rust (v3.x) using Apache Arrow/DataFusion
  - 4 of 5 platforms via official binaries: linux-x64, linux-arm64, darwin-arm64, win32-x64
  - darwin-x64 (macOS Intel) built from source via cargo
  - Official binaries from dl.influxdata.com CDN
  - Archives include bundled Python 3.13 runtime for PYO3 plugin system
  - Version 3.8.0
  - Most popular time-series database by adoption
  - License: Apache-2.0 AND MIT (dual-licensed)

## [0.20.0] - 2026-02-07

### Added

- **TypeDB support** (new database engine)
  - Strongly-typed graph database with TypeQL query language, built for knowledge representation and reasoning
  - All 5 platforms supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - Official binaries from Cloudsmith (repo.typedb.com)
  - Version 3.8.0 (Rust rewrite, v3.x)
  - Archive preserves TypeDB's multi-component structure: server, console, launcher script, config
  - First graph database in hostdb
  - License: MPL-2.0

## [0.19.5] - 2026-02-07

### Fixed

- **macOS build: disable NLS to fix PostGIS compilation on x64 runner**
  - PostgreSQL's configure detected gettext on the x64 runner, enabling NLS
  - PostGIS's configure also detected gettext, defining `ENABLE_NLS` in its build
  - PostGIS's `ENABLE_NLS` leaked into PostgreSQL's `c.h` header, triggering `#include <libintl.h>`
  - PostGIS build failed with `'libintl.h' file not found` since gettext include path wasn't propagated
  - Fix: `--disable-nls` in PostgreSQL configure and `--without-gettext` in PostGIS configure

## [0.19.4] - 2026-02-07

### Fixed

- **macOS build: fix PostgreSQL compilation on macOS 15.5 SDK**
  - `strchrnul` declared available since macOS 15.4, but deployment target defaulted to 15.0
  - PostgreSQL's `-Werror=unguarded-availability-new` turned this into a build error
  - Set `MACOSX_DEPLOYMENT_TARGET` to current OS version dynamically
  - Safe for arm64 (macOS 14 SDK doesn't declare `strchrnul` at all)

## [0.19.3] - 2026-02-07

### Fixed

- **macOS build: bundle Homebrew deps from lib/postgresql/ extension dylibs**
  - DocumentDB extension dylibs in `lib/postgresql/` had hardcoded Homebrew paths for libbson and libpcre2 that were never bundled or rewritten
  - Root cause: dependency bundling loop only scanned `lib/*.dylib`, not `lib/postgresql/*.dylib`
  - On arm64 extensions landed in `lib/` (caught), on x64 they landed in `lib/postgresql/` (skipped)
  - Added `lib/postgresql/*.dylib` scanning to bundling loop, verification, and code signing steps

## [0.19.2] - 2026-01-27

### Added

- **Database dependency field** in schema and databases.json
  - FerretDB depends on postgresql-documentdb (cascade delete - removed together)
  - QuestDB depends on postgresql (no cascade delete - PostgreSQL remains as standalone)
  - README updated with dependency documentation table

## [0.19.1] - 2026-01-26

### Changed

- **QuestDB marked as completed** - All platforms fully tested and integrated with SpinDB

## [0.19.0] - 2026-01-26

### Added

- **QuestDB support** (new database engine)
  - High-performance time-series database with SQL support and fast ingestion
  - All 5 platforms supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - Linux x64 and Windows x64 use official `-rt-` packages (JRE included by QuestDB)
  - Linux ARM64 and macOS use no-JRE package bundled with Adoptium Temurin JRE 21 LTS
  - PostgreSQL wire protocol (compatible with psql, pgcli, usql)
  - First time-series database in hostdb
  - License: Apache-2.0

## [0.18.0] - 2026-01-25

### Added

- **CockroachDB support** (new database engine)
  - Distributed SQL database with PostgreSQL compatibility
  - All 5 platforms supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - Official binaries from binaries.cockroachdb.com
  - Single binary architecture (`cockroach start-single-node` for server, `cockroach sql` for client)
  - License: Cockroach Community License (free for most use cases)

- **SurrealDB support** (new database engine)
  - Multi-model database (documents, graphs, key-value, time-series)
  - All 5 platforms supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - Official binaries from GitHub releases
  - Single binary architecture (`surreal start` for server, `surreal sql` for client)
  - Windows distributed as raw .exe binary (not archive)
  - License: Business Source License 1.1

## [0.17.0] - 2026-01-25

### Added

- **CouchDB support** (new database engine)
  - Apache CouchDB document database with HTTP API and offline-first sync
  - All 5 platforms supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
  - Linux: Extracted from official CouchDB Docker image
  - macOS: Official binaries from Neighbourhoodie
  - Windows: MSI installer from Neighbourhoodie, extracted for portable use
  - License: Apache-2.0

## [0.14.20] - 2026-01-25

### Fixed

- **GitHub Actions: increase linux-arm64 build timeout to 150 minutes**
  - PostGIS compilation under QEMU takes 30-40 minutes alone
  - Previous 60-minute timeout was insufficient for full build

## [0.14.19] - 2026-01-25

### Fixed

- **Linux build: don't bundle C/C++ runtime libraries**
  - Exclude libstdc++, libgfortran, libquadmath from bundling
  - These are tightly coupled with glibc and should use the system version
  - Fixes glibc version mismatch errors on older systems (Ubuntu 22.04)

## [0.14.18] - 2026-01-25

### Fixed

- **Linux build: fix DocumentDB extension check**
  - Use direct file existence check instead of `ls | grep` for reliability

## [0.14.17] - 2026-01-24

### Fixed

- **Linux postgresql-documentdb builds: build mongo-c-driver from source**
  - Debian bookworm's libbson-dev is too old for DocumentDB v0.107.0 (missing `BSON_SUBTYPE_SENSITIVE`)
  - Build mongo-c-driver 1.29.0 from source to get a compatible libbson
  - Add error visibility for pg_documentdb build failures

- **Linux build script: fix RPATH loop with pipefail**
  - Use process substitution instead of pipe to avoid `set -eo pipefail` issues

## [0.14.16] - 2026-01-24

### Fixed

- **Linux postgresql-documentdb builds: bundle shared libraries**
  - Linux builds were missing bundled libraries (libpq, ICU, etc.) causing runtime failures
  - Added recursive library bundling using `ldd`, similar to macOS build's `otool` approach
  - Fixed RPATH for `lib/postgresql/` extensions to find parent lib directory

## [0.14.15] - 2026-01-24

### Changed

- **PostgreSQL-DocumentDB: Complete rewrite for relocatable macOS binaries**
  - Build PostgreSQL 17 from source instead of using Homebrew (fixes hardcoded `/opt/homebrew/` paths)
  - Build PostGIS from source against the source-built PostgreSQL
  - Bundle all Homebrew dependencies recursively with dylib path rewriting
  - Add macOS ad-hoc code signing for all modified binaries
  - Move old Homebrew-based build to `legacy/` directory for reference

- **PostgreSQL-DocumentDB: Mark as completed**
  - Update status from `in-progress` to `completed` in databases.json
  - All 5 platforms now available: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64

### Added

- **FerretDB support** (first release)
  - FerretDB binaries now available for all 5 platforms
  - Uses postgresql-documentdb as backend for MongoDB wire protocol compatibility
  - Platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64 (win32 limited to pgvector only)

- **Linux build script for PostgreSQL-DocumentDB** (`build-linux.sh`)
  - Docker-based extraction from FerretDB's official image
  - Applies same SQL patches as macOS build

- **Documentation: macOS source build learnings** (CLAUDE.md)
  - dylib path rewriting with `@rpath`, `@loader_path`, `install_name_tool`
  - Recursive dependency bundling process
  - Code signing requirements after binary modification

- **IN_PROGRESS.md** for persisting work-in-progress between Claude Code sessions

### Fixed

- **DocumentDB SQL patches** (applied in both macOS and Linux builds)
  - Fix `##` token concatenation operator (PostgreSQL doesn't support C preprocessor-style `##`)
  - Fix `bson_in`, `bson_out`, `bson_send`, `bson_recv` functions referencing wrong library
  - Fix `bsonquery_equal`, `bsonquery_lt`, `bsonquery_lte`, `bsonquery_gt`, `bsonquery_gte` functions referencing wrong library

- **macOS dylib bundling**
  - Resolve `@rpath/*` references by searching Homebrew locations
  - Remove Homebrew rpaths and add `@loader_path` for bundled libraries
  - Fix PostGIS `postgis.control` file creation

## [0.14.14] - 2026-01-23

### Added

- **PostgreSQL-DocumentDB Windows (win32-x64) support**
  - Added Windows to the release workflow for postgresql-documentdb
  - Downloads PostgreSQL 17 from EnterpriseDB
  - Builds pgvector using MSVC with official `Makefile.win`
  - Windows build includes pgvector only (DocumentDB, pg_cron, rum, PostGIS not available due to platform limitations)

## [0.14.13] - 2026-01-23

### Added

- **PostgreSQL-DocumentDB macOS build - Intel Decimal Math Library**
  - DocumentDB requires `bid_conf.h` from Intel's decimal floating-point library for decimal128 support
  - Build Intel RDF Math Library from source (`git.launchpad.net/ubuntu/+source/intelrdfpmath`)
  - Create `intelmathlib.pc` pkgconfig file for DocumentDB build system

### Fixed

- **PostgreSQL-DocumentDB macOS build - C11 typedef redefinition warning**
  - Apple clang treats typedef redefinition as error by default
  - Add `-Wno-error=typedef-redefinition` to suppress

## [0.14.12] - 2026-01-23

### Fixed

- **PostgreSQL-DocumentDB macOS build - libbson-static-1.0.pc not found from documentdb directory**
  - `make` runs from `documentdb/` subdirectory, breaking relative `PKG_CONFIG_PATH`
  - Convert `FAKE_PKGCONFIG_DIR` to absolute path after creation
  - Update fake pkgconfig file to use dynamically-found bson include path
  - Add `-I${includedir}/bson` to Cflags for proper header resolution

## [0.14.11] - 2026-01-23

### Fixed

- **PostgreSQL-DocumentDB macOS build - bson.h still not found with mongo-c-driver 2.x**
  - mongo-c-driver 2.x uses `bson-X.Y.Z/` include directory, not `libbson-1.0/`
  - Use `find` to dynamically locate the correct bson include directory
  - Fall back to `libbson-1.0/` for older mongo-c-driver versions

## [0.14.8] - 2026-01-23

### Fixed

- **PostgreSQL-DocumentDB macOS build - libbson-static-1.0 not found**
  - DocumentDB Makefile uses `pkg-config --cflags libbson-static-1.0`
  - Homebrew only provides dynamic libbson-1.0, not static
  - Create fake `libbson-static-1.0.pc` pkgconfig file pointing to Homebrew paths

## [0.14.7] - 2026-01-23

### Fixed

- **PostgreSQL-DocumentDB macOS build - missing headers**
  - Added `icu4c` dependency for `unicode/ures.h`
  - Set up include paths for libbson (`bson.h`) and ICU via CFLAGS/CPPFLAGS
  - Export PKG_CONFIG_PATH for proper dependency discovery

## [0.14.6] - 2026-01-23

### Fixed

- **PostgreSQL-DocumentDB macOS build fixes**
  - DocumentDB git tags use format `v0.107-0` not `v0.107.0` - added version format conversion
  - DocumentDB uses PGXS Makefiles, not CMake - replaced CMake build with `make PG_CONFIG=...`
  - Apple clang doesn't support `-fexcess-precision=standard` flag - added `-Wno-error=ignored-optimization-argument`
  - Apple clang doesn't support `-Wno-cast-function-type-strict` - added `-Wno-error=unknown-warning-option`
  - Added missing build dependencies: `pcre2`, `mongo-c-driver` (provides libbson)

### Added

- **Build macOS PostgreSQL-DocumentDB workflow** - Dedicated workflow for iterating on macOS builds

## [0.14.2] - 2026-01-23

### Fixed

- **PostgreSQL-DocumentDB Docker extraction failing on symlinks**
  - `docker cp` fails with "invalid symlink" when copying files that contain symlinks pointing outside the copied directory
  - Changed extraction to use `docker run` with a shell script that uses `cp -L` to dereference symlinks
  - Creates proper bundle structure: bin/, lib/, share/extension/

## [0.14.1] - 2026-01-23

### Fixed

- **Workflow permission for trigger-sync job** - Added `actions: write` permission to new ferretdb and postgresql-documentdb workflows to allow triggering sync-releases workflow

## [0.14.0] - 2026-01-23

### Added

- **FerretDB support** - Open-source MongoDB alternative using PostgreSQL backend
  - Downloads official binaries for Linux x64/arm64
  - Cross-compiles from source for macOS and Windows (requires Go 1.22+)
  - Bundles mongosh and MongoDB database-tools for complete MongoDB compatibility

- **PostgreSQL + DocumentDB support** - PostgreSQL with DocumentDB extension for FerretDB backend
  - Extracts from official FerretDB Docker image for Linux x64/arm64
  - Builds from source for macOS (Intel and Apple Silicon)
  - Includes bundled extensions: DocumentDB, pg_cron, pgvector, PostGIS, rum
  - Pre-configured postgresql.conf.sample with shared_preload_libraries

- **New `docker-extract` source type** in sources.schema.json for extracting binaries from Docker images

## [0.12.5] - 2026-01-20

### Fixed

- **Invalid code signatures on macOS PostgreSQL binaries**
  - `install_name_tool` invalidates existing code signatures when modifying libraries
  - macOS kills processes that load libraries with invalid signatures ("Killed: 9")
  - Added `codesign --force --sign -` step to re-sign all modified dylibs and binaries with ad-hoc signatures

## [0.12.4] - 2026-01-20

### Fixed

- **Bash 3.2 compatibility for macOS builds**
  - Removed `declare -A` (associative arrays) which requires Bash 4+
  - macOS ships with Bash 3.2; GitHub Actions macOS runners use system bash
  - Replaced with regular arrays and helper function for linear search

## [0.12.3] - 2026-01-20

### Fixed

- **Missing ICU data library in macOS PostgreSQL builds**
  - `libicudata.78.dylib` was not being bundled because ICU uses `@loader_path` references internally
  - Updated dependency scanner to resolve `@loader_path` references relative to the source library's directory
  - Updated path fixer to also rewrite `@loader_path` references to `@rpath`
  - This caused `Killed: 9` errors when running PostgreSQL binaries

## [0.12.2] - 2026-01-20

### Fixed

- **Bash syntax error in macOS PostgreSQL build**
  - Fixed `syntax error near unexpected token '2'` caused by invalid `2>/dev/null` in for loop glob
  - Added `shopt -s nullglob` to handle missing file patterns gracefully

- **GitHub Actions `env` context error in build-missing-releases workflow**
  - Fixed `Unrecognized named-value: 'env'` error in job-level `if` conditions
  - Changed `env.ACTION` to `github.event.inputs.action` (env context not available at job level)

## [0.12.1] - 2026-01-20

### Fixed

- **macOS PostgreSQL binaries now relocatable**
  - Fixed hardcoded build paths (`/Users/runner/work/...`) that caused `dyld: Library not loaded` errors
  - Fixed Homebrew dependency paths (`/opt/homebrew/opt/icu4c@78/...`) that required users to have specific Homebrew packages installed
  - Binaries now bundle all required dylibs (ICU, OpenSSL, readline, etc.) into the package
  - Uses `install_name_tool` to rewrite paths with `@executable_path/../lib/` and `@rpath/`
  - Affects all PostgreSQL binaries: `postgres`, `psql`, `initdb`, `pg_dump`, `pg_restore`, etc.
  - Verification step ensures no hardcoded paths remain before packaging

### Added

- **Rebuild macOS PostgreSQL workflow** (`.github/workflows/rebuild-macos-postgresql.yml`)
  - Rebuilds all macOS PostgreSQL binaries for all supported versions
  - Supports both darwin-x64 (Intel) and darwin-arm64 (Apple Silicon)
  - Can rebuild a single version or all versions at once

## [0.12.0] - 2026-01-20

### Added

- **Qdrant vector database support** with full 5-platform coverage
  - High-performance vector similarity search engine
  - Version: 1.16.3 (latest stable)
  - Official binaries from GitHub releases for all platforms
  - Apache-2.0 license (fully permissive for commercial use)

## [0.11.1] - 2026-01-18

### Added

- **CLI alias** `duck` → `duckdb` for convenience

### Fixed

- **DuckDB download script cross-platform compatibility**
  - `verifyCommand()` now uses `where` on Windows instead of Unix-only `which`
  - `extractZip()` now uses PowerShell `Expand-Archive` on Windows instead of requiring `unzip`
  - Binary copy now uses `copyFileSync` for idiomatic file copying with metadata preservation

- **DuckDB workflow checksum generation**
  - Fixed "Generate checksums" step to handle Windows-only, Unix-only, and mixed builds
  - Uses `shopt -s nullglob` to properly detect available archive types

## [0.11.0] - 2026-01-18

### Added

- **DuckDB support** with full 5-platform coverage
  - Fast in-process analytical database optimized for OLAP workloads
  - Version: 1.4.3 (latest stable)
  - Official binaries from GitHub releases for all platforms
  - MIT license (fully permissive for commercial use)
  - Single CLI binary (`duckdb`) - no server/client architecture needed

### Changed

- **Sources schema** updated to support `gz` format for gzip-compressed single binaries

## [0.10.1] - 2026-01-17

### Added
- **NPM publishing**
  - Added GH workflows to version checking and publishing


## [0.10.0] - 2026-01-17

### Added

- **Build missing releases workflow** (`.github/workflows/build-missing-releases.yml`)
  - Scans `databases.json` and `releases.json` to find missing releases
  - `check-only` mode reports discrepancies without building
  - `build-missing` mode triggers release workflows, waits for completion, repairs checksums, and updates `releases.json`
  - Supports filtering to a specific database

- **Shared checksums module** (`lib/checksums.ts`)
  - Extracted checksum parsing/fetching logic for reuse across scripts
  - Used by `repair-checksums.ts` and `reconcile-releases.ts`

- **CLI error messages now show available options**
  - Database not found: shows all available databases
  - Version not found: shows available versions (sorted descending)
  - Platform not found: already showed alternatives, now consistent across all commands

### Changed

- **Type consolidation in `lib/databases.ts`**
  - Added canonical type exports: `Platform`, `DatabaseEntry`, `DatabasesJson`, `PlatformAsset`, `VersionRelease`, `ReleasesJson`
  - Added `loadReleasesJson()` function
  - Scripts now import shared types instead of defining local duplicates

- **CLI refactoring** (`cli/bin.ts`)
  - `sortVersionsDesc()` is now non-mutating (uses `[...versions].sort()`)
  - Added `resolveTargetPlatform()` helper to deduplicate platform resolution logic
  - `cmdUrl` and `cmdInfo` simplified from ~40 lines to ~20 lines each

- **ClickHouse workflow simplified** (`release-clickhouse.yml`)
  - Removed dead `build-source` job (Windows experimental code)
  - Simplified prepare job outputs

### Fixed

- **Command injection vulnerability in `repair-checksums.ts`**
  - Now uses `execFileSync` with argument arrays instead of `execSync` with string interpolation
  - Added validation for `--release` tag argument (alphanumeric, dots, hyphens, underscores only)

- **Checksum repair robustness**
  - Tracks failed checksum computations and aborts upload if any fail
  - Prevents partial/corrupt checksums.txt from being uploaded

- **Signal handling in CLI launcher** (`bin/cli.js`)
  - Forwards SIGINT, SIGTERM, SIGHUP to child process
  - Properly cleans up signal handlers on exit
  - Exits with correct signal-based exit codes

## [0.9.3] - 2026-01-11

### Fixed

- **SQLite Linux binaries GLIBC compatibility**
  - Official SQLite binaries from sqlite.org require GLIBC 2.38+, breaking Ubuntu 22.04 and older
  - Both `linux-x64` and `linux-arm64` now build from source on Ubuntu 20.04
  - Binaries now require only GLIBC 2.31+ (compatible with Ubuntu 20.04+)
  - macOS and Windows continue using official binaries (unaffected by GLIBC)

### Changed

- **SQLite Dockerfile** updated to use Ubuntu 20.04 base image and support both x64/arm64
- **SQLite workflow** restructured with `build-linux` matrix job for source builds
- **SQLite build-local.sh** now supports `--platform linux-x64` in addition to `linux-arm64`

## [0.9.2] - 2026-01-11

### Added

- **Release reconciliation script** (`pnpm reconcile:releases`)
  - Validates `releases.json` against actual GitHub releases
  - Removes stale entries for releases that no longer exist (deleted binaries)
  - Supports `--dry-run` flag to preview changes without modifying
  - Handles pagination for repositories with many releases
  - Uses `GITHUB_TOKEN` env var if available to avoid rate limits

### Changed

- **`update:releases` script** now automatically runs reconciliation after appending new releases
  - Ensures `releases.json` stays in sync with GitHub even when releases are deleted

## [0.9.1] - 2026-01-11

### Added

- **MySQL 9.5.0** (Innovation release) - First MySQL 9.x version
  - Official binaries from Oracle CDN for all 5 platforms
  - Uses `macos15` (Sequoia) binaries instead of `macos14` (Sonoma)
  - Note: MySQL 9.x is an Innovation release with shorter support window (~3-6 months)
  - LTS users should continue using 8.4.x

## [0.9.0] - 2026-01-10

### Added

- **SQLite support** with full 5-platform coverage
  - Version 3.51.2 (latest stable)
  - Official binaries from `sqlite.org` for linux-x64, darwin-x64, darwin-arm64, win32-x64
  - Source build from amalgamation for linux-arm64 (no official binary available)
  - Includes sqlite3 CLI, sqldiff, sqlite3_analyzer, sqlite3_rsync
  - Public domain license (no restrictions)

- **Checksums documentation** added to CLAUDE.md
  - Most databases use SHA-256 (auto-populated via `pnpm checksums:populate`)
  - SQLite uses SHA3-256 (copied manually from vendor)
  - Guidance for handling different checksum algorithms

### Changed

- **MongoDB database-tools** updated from 100.13.0 to 100.14.0

## [0.8.0] - 2026-01-10

### Added

- **MongoDB complete bundling** - Releases now include server, shell, and database tools
  - `mongosh` (MongoDB Shell) bundled for interactive database access
  - Database tools (`mongodump`, `mongorestore`, `mongoexport`, `mongoimport`, `mongostat`, `mongotop`, `bsondump`, `mongofiles`) bundled for backup and data management
  - Component versions tracked in `sources.json` under new `components` section
  - Metadata includes component version information

- **"Complete, Embeddable Binaries" philosophy** documented in CLAUDE.md
  - Releases should be self-contained and ready to use
  - Bundle related components when vendors distribute separately
  - Include client tools alongside server binaries

### Changed

- **MongoDB download script** rewritten to download and merge three components
- **MongoDB sources.json** restructured with `components` section for shell and tools

## [0.7.0] - 2026-01-08

### Added

- **MongoDB support** with full 5-platform coverage
  - Official binaries from `fastdl.mongodb.org` CDN
  - Versions: 8.0.17 (LTS), 8.2.3 (Rapid Release), 7.0.28 (Previous LTS)
  - License warning in README about SSPL restrictions
  - FerretDB recommended as open-source alternative for commercial use

## [0.6.0] - 2026-01-07

### Added

- **Valkey support** with full 5-platform coverage
  - Linux Foundation-backed Redis fork with BSD-3-Clause license
  - Drop-in Redis replacement for commercial/closed-source projects
  - Versions: 9.0.1, 8.0.6
  - Source builds for all platforms

## [0.5.0] - 2026-01-07

### Added

- **Redis support** with full 5-platform coverage
  - Versions: 8.4.0, 7.4.7
  - Source builds for all platforms
  - License warning about RSALv2/SSPLv1 restrictions
  - Valkey recommended as open-source alternative for commercial use

## [0.4.0] - 2026-01-06

### Added

- **MariaDB support** with full 5-platform coverage
  - `builds/mariadb/download.ts` - Downloads official binaries or MariaDB4j JARs
  - `builds/mariadb/sources.json` - URL mappings for 3 LTS versions (11.8.5, 11.4.5, 10.11.15)
  - `builds/mariadb/Dockerfile` - Source builds for Linux platforms
  - `builds/mariadb/build-local.sh` - Local Docker build script
  - `.github/workflows/release-mariadb.yml` - Parallel builds across all 5 platforms
  - Native macOS builds on GitHub Actions (macos-13 for Intel, macos-14 for Apple Silicon)

## [0.3.0] - 2026-01-05

### Added

- **MySQL support** with full 5-platform coverage
  - Official binaries from Oracle CDN
  - Versions: 8.4.7, 8.0.40
  - `builds/mysql/download.ts` - Downloads and repackages official binaries
  - `builds/mysql/sources.json` - URL mappings for all versions/platforms

## [0.2.0] - 2026-01-04

### Added

- **PostgreSQL support** with full 5-platform coverage
  - Via [zonky.io embedded-postgres-binaries](https://github.com/zonkyio/embedded-postgres-binaries)
  - Versions: 18.1.0, 17.7.0, 16.11.0, 15.15.0

- **databases.json as single source of truth**
  - Workflows now validate version input against `databases.json`
  - Invalid versions fail fast with helpful error messages
  - Adding new versions no longer requires workflow file changes

- **Documentation overhaul**
  - `README.md` - Rewritten with philosophy section and automation details
  - `CLAUDE.md` - Streamlined with validation flow diagrams
  - `ARCHITECTURE.md` - Visual diagrams of system architecture
  - `CHECKLIST.md` - Step-by-step guide for adding new databases

- **Scaffolding script** (`pnpm add:engine <database>`)
  - Creates `builds/<id>/` directory with template files
  - Creates `.github/workflows/release-<id>.yml`
  - Adds `download:<id>` script to package.json

## [0.1.0] - 2026-01-03

### Changed

**Major pivot in project direction.** Originally hostdb was an npm monorepo using turborepo to publish platform-specific database packages. This approach was abandoned in favor of hosting binaries on GitHub Releases.

#### New Approach
- Download official binaries from vendor CDNs (fast, seconds not hours)
- Repackage with metadata and host on GitHub Releases
- Queryable `releases.json` manifest for consumers (like SpinDB)
- Build from source only as fallback when official binaries unavailable

### Added

- `releases.json` - Manifest of all GitHub Releases (queryable by SpinDB)
- `schemas/sources.schema.json` - Validates sources.json files
- `schemas/releases.schema.json` - Validates releases.json
- `scripts/update-releases.ts` - Updates releases.json after GitHub Release
- `status` field in `databases.json` (`completed`, `in-progress`, `pending`, `unsupported`)
- `pnpm dbs` command for listing databases
- `pnpm prep` command for pre-commit checks
- `pnpm sync:versions` command for syncing workflow dropdowns

### Removed

- Turborepo configuration
- Platform-specific npm packages
- Old package generation scripts
- pnpm workspace configuration
