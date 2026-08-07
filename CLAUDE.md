# hostdb

Pre-built database binaries for all major platforms, hosted on Cloudflare R2 via `registry.layerbase.host`. Also a typed npm package (`hostdb`) that bundles a snapshot of the registry so consumers can resolve versions and download URLs offline.

**Primary consumer:** [spindb](https://github.com/robertjbass/spindb) — CLI tool for spinning up local database instances. Pins `hostdb` exactly and consumes the bundled snapshot.

## Ecosystem

- **hostdb** (this repo) — builds + publishes database binaries to R2; publishes an npm package with the registry snapshot.
- **spindb** (`~/dev/spindb`) — CLI tool. Downloads hostdb binaries on demand. Pins `hostdb` exactly.
- **layerbase-cloud** (`~/dev/layerbase-cloud`) — universal Docker image at `ghcr.io/layerbase-llc/` that runs spindb to fetch binaries on demand.
- **layerbase-desktop** (`~/dev/layerbase-desktop`) — Electron GUI over spindb.
- **layerbase** (`~/dev/layerbase`) — web app at layerbase.com.

**Ecosystem docs:** `~/dev/layerbase-cloud/` — shared architecture, cross-project rules, infrastructure inventory.
**Ecosystem invariants:** `~/dev/layerbase-cloud/INVARIANTS.md` — non-negotiable rules. Read before architectural changes.

## Read Before You Edit

| Doc | When you need it |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Visual data flow, R2 hosting, npm package structure, Cloudflare secret setup |
| [`UPGRADE_PLAYBOOK.md`](./UPGRADE_PLAYBOOK.md) | Long-form playbook for upgrading engine versions across the stack |
| [`CHECKLIST.md`](./CHECKLIST.md) | Adding a new database engine, step-by-step |
| [`BINARIES.md`](./BINARIES.md) | Archive structure reference (top-level dirs, binary locations) |
| [`WINDOWS_BUILD.md`](./WINDOWS_BUILD.md) | Windows build strategies (Cygwin, MSYS2, cross-compile) |
| [`builds/common/README.md`](./builds/common/README.md) | Shared build scripts + macOS SDK / dylib reference |
| [`builds/postgresql-documentdb/README.md`](./builds/postgresql-documentdb/README.md) | Reference implementation of a macOS source build with relocatable dylibs |
| [`UPGRADE_VERSIONS.md`](./UPGRADE_VERSIONS.md) | Current upgrade backlog, organized by priority tier |
| [`PROSPECTS.md`](./PROSPECTS.md) | Planned and unsupported databases |
| [`MINIMAL_BINARIES.md`](./MINIMAL_BINARIES.md) | Which binaries are minimal (MySQL linux-x64), vendor-minimal availability, how to extend to other platforms, and known non-uniformities |
| [`REPLACE_BINARY_PLAYBOOK.md`](./REPLACE_BINARY_PLAYBOOK.md) | Replacing an already-published binary on R2 in place (backup -> overwrite -> purge), rollback, and the cascade |

## Sources of Truth

| File | Schema | Purpose |
|---|---|---|
| `databases.yml` | (hand-edited) | **Edit this.** Engines, versions, platforms, `defaults` blocks, `cli_tools`. `pnpm prep` regenerates `databases.json`. |
| `databases.json` | `schemas/databases.schema.json` | Generated. Drives all workflow validation. |
| `builds/<engine>/sources.json` | `schemas/sources.schema.json` | Download URLs per version/platform. |
| `releases.json` | `schemas/releases.schema.json` | Generated from GitHub releases. Bundled in the npm package as the queryable manifest. |

**`databases.yml` uses snake_case keys** (`display_name`, `cli_tools`, `spindb_status`) — `pnpm prep` converts them to camelCase in `databases.json`.

**If you change the shape of any of these files, update the schema in the same commit.**

## Versioning & Changelog

hostdb is **published to npm as `hostdb`** via `.github/workflows/publish.yml` on merge to main. Every spindb / layerbase-cloud release pins an exact hostdb version, so every `package.json` bump matters.

- **New database engine** → bump **minor** (0.8.0 → 0.9.0). CHANGELOG entry required.
- **New version of an existing database** (patch wave, security fix) → bump **patch** (0.30.0 → 0.30.1).
- **`defaults` block policy change** (e.g., MongoDB '8' rolls from 8.0 LTS to 8.2) → bump **minor at least** even though the schema didn't change. The behavior change is user-visible; write a CHANGELOG entry explaining the LTS-vs-latest shift.

## Coordination Rules — Do Not Break

Captured in the repo (not just personal memory) so they're accessible from any machine. Violating any of these breaks downstream builds or silently changes user behavior.

### Publish cascade order (database-version patch wave)

1. Edit `databases.yml` (+ `defaults` block if needed) and `builds/<engine>/sources.json`. Bump `package.json` patch.
2. Commit + push hostdb branch. Run the engine release workflow. Merge to main. `publish.yml` fires → npm publish via OIDC.
3. **Verify** `npm view hostdb version` shows the new version before touching anything downstream.
4. Bump `"hostdb": "X.Y.Z"` in `spindb/package.json` (exact pin). Tests, version bump, merge.
5. Bump `SPINDB_VERSION` in `layerbase-cloud/images/Dockerfile.base`. Image build + deploy fires.
6. Bump `"spindb": "X.Y.Z"` in `layerbase-desktop/package.json`. Next desktop release ships it.

If you bump step 5 before step 3 completes, `npm install -g spindb@X.Y.Z` in the Dockerfile fails — the image build goes red.

See `UPGRADE_PLAYBOOK.md` for the long-form playbook (mental model, why each step exists, troubleshooting).

### Spindb pins hostdb exactly

`"hostdb": "0.31.0"`, never `^0.31.0` or `~0.31.0`. A hostdb patch can add new database versions; with a caret, an end-user installing an old spindb would pick up versions spindb's tests never validated against. Lockfiles enforce this for CI/dev but lockfiles aren't published to npm — `package.json` is the contract for end-user installs.

### Wrappers, not maps

`spindb/engines/<X>/version-maps.ts` are thin wrappers over the `hostdb` package. They auto-rebuild MAP + SUPPORTED_MAJOR_VERSIONS from hostdb's bundled snapshot at module-load time. **Do not hand-edit MAP entries.** To add a new database version: update hostdb, publish, bump spindb's hostdb pin. The wrapper picks it up automatically.

### `defaults` block changes are user-visible

Every engine in `databases.yml` has a `defaults` block mapping 1-part major versions to the full version the resolver should return:

```yaml
mongodb:
  defaults:
    '7': 7.0.34
    '8': 8.0.23    # LTS pick — NOT 8.2.x (the highest)
```

Without the defaults block, `resolveVersion('mongodb', '8')` would prefix-match to `'8.2.9'` (highest), which contradicts MongoDB's LTS guidance. **The block IS the policy declaration. Always write a CHANGELOG entry when changing a `defaults` value — it's policy, not data.**

### `SUPPORTED_MAJOR_VERSIONS` format divergence is intentional

Five engines (MongoDB, MySQL, MariaDB, ClickHouse, TigerBeetle) export 2-part majors (`'8.0'`, `'11.8'`); the other 16 export 1-part (`'18'`, `'8'`). The 2-part form is required for `spindb/core/version-migration.ts:getMajorVersion()` to correctly group LTS-vs-current tracks (MongoDB 8.0.x ≠ 8.2.x). **Don't flatten.**

The wrappers signal this via `listVersions(ENGINE, { format: 'major-minor' })` vs `getSupportedMajorVersions(ENGINE)`.

## npm Package (`hostdb`)

The repo is published to npm so consumers can resolve versions offline — no runtime fetch from `registry.layerbase.host` for the registry itself. R2 is still the source of truth for binary tarballs; npm ships a snapshot of `databases.json` / `releases.json`.

**Bundled in the tarball:** `dist/index.js` (+ `.d.ts`, compiled from `lib/`), `databases.json`, `releases.json`, `downloads.json`, `cli/bin.ts` + `bin/cli.js`. The `lib/` source TS is not shipped — see `package.json:files`.

**Public API** is snapshotted in `tests/api-shape.test.ts` (19 exports). Most-used:

- `resolveVersion(engine, version)` — `'17'` → `'17.10.0'`, `'8'` → LTS pick from defaults block. Returns `null` on miss. Handles 4-part ClickHouse and `17-0.107.0` compound.
- `normalizeVersion(engine, version)` — like `resolveVersion` but returns the input unchanged on miss.
- `listVersions(engine, { format })` — `'full' | 'major' | 'major-minor'`, descending sort.
- `getReleaseInfo(engine, version, platform)` — `{ url, sha256, size }`.
- `getCliTools(engine, version)` — version-level overrides honored.
- `isVersionDeprecated(engine, version)` — distinct from `enabled !== false` (deprecated versions still resolve).

**Pre-publish guardrails** (`.github/workflows/publish.yml`):

1. `pnpm build:releases` regenerates releases.json from live GitHub Releases.
2. `git diff --exit-code releases.json` aborts if the regenerated file differs from the committed snapshot.
3. `pnpm build` compiles `lib/` → `dist/`.
4. `pnpm test` runs all tests. The **defaults-sync test** is the critical one — it asserts the resolver returns the same full-version for every input that spindb's MAPs returned at integration time.

`prepare` (in `package.json`) runs `pnpm build` on `pnpm install` for this repo and on `npm publish`. It does NOT run for `file:` deps in pnpm 9 consumers (security policy) — cross-repo dev workflow is: clone hostdb, `pnpm install` (builds dist), then clone spindb (links to pre-built dist).

## Common Tasks

### Add a new database engine

```bash
pnpm add:engine <name>
```

Scaffolds `builds/<id>/`, `.github/workflows/release-<id>.yml`, and a `download:<id>` script. Then follow [`CHECKLIST.md`](./CHECKLIST.md).

### Add a new version of an existing database

1. Update `databases.yml` — add the version. If it should be the LTS/default pick for a major, update `defaults` too.
2. Update `builds/<engine>/sources.json` — URLs for all platforms.
3. `pnpm prep` — regenerates `databases.json`, syncs workflow dropdowns, populates checksums.
4. Run the release workflow on GitHub Actions — uploads binaries, mirrors to R2, rebuilds `releases.json`.
5. Bump `package.json` **patch** so consumers see the new version through the npm package.
6. Merge to main — `publish.yml` runs pre-publish guards and publishes via OIDC.

### Deprecate a version

In `databases.yml`, change the entry from `true` to:

```yaml
versions:
  9.5.0:
    deprecated: true
    note: "Deprecated; superseded by 9.6.0"
```

`pnpm prep` regenerates `databases.json` (workflow dropdowns auto-skip deprecated). Existing binaries stay on R2 — deprecation is UI-only and consumers can still download.

### Retire a platform that was already released

Dropping a platform from a version's `platforms` list does not remove its release: R2 URLs are immutable and `releases.json` is regenerated from the GitHub releases, so the artifact stays listed forever. `pnpm prep` would report that leftover entry as an orphaned release on every run.

Record the drop instead:

```yaml
versions:
  2.7.0:
    platforms: [linux-x64, linux-arm64, darwin-x64, darwin-arm64]
    retired_platforms:
      win32-x64: Why it was dropped, when, and what would have to change to revive it.
```

The platform stays out of `platforms`, so consumers are never offered it; the entry tells prep the release is expected. `tests/retired-platforms.test.ts` keeps the list honest: a retirement whose release no longer exists, or one that contradicts `platforms`, fails CI, as does a released platform that is in neither list. **Never silence an orphaned-release warning any other way** - hand-editing `releases.json` does not survive the next `pnpm prep`, and `publish.yml` aborts on the diff.

### Version-level `cli_tools` overrides

When a vendor removes/adds binaries between versions (e.g., MySQL removed `mysqlpump` in 9.0):

```yaml
mysql:
  cli_tools:
    server: mysqld
    client: mysql
    utilities: [mysqldump, mysqladmin, mysqlpump]   # 8.x has mysqlpump
  versions:
    9.6.0:
      cli_tools:
        server: mysqld
        client: mysql
        utilities: [mysqldump, mysqladmin]           # 9.0+ removed it
    8.4.3: true                                       # uses engine-level cli_tools
```

`validate-binaries.sh` extracts the version from filenames and prefers version-level overrides.

### Downstream impact

After publishing a hostdb version:
- **spindb** — bump the `hostdb` exact-pin in `spindb/package.json`. Wrappers auto-rebuild MAP/SUPPORTED_MAJOR_VERSIONS. `config/engines.json` and `config/engine-defaults.ts` are still hand-maintained for `supportedVersions` / `defaultVersion` / `latestVersion`.
- **layerbase-cloud** — patch within same major.minor → no cloud change (auto via `SPINDB_VERSION` bump). New major.minor → update `src/config/engine-registry.ts` (`supportedVersions`). Change `defaultVersion` → update the same file plus any `images/entrypoints/<engine>.sh` hardcoded fallbacks (only `clickhouse.sh` and `cockroachdb.sh` carry these).

## Binary Hosting (Cloudflare R2)

URL pattern: `https://registry.layerbase.host/{tag}/{filename}`

- `lib/registry.ts` — single source of truth for `REGISTRY_BASE_URL`.
- `lib/r2.ts` — shared R2 client utilities (S3-compatible).
- `scripts/upload-to-r2.ts` — per-release upload (called by CI after each release).
- `scripts/migrate-to-r2.ts` — bulk migration.

R2 tarballs are served via Cloudflare CDN with `Cache-Control: public, max-age=31536000, immutable` (1-year). Each version gets a unique URL cached forever. **Re-uploading a file does NOT update the CDN** — `upload-to-r2.ts --force` purges affected URLs (requires `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` secrets).

R2 retains binaries forever by design (existing containers keep working). `pnpm audit:r2-orphans` lists objects not referenced by `releases.json`; `--delete` removes them.

See `ARCHITECTURE.md` for secret setup (Cloudflare Zone ID, API token) and the full list of required GH Actions secrets.

## Engine-Specific Notes

### MySQL minimal binaries (linux-x64)

MySQL **8.4.9** and **9.6.0** `linux-x64` are re-hosted as MySQL's official `-minimal` tarball (872 MB -> 135 MB, 1042 MB -> 138 MB). `sources.json` points those `linux-x64` entries at the `-minimal` URL; all other platforms/versions are full. Vendor `-minimal` exists for `x86_64` Linux ONLY - other platforms (incl. linux-arm64, the other ~1 GB) need custom trimming. See [`MINIMAL_BINARIES.md`](./MINIMAL_BINARIES.md) for status, the extend-to-other-platforms process, and the known non-uniformities (stale `releases.json`/GitHub-release labels + `_backup/` objects from the in-place overwrite). To replace any binary in place, see [`REPLACE_BINARY_PLAYBOOK.md`](./REPLACE_BINARY_PLAYBOOK.md).

### MariaDB

Three versions are hosted: 10.11, 11.4, 11.8 — all LTS. **Do not consolidate.** The 10.x → 11.x jump had breaking changes; users need 10.11 to match production. 11.4 is the first 11.x LTS; 11.8 has a different EOL than 11.4. All three are independently justified.

### FerretDB

Both v1 (1.24.x) and v2 (2.x) are hosted. **v1 must be kept for backwards compatibility** — do not deprecate it. v2 uses DocumentDB (PostgreSQL extension); v1 uses its own storage engine. Users may depend on either.

### SQLite checksums

Most databases use **SHA-256**. SQLite uses **SHA3-256** (different algorithm) provided on sqlite.org/download.html — copied manually to `sources.json` using the `sha3_256` field instead of `sha256`. When adding a new database, check the vendor's checksum format first.

## Development Commands

```bash
# Pre-commit
pnpm prep              # Type-check, lint, sync versions, populate checksums
pnpm prep --fix        # Same + auto-fix lint/format
pnpm prep --check      # Check only (for CI)

# Database listing
pnpm dbs                                        # Show all databases

# Download binaries locally
pnpm download:<engine> -- --version X.Y.Z
pnpm download:<engine> -- --version X.Y.Z --all-platforms

# Local Docker builds
./builds/<engine>/build-local.sh --version X.Y.Z --platform linux-arm64

# Scaffolding & maintenance
pnpm add:engine <name>                          # Scaffold new database
pnpm sync:versions [<database>] [--check]       # Sync workflow dropdowns
pnpm checksums:populate <database>              # Populate SHA256 checksums

# PostgreSQL: EDB Windows file IDs
pnpm edb:fileids [-- --update]

# macOS dylib auditing
pnpm check:dylibs [-- <path>]                   # Scan for non-relocatable paths

# R2
pnpm upload:r2 -- --tag <release-tag>           # Upload single release
pnpm migrate:r2 [-- --dry-run --database X]     # Bulk migrate
pnpm audit:r2-orphans [-- --delete --engine X]  # Find/clean orphans
```

## Version Tracking

`UPGRADE_VERSIONS.md` tracks which engines need upgrades, organized by priority tier. Run `/audit-hostdb-versions` to refresh it with latest upstream versions.
