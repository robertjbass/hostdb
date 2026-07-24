> ⚠️ **THIS IS A COPY. Do not edit here.**
> The canonical, authoritative version lives in **the cloud repo** at
> `~/dev/layerbase-cloud/deploy/ENGINE-VERSION-UPDATE-RUNBOOK.md` (layerbase-cloud is the
> ecosystem doc source of truth). **This copy may be outdated.** Read and edit the cloud
> version; re-stamp this file from it after changes.
> _Stamped: 2026-07-24._

---

# Engine Version Update Runbook

This documents the full cascade for updating a database engine version across the whole Layerbase stack, end to end:

```
hostdb  ->  spindb  ->  layerbase-cloud  ->  layerbase-desktop  ->  layerbase (web app)
(build)     (resolve)   (universal image)    (bundled pin)          (version picker + dashboard)
```

Older, narrower references still exist and remain accurate for their slice: cloud `CLAUDE.md` "Bumping SpinDB" and "Engine Version Sync (Critical)"; the archived point-in-time cascade at `layerbase-cloud/plans/completed/2026-05-15-spindb-hostdb-cascade-runbook.md`. The cloud runbook supersedes and unifies them.

**Last verified:** 2026-07-24.
**Current pins at last verify:** hostdb `0.35.1` (npm) · spindb `0.62.1` (npm) · cloud `images/Dockerfile.base` `SPINDB_VERSION=0.62.0` · desktop `package.json` `spindb 0.62.0`.

Two version concepts get conflated; keep them separate:

- **The spindb tool version** (the CLI that manages engines): baked into the cloud universal image, bundled into the desktop app.
- **The database engine version** (e.g. DuckDB 1.5.5): defined in the cloud engine registry, resolved to a full patch by spindb, displayed by the web app.

A patch-only engine bump touches all five repos but changes no cloud/web config file except the spindb pin. A new major.minor line additionally edits the cloud engine registry. A sunset additionally edits two `LEGACY_CREATE_VERSIONS` lists.

---

## Part 0 - Mental model

You are pushing versioned binaries through a five-layer pipe:

- **hostdb** is a build farm. It compiles/repackages binaries, uploads to `registry.layerbase.host` (Cloudflare R2), and emits a manifest `releases.json`. Its npm package carries a bundled metadata snapshot.
- **spindb** is a CLI. It exact-pins the `hostdb` npm package; its `engines/<X>/version-maps.ts` are thin wrappers that resolve a short version (`1.5`) to a full patch (`1.5.5`) from that pinned snapshot. **spindb decides which patch downloads**, not R2.
- **layerbase-cloud** runs one universal Docker image with spindb pre-installed. The cloud passes major.minor; the image's spindb resolves the patch. `images/Dockerfile.base` `ARG SPINDB_VERSION` is the pin.
- **layerbase-desktop** bundles spindb as an `extraResource` in the Electron build via `prepare:spindb`. Its `package.json` pin is independent of cloud's.
- **layerbase (web app)** never runs spindb. It pulls the cloud engine registry via `pnpm sync:engines` into `lib/generated/engine-registry.ts` for the create picker, and mirrors each running DB's `version` (from the cloud API) into Payload's `engineVersion` for the dashboard.

**The critical ordering insight:** R2 hosting a new patch is not enough. For a new patch to reach cloud/desktop/web users, three things must happen in order: (1) hostdb publishes the binary + bumps its npm package, (2) spindb bumps its `hostdb` pin and re-publishes, (3) the consuming repo bumps its spindb pin. Skip (2) and R2 has the binary but nobody downloads it. Skip (3) and only local spindb users see it.

---

## Part A - Operator quick reference (the full ordered cascade)

Every hop uses the same branching model: **feature -> dev -> main**, tests green before each promotion, merge to `main` triggers the publish/deploy. Never bump a downstream pin to a version not yet published upstream (CI goes red on install).

