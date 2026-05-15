# Engine Version Upgrade Playbook

This is the long-term operator's reference for upgrading database engine versions across the Layerbase stack (hostdb → spindb → layerbase-cloud).

The doc has two halves:
1. **Part A — Operator reminders** (for the human running the upgrade)
2. **Part B — Technical reference** (for an LLM agent or engineer who needs to understand exactly what each step does)

Last verified: 2026-05-14.

---

## Part A — Operator reminders

### A1. Mental model

You are pushing versioned binaries through a three-layer pipe:

```
hostdb (build & publish to R2)  →  spindb (resolve & download)  →  layerbase-cloud (consume)
```

- **hostdb** is a build farm. It compiles or repackages binaries and uploads them to `registry.layerbase.host`. Its output is two artifacts: the binaries themselves (one per platform per version) and a manifest `releases.json`.
- **spindb** is a CLI tool. It contains a hardcoded `version-maps.ts` per engine that maps short version inputs (`'11.8'`) to specific binary URLs (`11.8.6.tar.gz` on R2). **This is the authority that decides which patch to download.**
- **layerbase-cloud** runs a single universal Docker image with spindb pre-installed. The cloud only knows major.minor (`'11.8'`); spindb (the version baked into the image) decides the patch.

### A2. The critical insight about patch resolution

**Q: If the registry contains `3.1.0` and `3.1.1`, how does the cloud know which one to download?**

**A: It doesn't pick — spindb's hardcoded `VERSION_MAP` does.** The cloud passes `--db-version 3.1`. spindb's `engines/{engine}/version-maps.ts` has `'3.1' → '3.1.1'` (or `'3.1.0'`, whatever was written when that spindb version shipped). That mapping decides which binary URL gets built and downloaded.

R2 just hosts bytes. Even if `3.1.1` exists on R2, a spindb whose MAP still says `'3.1' → '3.1.0'` will keep downloading `3.1.0`. To make new patches actually flow to users, **all three of these must happen in order:**

1. hostdb publishes the new binary to R2 (and updates `releases.json`).
2. spindb's `version-maps.ts` is updated so `'3.1' → '3.1.1'`, then spindb is released to npm.
3. The cloud's universal Docker image is rebuilt with the new `ENV SPINDB_VERSION`.

If you skip step 2, R2 has the new patch but nobody downloads it.
If you skip step 3, the patch is downloadable by anyone running spindb locally but cloud users won't see it.

### A3. The single most common change: patch within same minor

This is the safest, lowest-risk upgrade type — and ~80% of upgrades are this shape.

| Action | Where | What |
|---|---|---|
| 1 | `hostdb/databases.yml` | Add the new version key with value `true`. Leave old versions in place. |
| 2 | `hostdb/builds/<engine>/sources.json` | Add URLs + SHA-256 for all 5 platforms. |
| 3 | `hostdb/` (repo root) | Run `pnpm prep` — regenerates databases.json, syncs workflow dropdowns, populates checksums. |
| 4 | Commit and push | Conventional commit format. **No AI attribution.** |
| 5 | GitHub Actions | `gh workflow run release-<engine>.yml --field version=<X> --field platforms=all` |
| 6 | Wait for green build | `gh run watch`. Validate: R2 has the new tarballs, `releases.json` reflects them. |
| 7 | `spindb/engines/<engine>/version-maps.ts` | Add the new full version, repoint the major and major.minor keys to it, add the identity mapping. Leave old patches present so existing containers don't break. |
| 8 | spindb | `pnpm test:unit && pnpm test:hostdb-sync` |
| 9 | spindb | Bump version (minor or patch — patch usually suffices), update CHANGELOG.md. |
| 10 | spindb | Open PR, merge to main, npm publish via OIDC. |
| 11 | layerbase-cloud | Bump `SPINDB_VERSION` in `images/Dockerfile.base`. The `build-images.yml` workflow rebuilds the universal image; `deploy.yml` then rolls servers. |

No cloud config file changes for patch-only bumps.

### A4. Things that are easy to forget

