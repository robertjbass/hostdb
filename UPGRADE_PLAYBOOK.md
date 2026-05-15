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

**Post-integration flow** (May 2026 onward, after `hostdb` became an npm package consumed by spindb):

| # | Where | What | Automated? |
|---|---|---|---|
| 1 | `hostdb/databases.yml` | Add the new version key with value `true`. Leave old versions in place. If this version should be the new patch for its major in the `defaults` block, update it there too. | manual |
| 2 | `hostdb/builds/<engine>/sources.json` | Add URLs + SHA-256 for all 5 platforms. | manual |
| 3 | `hostdb/` (repo root) | `pnpm prep` — regenerates databases.json, syncs workflow dropdowns, populates checksums. | manual |
| 4 | `hostdb/package.json` | **Bump patch version** (e.g., 0.30.0 → 0.30.1). Without this, the `publish.yml` workflow's version check fails and no npm publish happens. | manual |
| 5 | Commit + push to a feature branch on hostdb | Conventional commit. No AI attribution. | manual |
| 6 | GitHub Actions on hostdb | `gh workflow run release-<engine>.yml --field version=<X> --field platforms=all`. The release workflow uploads to R2, mirrors GitHub Releases, regenerates `releases.json`. | auto once triggered |
| 7 | Merge hostdb feature → dev → main | `publish.yml` fires on push to main: regenerates releases.json one more time, runs all 167 tests + defaults-sync gate, then `npm publish` via OIDC. | auto |
| 8 | Verify npm | `npm view hostdb version` shows the new version. | manual check |
| 9 | `spindb/package.json` | **Exact-pin bump:** change `"hostdb": "0.30.0"` → `"hostdb": "0.30.1"` (no caret, no tilde). | manual |
| 10 | spindb | `pnpm install && pnpm test:hostdb-sync && pnpm test:unit && pnpm test:cli` — should be all-green. The wrappers in `engines/<engine>/version-maps.ts` auto-rebuild from the new hostdb snapshot; **no manual MAP edits.** | manual run, auto checks |
| 11 | spindb | Bump spindb's own version + CHANGELOG.md note. | manual |
| 12 | Merge spindb feature → dev → main | spindb's own publish workflow fires. | auto |
| 13 | layerbase-cloud | Bump `SPINDB_VERSION` in `images/Dockerfile.base`. `build-images.yml` rebuilds the universal image; `deploy.yml` rolls servers. | manual edit, auto deploy |
| 14 | layerbase-desktop | Bump `spindb` in `package.json` (also an exact pin). Next desktop release ships the new spindb to end users. | manual edit, auto release |

**Critical ordering**: steps 1–8 must complete BEFORE step 9. If you bump spindb's hostdb pin to a version that isn't yet on npm, `pnpm install` fails on spindb's CI.

No cloud config file changes for patch-only bumps. No spindb code changes for patch-only bumps — only the dep pin.

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