| # | Repo | Action | Auto? |
|---|------|--------|-------|
| 1 | hostdb | `databases.yml`: add the version key. If it should be the default patch for its major, update the `defaults` block too. | manual |
| 2 | hostdb | `builds/<engine>/sources.json`: add URLs + checksums for all platforms (mind per-engine platform/checksum quirks, Part D). | manual |
| 3 | hostdb | `pnpm prep`: regenerates `databases.json`, syncs workflow dropdowns, populates checksums. | manual |
| 4 | hostdb | **Bump `package.json` patch** + add `CHANGELOG.md` entry. Without the bump, `publish.yml` version-check fails. | manual |
| 5 | hostdb | Commit to a feature branch (conventional commit, no AI attribution). | manual |
| 6 | hostdb | `gh workflow run release-<engine>.yml --field version=<X> --field platforms=all` -> uploads to R2, mirrors GitHub Releases, rebuilds `releases.json`. | auto once fired |
| 7 | hostdb | Merge feature -> dev -> main (all tests + `releases.json` drift gate + defaults-sync green). `publish.yml` publishes to npm via OIDC on push to main. | auto |
| 8 | verify | `npm view hostdb version` shows the new version. **Gate for step 9.** | manual |
| 9 | spindb | `package.json`: exact-pin `"hostdb": "<new>"` (no caret/tilde). | manual |
| 10 | spindb | `pnpm install && pnpm test:hostdb-sync && pnpm test:unit && pnpm test:cli` all green. Version-maps auto-rebuild; **no manual MAP edits.** | manual run |
| 11 | spindb | Bump spindb's own version + `CHANGELOG.md` entry. Run `pnpm prep` to regenerate `config/version.ts`. | manual |
| 12 | spindb | Merge feature -> dev -> main (green CI). Merge to main auto-publishes to npm. | auto |
| 13 | verify | `npm view spindb version` shows the new version. **Gate for steps 14 + 16.** | manual |
| 14 | cloud | **New major.minor only:** add it to `supportedVersions`/`defaultVersion` in `src/config/engine-registry.ts` and keep the three-file sync (Part D). Patch-only: skip. | manual |
| 15 | cloud | Bump `ARG SPINDB_VERSION` in `images/Dockerfile.base`. Merge feature -> dev (staging image `:staging`) -> main (prod image `:latest`). `build-images.yml` rebuilds the universal image; `deploy.yml` pre-pulls to servers. | manual edit, auto deploy |
| 16 | cloud | **Roll the fleet:** containers converge lazily (any locked op recreates) or via the daily `cron-image-rollout-sweep` (05:00 UTC). Fire `POST /v1/internal/image-rollout-sweep` from Actions for faster convergence. | auto / manual nudge |
| 17 | desktop | Bump `spindb` pin in `package.json` + `CHANGELOG.md` (a dep bump is a patch per desktop policy; the `version-check` job blocks a `dev -> main` PR whose version equals main). Merge feature -> dev -> main; `release.yml` ships to end users. | manual edit, auto release |
| 18 | web | `pnpm sync:engines` regenerates `lib/generated/engine-registry.ts` from the cloud API (default `cloud.layerbase.dev`). Commit the regenerated file. Merge feature -> dev -> main. | manual |
| 19 | sunset (optional) | If this bump retires an older version for **new** creation, run the Version Sunsetting Ceremony (Part B) in the same web + cloud PRs. | manual |
| 20 | confirm | Run the Playwright staging confirmation (Part E) against `dev.cloud.layerbase.com`. | manual |

**Patch-only bumps** (e.g. 1.5.4 -> 1.5.5 within the same major.minor) skip steps 14 and usually 19: no cloud registry edit, no spindb code change, just the pins flowing through.

---

## Part B - Version sunsetting ceremony

Goal: an older engine version stays fully usable for databases already running on it, but is no longer offered when creating a **new** database. This is a data edit against already-built plumbing, not new code.

The mechanism is a two-field split, mirrored in cloud and web:

- **cloud** `src/config/engines.ts`: `supportedVersions` (API accepts these for existing DBs on start/restart/restore/backup/deploy) vs `creatableVersions` (= `supportedVersions` minus `LEGACY_CREATE_VERSIONS`). `handleCreate` / `handleCreateStack` validate against `creatableVersions`, so a sunset version is rejected at create time while existing DBs keep running (`src/api/databases/create.ts`, `src/api/stacks.ts`).
- **web** `lib/cloud/types.ts`: `supportedVersions` vs `offeredVersions` (the picker), same `LEGACY_CREATE_VERSIONS` map. The web gate hides it from the picker; the cloud gate is the real security boundary so a direct API call can't bypass it.