- **ClickHouse has no Windows binaries.** When updating ClickHouse, the `platforms` array in `databases.yml` lists only 4 platforms (no `win32-x64`), and `sources.json` mirrors that. Don't add a Windows entry; the workflow will fail validation.
- **MariaDB darwin-arm64** for 11.4.x pulls from MariaDB4j Maven JARs (third-party). The other platforms come from `archive.mariadb.org`. If you bump 11.4 to a version MariaDB4j hasn't packaged yet, you'll need a Docker source build for darwin-arm64.
- **PostgreSQL Windows** binaries come from EnterpriseDB. The URL includes a `fileid` that changes per release. Use `pnpm edb:fileids` to fetch current IDs from EDB's page.
- **SQLite checksums are SHA3-256**, not SHA-256. Use the `sha3_256` field in sources.json. `pnpm checksums:populate` does NOT handle SQLite — copy from sqlite.org by hand.
- **macOS dylib relocation** is automatic via `builds/common/fix-macos-dylibs.sh` for MariaDB, Redis, Valkey, CouchDB. If a new engine starts linking against Homebrew, add this step to its release workflow.
- **FerretDB v1 is intentionally kept** even though it's old (1.24.2 from May 2025). Do not deprecate v1.
- **libSQL upstream is stalled** — no release since Feb 2025. If users ask why we don't have a newer version, that's why.
- **Deprecation never deletes** existing R2 binaries. Users on a deprecated version stay functional. We just hide it from the version picker.
- **Cloud-side patch impact is zero.** When you bump 11.8.5 → 11.8.6 in hostdb + spindb, the cloud only changes when the universal image is rebuilt — and even then, no cloud config file edit is needed.

### A5. Phasing for safety

When doing a multi-engine upgrade batch (like this May 2026 sweep), do it in phases so you can roll back individual pieces:

1. **Security patches only** (additive, same minor). Lowest risk; cloud doesn't change.
2. **New minor lines** (additive, requires cloud `supportedVersions` edit). Medium risk.
3. **Major version additions and deprecations**. Highest risk — only deprecate after the new major has been in production cloud for a while.

### A6. Test gates before declaring done

- **hostdb**: `pnpm prep --check` (clean), every release workflow green, `validate-binaries.sh` passes for each archive (this runs automatically in CI).
- **spindb**: `pnpm lint && pnpm test:unit && pnpm test:hostdb-sync`. The last test fetches `releases.json` from R2 and verifies every VERSION_MAP value exists there.
- **End-to-end**: Run `spindb create test-pg --engine postgresql --db-version 18` against the new spindb build. Confirm it downloads the new patch, starts, accepts a connection.
- **Cloud canary**: After the universal image rebuild, provision a test database via the cloud API and confirm the new patch shows up in `spindb info`.

---

## Part B — Technical reference

This section is the load-bearing one. If anything here goes stale, fix it before moving on.

### B1. Authoritative file map per engine

For engine `<X>`, the files that exist and their roles:

#### hostdb (`~/dev/hostdb`)

| File | Role | Edited for |
|---|---|---|
| `databases.yml` | Source of truth for: engine metadata, versions list, platforms, cli_tools, dependencies, spindb_status. Snake_case keys. | Every version add/deprecate. |
| `databases.json` | Generated from `databases.yml` by `pnpm prep`. camelCase keys. **Do not edit by hand.** Read by spindb at runtime. | Never directly. |
| `builds/<X>/sources.json` | Per-version, per-platform binary download URLs + checksums + sourceType. | Every version add. |
| `builds/<X>/download.ts` | TypeScript that does the download/repackage work locally and in CI. | When adding new platforms or fixing repackage logic. |
| `builds/<X>/Dockerfile` | Source build for Linux when no binary is available. | When upstream changes build flags or dependencies. |
| `.github/workflows/release-<X>.yml` | Per-engine release workflow. Has a version dropdown that lists currently-supported versions. | Auto-synced by `pnpm sync:versions`. |
| `releases.json` | Manifest of what's actually on R2. Built by `build:releases` script from GitHub Releases. Published to R2. **Authoritative for "what's downloadable now".** | Rebuilt by CI after each release. |