- **hostdb**: `pnpm prep --check` (clean), every release workflow green, `validate-binaries.sh` passes for each archive (CI), the publish workflow's `git diff --exit-code releases.json` drift gate passes, all 167 unit tests + defaults-sync + api-shape tests pass.
- **hostdb CI smoke**: `.github/workflows/ci.yml` packs the tarball and installs it under BOTH `npm` and `pnpm` into a clean dir, then runs 10 public-API smoke checks. Catches "tests green but tarball broken" failures (missing files, wrong exports path, etc.).
- **spindb**: `pnpm lint && pnpm test:unit && pnpm test:hostdb-sync`. After the npm-package integration: `test:hostdb-sync` verifies the *bundled* hostdb snapshot agrees with the *live* R2 registry — catches a stale hostdb pin or a publish ordering mistake.
- **End-to-end**: Run `spindb create test-pg --engine postgresql --db-version 18` against the new spindb build. Confirm it downloads the new patch, starts, accepts a connection. With eager version resolution (A9), `cat ~/.spindb/containers/postgresql/test-pg/container.json` should show `"version": "<full version>"`, never shorthand.
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
| `package.json` | **Exact-pin** of the `hostdb` npm dep (`"hostdb": "0.31.0"` — no caret, no tilde). Bumping this is how new database versions reach spindb. | Every version add (just the pin bump). |
| `engines/<X>/version-maps.ts` | **Thin wrapper** over the `hostdb` package. `<ENGINE>_VERSION_MAP` and `SUPPORTED_MAJOR_VERSIONS` are built at module-load time by calling `hostdb.resolveVersion`, `getSupportedMajorVersions`, and `listVersions`. **Do not edit by hand** — the wrapper rebuilds from hostdb's snapshot automatically. | Almost never; only if the legacy export shape needs new fields. |
| `engines/<X>/binary-urls.ts` | Builds the R2 URL using the version + platform. Calls the wrapper's `normalizeVersion`. | Rarely; only when URL format changes. |
| `engines/<X>/hostdb-releases.ts` | Factory wrapper that exposes "list available versions" for the UI version picker. Reads from the bundled hostdb snapshot via `core/hostdb-metadata.ts`. | Rarely; mostly when adding a new engine. |
| `engines/<X>/version-validator.ts` | Compatibility checks (e.g., pg_restore version vs dump version). Some hardcode versions in tests. | When validation rules change. |
| `config/engines.json` | Engine registry with stable engine-shape metadata: `displayName`, `clientTools`, `connectionScheme`, etc. **No version data** (removed in A13 because it duplicated hostdb). | When changing engine metadata. |
| `config/engine-defaults.ts` | Per-engine **major-level policy**: `defaultVersion` (which major to default to — e.g., MySQL `'8.4'` for LTS), `defaultPort`, port range, etc. The major → full version resolution happens via hostdb at create time. | When changing defaults policy. |
| `core/hostdb-metadata.ts` | Reads `databases.json` / `downloads.json` from the bundled `hostdb` package (no runtime network call); 5-min network fallback only on a corrupt install. | Almost never. |
| `core/hostdb-client.ts` | Network layer for the **binary downloads** themselves (R2 URLs + GitHub fallback via `ENABLE_GITHUB_FALLBACK`). Registry metadata reads no longer hit the network — see `hostdb-metadata.ts`. | Almost never. |
| `tests/integration/hostdb-sync.test.ts` | Drift gate: fetches the LIVE `releases.json` from R2 and asserts every value in the bundled snapshot exists there. Catches stale `hostdb` pins. | Adding a new engine. |
| `tests/unit/<X>-version-validator.test.ts` | Unit tests with hardcoded version strings. | When changing version-validator behavior. |

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
  └─ resolves version = '11.8' (or defaults from engineDefaults.defaultVersion = '11.8')
  └─ EAGER RESOLUTION (A9): dbEngine.resolveFullVersion('11.8') → '11.8.6'
  └─ container.json now stores 'version': '11.8.6'
  └─ calls dbEngine.initDataDir(name, '11.8.6', opts)

engines/mariadb/index.ts
  └─ delegates to binary manager for download

engines/mariadb/binary-manager.ts → core/base-binary-manager.ts
  └─ getFullVersion('11.8.6') → normalizeVersion → '11.8.6' (identity match)

engines/mariadb/version-maps.ts (thin wrapper)
  └─ hostdb.resolveVersion('mariadb', '11.8.6') → '11.8.6' (identity)

engines/mariadb/binary-urls.ts → getBinaryUrl('11.8.6', platform, arch)
  └─ buildHostdbUrl(Engine.MariaDB, { version: '11.8.6', ... })
  └─ returns: https://registry.layerbase.host/mariadb-11.8.6/mariadb-11.8.6-linux-x64.tar.gz

binary-manager downloads from that URL, extracts, validates.
```

**Key points:**
- The resolver authority is **hostdb's bundled snapshot** (databases.json + the `defaults` block), accessed via the thin wrapper in `engines/<X>/version-maps.ts`. The snapshot is pinned per-spindb-release.
- Container configs persist **full versions** (`'11.8.6'`), not shorthand (`'11.8'`). A future spindb upgrade with a different hostdb pin won't move the container onto a different patch — the container is self-pinning.
- R2's `releases.json` is consulted for the URL/sha256/size, but **not** for "which patch should '11.8' resolve to?" — that decision is frozen into the published `hostdb` tarball.

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