To sunset version `V` of engine `E`:

1. **Keep `V` in `supportedVersions`** (both `src/config/engine-registry.ts` cloud-side and the synced web registry). Removing it would break existing databases. Never remove a version that any live DB runs on.
2. **cloud** `src/config/engines.ts`: add `E: ['...existing', 'V']` to `LEGACY_CREATE_VERSIONS`. `creatableVersions` is computed as the difference (with a safety fallback to `supportedVersions` if the filter would empty the list).
3. **web** `lib/cloud/types.ts`: add the identical entry to its `LEGACY_CREATE_VERSIONS`. The comment in each file references the other; keep them byte-identical.
4. There is **no CI drift check** tying these two lists together (`check-engine-drift.ts` covers engine identity/slugs only, not versions). Edit both in the same change and eyeball them.
5. Deprecating an entire engine (not one version) is a different lever: `EngineStatus.Deprecated` in web `lib/engines.ts`. Do not confuse the two.
6. hostdb never deletes the R2 binary for a sunset version. Existing installs and restores keep resolving it.

The only currently sunset example is TypeDB (`typedb: ['3.8', '3.11']`, new DBs must be 3.12). Follow that pattern.

---

## Part C - Per-repo file map

### hostdb (`~/dev/hostdb`)
- `databases.yml` - source of truth for versions/platforms/defaults (snake_case). Edit per version.
- `databases.json` - generated by `pnpm prep`. Do not hand-edit.
- `builds/<X>/sources.json` - per-version, per-platform URLs + checksums.
- `.github/workflows/release-<X>.yml` - per-engine release workflow (version dropdown auto-synced by `pnpm sync:versions`).
- `releases.json` - manifest of what is actually on R2. Authoritative for "downloadable now"; the drift-test canary.
- `package.json` - the hostdb npm version consumers pin. Patch bump per version wave.

### spindb (`~/dev/spindb`)
- `package.json` - **exact pin** of the `hostdb` dep. Bumping this is how new versions reach spindb.
- `engines/<X>/version-maps.ts` - thin wrappers over the hostdb snapshot. **Do not hand-edit.**
- `config/version.ts` - generated by `pnpm prep`; regenerate before publishing.
- `tests/integration/hostdb-sync.test.ts` - drift gate vs live R2 `releases.json`.
- `CHANGELOG.md` - required entry per published version.

### layerbase-cloud (`~/dev/layerbase-cloud`)
- `src/config/engine-registry.ts` - per-engine `supportedVersions` + `defaultVersion` (major.minor). Edit when adding/removing a major.minor track, not for patch bumps.
- `src/config/engines.ts` - `CLOUD_OVERRIDES`, the `LEGACY_CREATE_VERSIONS` sunset map, and the `CloudEngineConfig` build (computes `creatableVersions`).
- `images/Dockerfile.base` - `ARG SPINDB_VERSION` (installed via `npm install -g spindb@${SPINDB_VERSION}`; **never** set it in `deploy/setup.sh` or `.env*`). Single source of truth for the image's spindb.
- `.github/workflows/build-images.yml` - rebuilds the universal image (`:latest` on main, `:staging` on dev).
- `.github/workflows/deploy.yml` - pulls the rebuilt image, rolls servers.

**Engine Version Sync (three-file rule):** cloud `CLAUDE.md` states `src/config/engines.ts` + `build-images.yml` (matrix `versions`) + `deploy.yml` (`IMAGES` list) must list the same major.minor tags. Caveat to verify before relying on it: the architecture moved toward a single universal image that downloads engine binaries on demand (`images/Dockerfile.universal`, `docs/SPEC-remove-legacy-per-engine-images.md`), which may make the per-engine-tag matrix legacy. Confirm current pipeline shape (tracker C-005) when editing image workflows.