#### spindb (`~/dev/spindb`)

| File | Role | Edited for |
|---|---|---|
| `engines/<X>/version-maps.ts` | Static MAP of major (`'11'`), major.minor (`'11.8'`), and full (`'11.8.5'`) → resolved full version. **The authority for download resolution.** | Every version add. |
| `engines/<X>/binary-urls.ts` | Builds the R2 URL using the version + platform. Calls `normalizeVersion` from the MAP. | Rarely; only when URL format changes. |
| `engines/<X>/hostdb-releases.ts` | Factory wrapper that exposes "list available versions" for the UI version picker. Fetches `databases.json` from R2 at runtime (30-second cache). Has 3-tier fallback: registry → locally-installed → static MAP. | Rarely; mostly when adding a new engine. |
| `engines/<X>/version-validator.ts` | Compatibility checks (e.g., pg_restore version vs dump version). Some hardcode versions in tests. | When validation rules change. |
| `config/engines.json` | Engine registry with `supportedVersions`, `defaultVersion`, `clientTools`. Used by the engine discovery layer. | When changing what spindb advertises as supported. |
| `config/engine-defaults.ts` | Per-engine defaults: `defaultVersion`, `latestVersion` (for display), `defaultPort`. | When changing defaults. |
| `core/hostdb-releases-factory.ts` | The factory used by `engines/<X>/hostdb-releases.ts`. Implements caching + fallback chain. | Almost never. |
| `core/hostdb-client.ts` | Network layer for fetching `databases.json` and `releases.json` from R2, with GitHub fallback (`ENABLE_GITHUB_FALLBACK`). | Almost never. |
| `core/hostdb-metadata.ts` | Reads `databases.json` for available/deprecated version queries. | Almost never. |
| `tests/integration/hostdb-sync.test.ts` | Live test: fetches `releases.json` from R2 and asserts every VERSION_MAP value exists in it. | Adding a new engine. |
| `tests/unit/<X>-version-validator.test.ts` | Unit tests with hardcoded version strings. | When changing version-validator behavior. |
| `tests/unit/engines-registry.test.ts` | Validates `config/engines.json` schema. | When changing the schema. |

#### layerbase-cloud (`~/dev/layerbase-cloud`)

| File | Role | Edited for |
|---|---|---|
| `src/config/engine-registry.ts` | Per-engine `supportedVersions` (major.minor format) and `defaultVersion`. | Adding/removing a major.minor track. **Not** for patch bumps. |
| `src/config/engines.ts` | Cloud-specific overrides (healthCheckCommand, superuser, etc.). | Adding a new engine. |
| `images/Dockerfile.base` | `ARG SPINDB_VERSION=<X.Y.Z>` — the spindb version baked into the universal image. **Bumping this is what propagates spindb changes to cloud.** | Every spindb release that needs to ship to cloud. |
| `images/Dockerfile.universal` | Builds on base, copies entrypoint scripts. Engine-version-agnostic. | When changing the image structure. |
| `images/entrypoints/<engine>.sh` | Per-engine startup script. Only `clickhouse.sh` and `cockroachdb.sh` carry a hardcoded `SPINDB_VERSION=<X.Y>` default; the rest pull engine-version from the request. | Rarely. |
| `.github/workflows/build-images.yml` | Rebuilds the universal image when `Dockerfile.*` or entrypoints change. **Does not reference engine versions.** | Almost never. |
| `.github/workflows/deploy.yml` | Pulls the rebuilt image and rolls servers. **Does not reference engine versions.** | Almost never. |

### B2. The resolution flow in code

When a `spindb create --engine mariadb --db-version 11.8` is run (whether by user CLI or by cloud entrypoint):

```
cli/commands/create.ts
  └─ resolves version = '11.8' (or defaults from engineDefaults.defaultVersion)
  └─ calls dbEngine.initDataDir(name, version, opts)

engines/mariadb/index.ts
  └─ delegates to binary manager for download

engines/mariadb/binary-manager.ts → core/base-binary-manager.ts
  └─ calls normalizeVersionFromModule('11.8')
  └─ which calls normalizeVersion from engines/mariadb/version-maps.ts
  └─ MARIADB_VERSION_MAP['11.8'] → '11.8.5' (or whatever the MAP says)

engines/mariadb/binary-urls.ts → getBinaryUrl('11.8', platform, arch)
  └─ normalizeVersion('11.8', MARIADB_VERSION_MAP) → '11.8.5'
  └─ buildHostdbUrl(Engine.MariaDB, { version: '11.8.5', ... })
  └─ returns: https://registry.layerbase.host/mariadb-11.8.5/mariadb-11.8.5-linux-x64.tar.gz

binary-manager downloads from that URL, extracts, validates.
```

**Key point:** at no step does the running code consult R2's `releases.json` to decide *which patch* to download. `releases.json` is only consulted (via `hostdb-releases-factory`) when **listing** versions for the UI picker, not when **resolving** a version to a URL.

This is why the static `VERSION_MAP` is the authority. Updating R2 with a new patch without updating spindb does nothing for download behavior.

### B3. Engine-specific quirks

| Engine | Quirk |
|---|---|
| **ClickHouse** | No Windows support. 4 platforms only. Version format is `YY.MM.X.build` (e.g., `25.12.3.21`). Use `'xy-format'` grouping in the factory (custom `getMajorVersion` to extract `25.12`). |
| **libSQL** | No Windows support. 4 platforms only. Upstream stalled since Feb 2025 — no new versions to upgrade to. |
| **FerretDB v2** | No Windows support. 4 platforms. Depends on `postgresql-documentdb`. v1 is kept for backward compatibility and supports all 5 platforms. |
| **PostgreSQL-DocumentDB** | No Windows support. 4 platforms. Backend for FerretDB v2 only. Version format is `<pg-major>-<docdb-version>` (e.g., `17-0.107.0`). |
| **PostgreSQL** | Windows binaries come from EnterpriseDB; URL has a `fileid` parameter. Use `pnpm edb:fileids` to fetch current IDs. Linux ARM64 uses Percona binaries. Other platforms source-build via Docker / native runners. |
| **MariaDB** | darwin-arm64 11.4.x pulls from MariaDB4j Maven JARs. Other lines source-build for darwin-arm64. linux-x64 + win32-x64 are direct downloads from archive.mariadb.org. |
| **MySQL** | mysqlpump was removed in 9.0. Use version-level `cli_tools` overrides in databases.yml for 9.x. |
| **SQLite** | Uses SHA3-256 checksums (`sha3_256` field), not SHA-256. `pnpm checksums:populate` doesn't auto-populate these. Vendor URL has a quirky encoding: `3.51.2` → `3510200`. |
| **DuckDB** | Single-binary engine. Embedded runtime (no server). 1.4 is now maintenance; 1.5 is the active line. |
| **TigerBeetle** | macOS uses a universal (fat) binary for both x64 and arm64. Custom binary protocol (no SQL/HTTP). |
| **TypeDB** | Server (`typedb`) and console (`typedb-console`) are separate binaries. Cloudsmith download. |
| **CockroachDB** | Single binary serves as both server and client. |
| **MongoDB** | Three components (server + shell + tools) bundled into one tarball by hostdb. Since 4.4, mongosh and database tools are distributed separately by MongoDB; hostdb glues them together. |
| **Redis / Valkey / MariaDB / CouchDB** | macOS binaries link against Homebrew dylibs at build; `builds/common/fix-macos-dylibs.sh` is run in the release workflow to bundle them with `@loader_path` rewriting. |

### B4. Test sync verification

The integration test `spindb/tests/integration/hostdb-sync.test.ts` is the canary that catches version-map drift. Run it after every version-map edit:

```bash
cd ~/dev/spindb
pnpm test:hostdb-sync
```