### layerbase-desktop (`~/dev/layerbase-desktop`)
- `package.json` - `spindb` pin (independent of cloud).
- `scripts/prepare-spindb.mjs` - bundles spindb `dist/` into `build/spindb/`. Runs before `electron-builder` (hard rule; else the packaged app ships an empty `resources/spindb/`).
- `CHANGELOG.md` - required; `version-check` job blocks a `dev -> main` PR whose version equals main.

### layerbase (web app, `~/dev/layerbase`)
- `lib/generated/engine-registry.ts` - **auto-generated** by `pnpm sync:engines` (one-way pull from the cloud API). Carries `defaultVersion` / `supportedVersions` / `prereleaseVersions`. Do not hand-edit.
- `lib/cloud/types.ts` - `CLOUD_ENGINE_CONFIGS`, `LEGACY_CREATE_VERSIONS`, `supportedVersions` vs `offeredVersions` (the create-gate).
- `lib/engines.ts` - merges the generated registry with UI-only overrides; `EngineStatus.Deprecated` (whole-engine).
- `components/cloud/create-database-form.tsx` - the version picker (reads `offeredVersions`).
- `components/cloud/database-detail.tsx` - dashboard version display (`database.version`, mirrored to Payload `engineVersion`).
- `scripts/check-engine-drift.ts` - guards engine **identity/slugs** across web + cloud. Does **not** check versions.

---

## Part D - Test gates, branching, and easy-to-forget items

**Branching (all repos):** feature branches cut off `dev`; merge feature -> `dev`, then a `dev -> main` release PR. Never direct-to-main. Never squash (cloud uses plain merge commits). Do not promote with failing CI. Merge to `main` triggers publish (hostdb/spindb/web npm or Vercel), image build (cloud), or release (desktop).

**Test gates before declaring a hop done:**
- hostdb: `pnpm prep --check` clean, every release workflow green, `git diff --exit-code releases.json` drift gate, full unit suite + defaults-sync + api-shape, tarball smoke-install under npm and pnpm.
- spindb: `pnpm lint && pnpm test:unit && pnpm test:hostdb-sync && pnpm test:cli`. `test:hostdb-sync` catches a stale hostdb pin or a publish-ordering mistake.
- cloud: `pnpm format && pnpm lint && pnpm test` green + staging deploy/smoke + `dev.cloud.layerbase.dev/health` OK. A failed universal image build produces NO prod deploy.
- desktop: `validate` (format/type/build) + `version-check` (version bumped vs main).
- web: `pnpm check` (lint + types), and confirm `check-engine-drift.ts` still passes after the registry regenerate.

**Easy to forget (per-engine, from hostdb):**
- ClickHouse, libSQL, FerretDB v2, PostgreSQL-DocumentDB: **no Windows binaries** (4 platforms).
- SQLite: **SHA3-256** checksums (`sha3_256`), not SHA-256; `pnpm checksums:populate` does not handle it.
- PostgreSQL Windows: EnterpriseDB URLs carry a per-release `fileid`; `pnpm edb:fileids` fetches them.
- MariaDB darwin-arm64 (11.4.x): MariaDB4j Maven JARs; source-build if not yet packaged.
- FerretDB v1: intentionally kept; do not deprecate.
- libSQL: upstream stalled since Feb 2025; no newer version to move to.
- macOS dylib relocation is automatic via `builds/common/fix-macos-dylibs.sh` for MariaDB/Redis/Valkey/CouchDB.

---

## Part E - Playwright staging confirmation gate

After the cascade reaches staging (cloud `:staging` image rebuilt, web on `dev`), confirm the version actually flows and any sunset version is gone, on **`dev.cloud.layerbase.com`**.

Environment notes:
- Staging is `dev.cloud.layerbase.com`. Vercel Deployment Protection is ON for preview/staging; browse with Bob's Vercel login or the automation bypass header/param.
- The **staging devlogin account provisions no cloud user** - it cannot create a cloud DB. Use the provisioned staging session (`robertjbass4`, a regular non-admin user) so the create actually hits the cloud API.