It fetches `releases.json` from R2 (or GitHub fallback) and asserts that every value in every engine's `VERSION_MAP` exists in the fetched releases. If hostdb has published the new binaries but spindb's MAP still references missing versions, this test fails.

Run timing: the test takes ~5 seconds (one network call + assertions).

If you push a hostdb release and run this test immediately, R2's Cloudflare cache may serve stale `releases.json` for up to a few minutes. The `--force` flag on `upload-to-r2.ts` purges the cache; the workflow runs this automatically. If you suspect cache staleness, wait 2 minutes and retry.

### B5. Rollback paths

If a new patch turns out broken in production:

| Severity | Action |
|---|---|
| **Critical, need to revert fast** | Revert spindb's `version-maps.ts` to point major.minor back to the previous patch. Re-publish spindb (patch bump). Rebuild cloud universal image. Time: ~15 minutes. |
| **Bad version we want to retire** | Mark the version `deprecated: true` in hostdb's `databases.yml`. Run `pnpm prep`, `pnpm build:releases`. Spindb picks up the deprecation at next runtime fetch. Time: ~5 minutes for the data side, several minutes for cache propagation. |
| **Binary is corrupt on R2** | Re-upload via `pnpm upload:r2 -- --tag <X-Y.Z> --force`. The `--force` flag purges Cloudflare cache. R2 retains both copies; CDN serves the new one after purge. Time: ~5 minutes. |
| **R2 region issue / total registry failure** | Spindb has `ENABLE_GITHUB_FALLBACK=true` in `core/hostdb-client.ts`. If R2 fails, spindb falls back to GitHub Releases. No action needed. |

### B6. Adding a brand-new engine

This is out of scope for a version upgrade, but the workflow is:
1. `pnpm add:engine <name>` in hostdb — scaffolds files.
2. Implement `download.ts`, fill `sources.json`, define `Dockerfile` if source-build needed.
3. Run a test release locally with `pnpm download:<name> -- --version <X>`.
4. Trigger the workflow via `gh workflow run`.
5. Once R2 has the binary, add to spindb following `~/dev/spindb/ENGINE_CHECKLIST.md` (20+ files).
6. Add to cloud's `engine-registry.ts` and `engines.ts` (`CLOUD_OVERRIDES`).

### B7. Glossary

| Term | Meaning |
|---|---|
| **R2** | Cloudflare's object storage, behind `registry.layerbase.host`. |
| **The universal image** | `ghcr.io/layerbase-llc/universal` — single Docker image used for all user containers in cloud. |
| **SPINDB_VERSION** | Env var in Dockerfile.base that pins which spindb version is in the universal image. **Not** an engine version. |
| **The MAP** | Static `VERSION_MAP` in spindb's `engines/<X>/version-maps.ts` — the authority for download resolution. |
| **databases.json** | hostdb's generated metadata file. Read by spindb at runtime for available versions / deprecation flags. |
| **releases.json** | hostdb's manifest of what's actually on R2. The canary for sync tests. |
| **VERSION_MAP drift** | Condition where spindb's MAP references a version not in R2 (or vice versa). Caught by `test:hostdb-sync`. |
| **Deprecation** | Setting `deprecated: true` in databases.yml. Hides from UI but keeps the binary available. |

---

## Part C — Maintenance ledger

When this document changes (architecture refactor, new conventions, etc.), record it here so future sessions can see what's drifted.

| Date | Change | By |
|---|---|---|
| 2026-05-14 | Initial draft. Captures state after the universal-image refactor. | initial setup |
| 2026-05-15 | Phase 1 May 2026 patch wave shipped: SQLite 3.53.1, Meilisearch 1.43.1, DuckDB 1.4.4, Redis 7.4.9, Valkey 8.0.9/9.0.4, MariaDB 10.11.16/11.4.10/11.8.6, MongoDB 7.0.34/8.0.23/8.2.9, MySQL 8.4.9, PostgreSQL 15.18/16.14/17.10/18.4. spindb 0.49.0 published; cloud universal image rebuilt; verified on staging via `SELECT version()` → `PostgreSQL 18.4`. | bob |