Confirmation checklist (drive with a Playwright agent):
1. Sign in as the provisioned staging user; go to `/cloud/create`.
2. Select the engine. In the **Version** picker, assert the **new** version is present and is the default (or selectable), and that any **sunset** version is **absent** from the picker.
3. Create a database on the new version. Wait for `running`.
4. Open the database detail page; assert the dashboard shows `<Engine> <new version>` (the `database.version` from the cloud API).
5. (Sunset case) Confirm an **existing** database still on the sunset version continues to display and connect, i.e. it was not broken by the create-gate. If none exists on staging, note that the create-gate is what was verified and the existing-DB path is covered by the cloud comment/tests.
6. Optionally hit the cloud API create endpoint directly with the sunset version and assert it is rejected (`creatableVersions` gate), proving the picker is not the only guard.

Record the outcome (version string observed, screenshots) and, if green, note it in the maintenance ledger below.

---

## Part F - Rollback

| Severity | Action | Time |
|---|---|---|
| Critical, revert fast | Revert the spindb pin bump (cloud `Dockerfile.base` and/or desktop `package.json`) to the previous spindb; rebuild image / re-release. For a bad patch, revert spindb's version-maps to the prior patch, patch-publish spindb, then bump cloud. | ~15 min |
| Retire a bad version | hostdb: `deprecated: true` in `databases.yml`, `pnpm prep`, `pnpm build:releases`. spindb picks it up at next runtime fetch. For create-gating, prefer the sunset ceremony (Part B). | ~5 min data + cache |
| Corrupt R2 binary | `pnpm upload:r2 -- --tag <X-Y.Z> --force` (purges Cloudflare cache; R2 keeps both copies). | ~5 min |
| R2 / registry outage | spindb has `ENABLE_GITHUB_FALLBACK=true` in `core/hostdb-client.ts`; falls back to GitHub Releases. No action. | n/a |

---

## Part G - Worked example: "update DuckDB to 1.5.5"

Reality check first: DuckDB is pinned at `1.4` everywhere today (cloud registry `supportedVersions: ['1.4']`); there is no 1.5 in the system. So this starts at hostdb step 1.

1-8. hostdb: add `1.5.5` to `databases.yml` (DuckDB is a single-binary embedded engine, no server), URLs + checksums in `builds/duckdb/sources.json`, `pnpm prep`, patch-bump hostdb + CHANGELOG, run `release-duckdb.yml`, merge to main, verify `npm view hostdb version`.
9-13. spindb: exact-pin the new hostdb, `pnpm test:hostdb-sync`/`unit`/`cli`, bump spindb + CHANGELOG, `pnpm prep`, merge to main, verify `npm view spindb version`.
14. cloud: this IS a new major.minor line, so add `1.5` to DuckDB's `supportedVersions` in `src/config/engine-registry.ts` (and set `defaultVersion` to `1.5` if it should be the new default); keep the three-file sync.
15-16. cloud: bump `SPINDB_VERSION` in `Dockerfile.base`, merge feature -> dev -> main, let `build-images.yml`/`deploy.yml` roll, nudge the rollout sweep.
17. desktop: bump the spindb pin + CHANGELOG, release.
18. web: `pnpm sync:engines` (regenerates `lib/generated/engine-registry.ts` so DuckDB shows 1.5), commit, ship.
19. sunset (if 1.4 should be retired for new creation while existing 1.4 DBs keep running): add `duckdb: ['1.4']` to `LEGACY_CREATE_VERSIONS` in **both** cloud `src/config/engines.ts` and web `lib/cloud/types.ts`; keep `1.4` in `supportedVersions`.
20. confirm: Playwright on `dev.cloud.layerbase.com` (Part E) - new DuckDB DB creates as 1.5.5, picker no longer offers 1.4, an existing 1.4 DB is untouched.

---

## Maintenance ledger

| Date | Change | By |
|---|---|---|
| 2026-07-24 | Canonical runbook authored in layerbase-cloud (`deploy/ENGINE-VERSION-UPDATE-RUNBOOK.md`), unifying and superseding the former hostdb-owned playbook. Adds the web-app hop (`pnpm sync:engines`) and the formal Version Sunsetting Ceremony (Part B) plus the Playwright staging gate (Part E). This hostdb file is now a stamped copy of that source. | bob |
