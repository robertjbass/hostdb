# hostdb

Pre-built database binaries for all major platforms, hosted on Cloudflare R2 via `registry.layerbase.host`.

**Primary consumer:** [spindb](https://github.com/robertjbass/spindb) - a CLI tool for spinning up local database instances

**Ecosystem docs:** `~/dev/layerbase-architecture/` — Shared architecture, infrastructure inventory, cross-project rules, and agent configs.

**Ecosystem invariants:** `~/dev/layerbase-architecture/INVARIANTS.md` — Non-negotiable rules (scripting-first, thin desktop wrapper, platform-agnostic cloud, binary ownership). Read before making architectural changes.

**Ecosystem:** hostdb builds database binaries and publishes them to Cloudflare R2. **spindb** (`~/dev/spindb`) downloads them to run databases locally. **layerbase-cloud** (`~/dev/layerbase-cloud`) uses a universal Docker image at `ghcr.io/layerbase-llc/`, and spindb downloads hostdb binaries on demand inside that container. **layerbase-desktop** (`~/dev/layerbase-desktop`) is an Electron GUI over spindb. **layerbase** (`~/dev/layerbase`) is the web app at layerbase.com.

## Versioning & Changelog

hostdb is **published to npm as `hostdb`** (see "npm Package" section below). Bumping `package.json` triggers a publish via `.github/workflows/publish.yml` on merge to main. Every spindb / layerbase-cloud release pins an exact hostdb version, so every `package.json` bump matters.

When adding a **new database engine**:
1. Bump the **minor version** in `package.json` (e.g., 0.8.0 → 0.9.0)
2. Add a changelog entry in `CHANGELOG.md` with the new version and date
3. Include what was added, any special notes about the implementation

When adding a **new version of an existing database** (patch wave, security fix, etc.):
- Bump the **patch version** in `package.json` (e.g., 0.30.0 → 0.30.1) so consumers can detect and adopt the change.
- Update `databases.yml` (run `pnpm prep` to regenerate `databases.json`) and `builds/{engine}/sources.json`.

When changing a **defaults block policy** (e.g., MongoDB '8' rolls from 8.0 LTS to 8.2):
- Bump the **minor version** at least, even though the schema didn't change. The behavior change is user-visible.
- Add a clear CHANGELOG entry explaining the LTS-vs-latest policy shift.

## Philosophy

This repository exists to solve one problem: **database binaries should be available for download on every major platform, for every supported version, without relying on third-party sources that may disappear.**

### Binary Sourcing Priority

When adding a database, source binaries in this order:

1. **Official binaries** - Direct from vendor CDNs (Oracle for MySQL, MariaDB Foundation, EnterpriseDB for PostgreSQL Windows, etc.)
2. **Third-party repositories** - Trusted sources like [MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) Maven JARs
3. **Build from source** - Docker builds for Linux, native GitHub Actions builds for macOS

### Key Principles

- **Full platform coverage**: Every version must have binaries for all 5 platforms
- **Build once, host forever**: Binaries are uploaded to GitHub Releases and never rebuilt
- **Queryable manifest**: `releases.json` lets CLI tools discover available downloads
- **Single source of truth**: `databases.json` controls which databases/versions/platforms are supported

### Complete, Embeddable Binaries

Every hostdb release should be **self-contained and ready to use** without additional downloads. This means:

1. **Bundle related components**: If a database vendor distributes components separately (like MongoDB's server, shell, and tools), hostdb bundles them into a single package. Users should get everything needed to run the database, connect to it, and manage it.

2. **Include client tools**: Releases should include both server binaries and essential client/management tools (shells, backup utilities, etc.) where available.

3. **No external dependencies**: Downloaded binaries should work immediately without requiring users to install additional packages or tools from other sources.

**Example - MongoDB**: Since MongoDB 4.4, the shell (`mongosh`) and database tools (`mongodump`, `mongorestore`, etc.) are distributed separately. hostdb bundles all three components (server + shell + tools) into a single release, so users get a complete MongoDB installation.

This philosophy ensures SpinDB and other consumers can embed database binaries without managing multiple downloads or worrying about component compatibility.

## Supported Platforms

- `linux-x64` - Linux x86_64 (glibc 2.28+)
- `linux-arm64` - Linux ARM64 (glibc 2.28+)
- `darwin-x64` - macOS Intel
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

## How It Works

1. **databases.json** defines which databases, versions, and platforms are supported
2. **Build scripts** download official binaries or build from source
3. **GitHub Actions** run builds in parallel, upload to GitHub Releases, then mirror to Cloudflare R2
4. **releases.json** is auto-updated with R2 download URLs (`registry.layerbase.host`) for each release
5. **SpinDB** (or any consumer) queries releases.json to find and download binaries

## Binary Hosting (Cloudflare R2)

Binaries are hosted on Cloudflare R2 behind `registry.layerbase.host`. GitHub Releases are still created (as the build artifact source), but all public download URLs point to R2.

**URL pattern:** `https://registry.layerbase.host/{tag}/{filename}`

**Configuration:**
- `lib/registry.ts` — single source of truth for `REGISTRY_BASE_URL`
- `lib/r2.ts` — shared R2 client utilities (S3-compatible)
- `scripts/upload-to-r2.ts` — per-release upload (called by CI after each release)
- `scripts/migrate-to-r2.ts` — one-time bulk migration of existing releases

**Required GitHub Actions secrets:**
- `R2_ACCOUNT_ID` — Cloudflare account ID
- `R2_ACCESS_KEY_ID` — R2 API token access key
- `R2_SECRET_ACCESS_KEY` — R2 API token secret key
- `R2_BUCKET_NAME` — R2 bucket name (e.g., `hostdb-registry`)
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with `Zone.Cache Purge` permission (see setup below)
- `CLOUDFLARE_ZONE_ID` — Cloudflare zone ID for `registry.layerbase.host` (see setup below)

**Setting up Cloudflare secrets:**
1. **Zone ID** — Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > select the `layerbase.host` zone > the Zone ID is in the right sidebar of the **Overview** page under "API"
2. **API Token** — Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > **My Profile** (top-right avatar) > **API Tokens** > **Create Token** > use the **"Custom token"** template:
   - Token name: `hostdb-cache-purge`
   - Permissions: **Zone** > **Cache Purge** > **Purge**
   - Zone resources: **Include** > **Specific zone** > `layerbase.host`
3. Add both values as GitHub Actions secrets in the hostdb repository settings

**Workflow:** Each `release-*.yml` workflow has an `upload-to-r2` job that mirrors assets from GitHub Releases to R2, followed by `update-releases` which rebuilds `releases.json` from all GitHub releases and publishes it to R2.

**CDN Caching:** R2 tarballs are served through Cloudflare's CDN with `Cache-Control: public, max-age=31536000, immutable` (1-year cache). This means:
- Normal releases work fine — each version gets a unique URL that's cached forever
- **Re-uploading a file to R2 does NOT update the CDN** — the edge cache continues serving the old version
- When using `--force` on `upload-to-r2.ts`, the script automatically purges affected URLs from Cloudflare's CDN cache (requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` secrets)
- If those secrets aren't set, the purge step is skipped with a warning — you'd need to purge manually via **Cloudflare Dashboard > layerbase.host > Caching > Configuration > Purge Everything**

**Migration:** To migrate existing releases: `pnpm migrate:r2 [--dry-run] [--database mysql] [--concurrency 3]`

## npm Package (`hostdb`)

This repo is **published to npm as `hostdb`** so consumers (spindb, layerbase-cloud, third parties) can resolve versions, query CLI tool metadata, and look up download URLs offline — no runtime fetch from `registry.layerbase.host` for the registry itself. R2 is still the source of truth for binary tarballs; the npm package ships a *snapshot* of the registry JSON files.

### What's bundled in the tarball

- `dist/index.js` + `dist/index.d.ts` (compiled from `lib/`) — public resolver API.
- `databases.json` — version + platform + CLI tools per engine (also the source for the resolver's `defaults` block).
- `releases.json` — R2 URLs + sha256 + size per (engine, version, platform).
- `downloads.json` — package-manager install commands per CLI tool.
- `cli/bin.ts` + `bin/cli.js` — the `hostdb` CLI command (runs via tsx).

The `lib/` source TS is **not** shipped (consumers use the compiled dist/). See `package.json:files`.

### Public API surface

Snapshotted in `tests/api-shape.test.ts` (19 names). Most-used exports:

- `resolveVersion(engine, version)` — `'17'` → `'17.10.0'`, `'8'` → LTS pick from defaults block. Returns `null` if unknown. Handles 4-part ClickHouse versions and `17-0.107.0` compound format.
- `normalizeVersion(engine, version)` — like `resolveVersion` but returns the input unchanged on miss (so wrappers can drop in).
- `listVersions(engine, { format: 'full' | 'major' | 'major-minor' })` — list available versions, descending sort.
- `getSupportedMajorVersions(engine)` — keys of the engine's `defaults` block. Used by spindb's wrappers that expect 1-part majors.
- `getMajorDefault(engine, major)` / `getEngineDefaults(engine)` — explicit-policy queries (defaultVersion vs latestVersion can differ for LTS-tracked engines).
- `getReleaseInfo(engine, version, platform)` — `{ url, sha256, size }` straight from the bundled releases.json.
- `getCliTools(engine, version)` — engine-level cli_tools with version-level overrides honored.
- `isVersionDeprecated(engine, version)` — distinct from `enabled !== false` (deprecated versions still resolve; only `enabled: false` removes them from resolution entirely).
- `loadDatabasesJson()` / `loadReleasesJson()` / `loadDownloadsJson()` — direct bundled-JSON access. Memoized on first call; tests reset via `_resetLoaderCachesForTests` from `lib/databases.ts`.

### Defaults block — major-version resolution policy

Every engine in `databases.yml` has a `defaults` block mapping 1-part major versions to the full version the resolver should return:

```yaml
mongodb:
  defaults:
    '7': 7.0.34
    '8': 8.0.23    # LTS pick — NOT 8.2.x (the highest)
mariadb:
  defaults:
    '10': 10.11.16
    '11': 11.8.6   # Highest LTS line in 11.x
```

This makes silent LTS-vs-latest decisions explicit. Without the defaults block, `resolveVersion('mongodb', '8')` would prefix-match to `'8.2.9'` (highest), which contradicts the MongoDB project's LTS guidance. The block IS the policy declaration.

When changing a `defaults` value (e.g., MongoDB rolls forward to `'8': 8.2.0` once 8.2 becomes LTS), bump at least a minor version and document in CHANGELOG — this is a user-visible behavior change for every spindb / layerbase-cloud install that bumps to the new hostdb.

### Pre-publish guardrails (`.github/workflows/publish.yml`)

The publish workflow runs these gates before `npm publish`:

1. `pnpm build:releases` regenerates releases.json from live GitHub Releases.
2. `git diff --exit-code releases.json` aborts the publish if the regenerated file differs from the committed snapshot — preventing publishing a stale registry.
3. `pnpm build` compiles `lib/` → `dist/`.
4. `pnpm test` runs all 167 tests (resolver + defaults-sync + api-shape). The defaults-sync test is the critical one: it asserts the resolver returns the same full-version for every input that spindb's MAPs returned at integration time. If hostdb's behavior drifts, publish fails.

### Spindb wrapper pattern

Spindb's `engines/<X>/version-maps.ts` are now thin wrappers that build their legacy `<ENGINE>_VERSION_MAP` and `SUPPORTED_MAJOR_VERSIONS` at module-load time from hostdb's resolver. To bump a version: update hostdb's `databases.yml`, publish a new hostdb, then bump the `hostdb` dep pin in spindb. The wrapper rebuilds automatically — no spindb code edits.

Five engines (MongoDB, MySQL, MariaDB, ClickHouse, TigerBeetle) export 2-part `SUPPORTED_MAJOR_VERSIONS` (`['8.0', '8.2']` rather than `['8']`) because spindb's `core/version-migration.ts:getMajorVersion()` uses the array to reverse-map a full version to its grouping — and conflating MongoDB 8.0.x with 8.2.x would break the LTS/current distinction. The wrappers signal this choice via `listVersions(ENGINE, { format: 'major-minor' })` vs `getSupportedMajorVersions(ENGINE)`.

### Spindb pinning

Spindb must pin `hostdb` **exactly** (`"hostdb": "0.31.0"`, no caret/tilde) so that older spindb versions deterministically resolve to a single hostdb snapshot. See spindb's CLAUDE.md for the rationale — short version: a patch hostdb release can add new versions, which changes the user-visible spindb output for an already-published spindb.

### Pre-publish dev setup

`prepare` script (in `package.json`) runs `pnpm build` automatically on `pnpm install` in this repo's own dir and on `npm publish`. It does NOT run for `file:` deps in pnpm 9 consumers (pnpm security policy) — so the cross-repo dev workflow is: clone hostdb, `pnpm install` (builds dist), then clone spindb (which links to hostdb's pre-built dist).

## Project Structure

```
hostdb/
├── databases.yml           # Source of truth (edit this, generates databases.json)
├── databases.json          # Generated from databases.yml by pnpm prep
├── releases.json           # Queryable manifest of GitHub Releases (auto-updated)
├── downloads.json          # CLI tools, prerequisites, fallback downloads
├── schemas/
│   ├── databases.schema.json
│   ├── sources.schema.json
│   └── releases.schema.json
├── builds/                 # Per-database build configurations
│   ├── common/
│   │   ├── validate-binaries.sh  # Validate archives contain all required cli_tools binaries
│   │   ├── fix-macos-dylibs.sh   # Bundle Homebrew dylibs for relocatable binaries
│   │   └── check-macos-dylibs.sh # Audit packages for non-relocatable paths
│   ├── mysql/
│   │   ├── download.ts     # Downloads/repackages binaries
│   │   ├── sources.json    # Version → URL mappings
│   │   ├── Dockerfile      # Source build for Linux
│   │   ├── build-local.sh  # Local Docker build script
│   │   └── README.md
│   ├── postgresql/
│   ├── mariadb/
│   └── ...
├── scripts/
│   ├── add-engine.ts         # pnpm add:engine - scaffold new database
│   ├── fetch-edb-fileids.ts  # pnpm edb:fileids - fetch PostgreSQL Windows file IDs
│   ├── list-databases.ts     # pnpm dbs
│   ├── sync-versions.ts      # pnpm sync:versions - sync workflow dropdowns
│   └── build-releases-json.ts # pnpm build:releases - rebuild releases.json from GitHub
└── .github/workflows/
    ├── release-mysql.yml
    ├── release-postgresql.yml
    └── ...
```

## Configuration Files

**IMPORTANT:** All configuration files have JSON schemas. If you modify the structure of these files (add/remove/rename keys), you must also update the corresponding schema.

| Config File | Schema File | Description |
|-------------|-------------|-------------|
| `databases.json` | `schemas/databases.schema.json` | **Single source of truth** - drives all automation |
| `builds/*/sources.json` | `schemas/sources.schema.json` | Binary download URLs per version/platform |
| `releases.json` | `schemas/releases.schema.json` | Manifest of GitHub Releases (queryable) |

### databases.json

The central source of truth that **drives all automation**. GitHub Actions workflows validate against this file before building. The key for each database (e.g., `mysql`, `postgresql`, `mariadb`) is the normalized ID used for:
- Workflow files: `.github/workflows/release-{id}.yml`
- Build directories: `builds/{id}/`
- Release tags: `{id}-{version}`

Each database entry includes:

```json
{
  "displayName": "MySQL",
  "description": "...",
  "type": "Relational",
  "license": "GPL-2.0",
  "commercialUse": true,
  "spindbStatus": "completed",
  "versions": { "8.4.7": true, "8.0.40": true },
  "platforms": ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]
}
```

**Note:** `databases.yml` uses snake_case keys (`display_name`, `spindb_status`, etc.). The `pnpm prep` script converts them to camelCase for `databases.json`.

**spindbStatus values:**
- `completed` - Fully built and released
- `in-progress` - Currently being implemented

See `PROSPECTS.md` for planned and unsupported databases.

### sources.json (per database)

Maps versions and platforms to download URLs:

```json
{
  "database": "mysql",
  "versions": {
    "8.4.7": {
      "linux-x64": {
        "url": "https://dev.mysql.com/get/Downloads/...",
        "format": "tar.gz",
        "sourceType": "official"
      },
      "linux-arm64": {
        "sourceType": "build-required"
      }
    }
  }
}
```

**Source types:**
- `official` - Direct from vendor CDN
- `mariadb4j` - Third-party repository (MariaDB4j Maven JARs)
- `build-required` - Must build from source

## GitHub Actions Workflows

Each database has a release workflow that **validates against databases.json**:

1. Triggered via `workflow_dispatch` (manual)
2. **Dropdown selects version** - options synced from databases.json via `pnpm sync:versions`
3. **Validate job** checks version is enabled in `databases.json` and exists in `sources.json`
4. Matrix builds all platforms in parallel
5. Downloads official binaries OR builds from source
6. **Validate binaries** - extracts archives and verifies all `cli_tools` binaries exist
7. Creates GitHub Release with artifacts
8. `upload-to-r2` job mirrors release assets to Cloudflare R2
9. `update-releases` job rebuilds `releases.json` from all GitHub releases and publishes to R2

**Validation flow:**
```
User selects version "8.4.7" from dropdown
        ↓
Check databases.json: versions["8.4.7"] == true?
        ↓
Check sources.json: versions["8.4.7"] exists?
        ↓
Proceed with build (or fail with helpful error)
```

**Build methods by platform:**
| Platform | Method |
|----------|--------|
| linux-x64 | Download or Docker build |
| linux-arm64 | Docker build (QEMU emulation) |
| darwin-x64 | Native build on macos-15-intel runner |
| darwin-arm64 | Native build on macos-14 runner |
| win32-x64 | Download official binary or source build (see [WINDOWS_BUILD.md](./WINDOWS_BUILD.md)) |

### macOS Native Build Considerations

Native macOS builds (darwin-x64, darwin-arm64) require careful SDK configuration to avoid conflicts between Xcode and Command Line Tools:

**The Problem:** CMake can find libraries from Command Line Tools (`/Library/Developer/CommandLineTools/SDKs/`) while using Xcode's SDK for compilation. This causes C++ header search path errors like:
```
error: <cstddef> tried including <stddef.h> but didn't find libc++'s <stddef.h> header.
```

**The Solution:** Force all tools to use a single SDK by:
1. Setting `xcode-select` to the Xcode app (not Command Line Tools)
2. Exporting `SDKROOT`, `CC`, `CXX`, `CFLAGS`, `CXXFLAGS`, `LDFLAGS` with `--sysroot`
3. Using `CMAKE_FIND_ROOT_PATH` to restrict library search to Xcode SDK + Homebrew only
4. Running cmake via `xcrun` to inherit the correct environment

See `release-mariadb.yml` for a working example of this configuration.

## Adding a New Database

Use the scaffolding script to create the basic structure:

```bash
pnpm add:engine redis
pnpm add:engine sqlite
```

This creates:
- `builds/<id>/` directory with template files
- `.github/workflows/release-<id>.yml` with validation
- `download:<id>` script in package.json

Then follow the printed instructions to implement the download logic.

See [CHECKLIST.md](./CHECKLIST.md) for the complete checklist.

See [BINARIES.md](./BINARIES.md) for archive structure reference (top-level dirs, binary locations, single vs multi-file).

**Windows builds:** If no official Windows binary exists, see [WINDOWS_BUILD.md](./WINDOWS_BUILD.md) for strategies (Cygwin, MSYS2 CLANG64, cross-compilation, etc.).

### Download Script Requirements

When implementing `builds/<database>/download.ts`:

1. **Handle `--` delimiter**: pnpm passes `--` literally when running `pnpm script -- args`. Add a case to ignore it:
   ```typescript
   case '--':
     // Ignore -- (end of options delimiter from pnpm)
     break
   ```

2. **ESLint no-fallthrough**: Even after `process.exit()`, ESLint requires a `break` statement:
   ```typescript
   case '--help':
     console.log('...')
     process.exit(0)
     break // unreachable, but required for no-fallthrough rule
   ```

3. **Vendor URL encoding**: Some vendors use unique version encoding in URLs. Document the formula:
   - SQLite: `3.51.2` → `3510200` (MAJOR×1000000 + MINOR×10000 + PATCH×100)
   - Add notes in `sources.json` explaining any encoding schemes

### Dockerfile Requirements

When implementing `builds/<database>/Dockerfile` for source builds:

1. **ARG vs ENV scoping**: Docker `ARG` values are only available during build (RUN), not at runtime (CMD/ENTRYPOINT). To use a build arg in CMD:
   ```dockerfile
   ARG VERSION
   ENV VERSION=${VERSION}  # Persist ARG to runtime
   CMD cp /build/output-${VERSION}.tar.gz /dist/
   ```

2. **Version number calculations**: If version needs encoding, do it in a RUN step and save to a file:
   ```dockerfile
   RUN VERSION_NUM=$(echo "${VERSION}" | awk -F. '{printf "%d%02d%02d00", $1, $2, $3}') && \
       echo "VERSION_NUM=${VERSION_NUM}" > /tmp/version_env
   ```

### Workflow Requirements

When implementing `.github/workflows/release-<database>.yml`:

1. **Release job condition**: If you have multiple build jobs (e.g., one for downloads, one for source builds), use this pattern to prevent partial releases:
   ```yaml
   release:
     needs: [build-download, build-source]
     if: always() && (needs.build-download.result == 'success' || needs.build-download.result == 'skipped') && (needs.build-source.result == 'success' || needs.build-source.result == 'skipped')
   ```
   This ensures the release only happens if all required jobs either succeed or were intentionally skipped.

2. **Conditional artifact downloads**: Only download artifacts from jobs that actually ran:
   ```yaml
   - name: Download source build artifacts
     if: needs.build-source.result == 'success'
     uses: actions/download-artifact@v4
   ```

3. **Binary validation step**: Every release workflow must validate archives before creating the GitHub Release. Add this step in the `release` job, after preparing release assets and before the "Create Release" step:
   ```yaml
   - name: Validate required binaries
     run: |
       chmod +x builds/common/validate-binaries.sh
       ./builds/common/validate-binaries.sh <database-id> ./release-assets
   ```

## Adding New Versions

When adding a new version to an existing database:

1. Update `databases.yml` - add version with `true` (or a version config object). If the new version should be the LTS or default pick for a major, also update the engine's `defaults` block.
2. Update `builds/<database>/sources.json` - add URLs for all platforms
3. Run `pnpm prep` - generates databases.json, syncs workflows, and populates checksums
4. Run the release workflow on GitHub Actions — uploads binaries to GitHub Releases, mirrors to R2, rebuilds releases.json
5. **Bump `package.json` patch version** (e.g., 0.30.0 → 0.30.1) so the new binaries propagate via the npm package. Without this bump, consumers pinning `hostdb@0.30.0` won't see the new version.
6. Merge to main — `publish.yml` runs the pre-publish guards (build:releases drift check, build, tests) and publishes to npm via OIDC.

**That's it.** The prep script handles syncing workflow dropdowns and populating SHA256 checksums automatically. The publish workflow handles npm.

### Downstream Impact (spindb + layerbase-cloud)

Changes in hostdb ripple to two downstream projects. After the npm-package migration the spindb side is **almost fully automatic**, but a publish + dep-bump is still required.

**spindb** (`~/dev/spindb`) — after the npm-package migration most of the version-related code is automatic:
- `engines/<db>/version-maps.ts` — **no longer hand-edited**. The wrappers rebuild MAP + SUPPORTED_MAJOR_VERSIONS from hostdb's resolver at module-load time.
- `config/engines.json` and `config/engine-defaults.ts` — still hand-maintained for now (`supportedVersions`, `defaultVersion`, `latestVersion`). A future refactor could derive these from hostdb's resolver too.
- `engines/<db>/hostdb-releases.ts` / `engines/<db>/index.ts` — `fetchDeprecatedVersions` overrides only needed for engines newly gaining deprecation support.
- `cli/ui/prompts.ts` — already handles `[deprecated]` tags generically; no changes needed unless UI behavior changes.
- `package.json` — **bump the `hostdb` exact-pin** to the newly-published version so the bundled snapshot picks up the new releases. This is the actual "shipping" step.

**layerbase-cloud** (`~/dev/layerbase-cloud`) — uses major.minor version tags (e.g., `11.8`) that spindb resolves to a full semver (e.g., `11.8.5`) via its static `engines/<db>/version-maps.ts` MAP. The cloud runs a single universal Docker image (`ghcr.io/layerbase-llc/universal`); engine binaries are **not** baked into the image — spindb downloads them on demand from `registry.layerbase.host`. The version resolution authority is the spindb baked into the image, not the registry. Practical impact per change shape:
- **Patch bump within same major.minor** (e.g., `11.8.5 → 11.8.6`): No cloud changes. The new spindb release (with the updated MAP) takes effect when the universal image is rebuilt with the new `SPINDB_VERSION`.
- **New major.minor** (e.g., adding `11.9`): Update `src/config/engine-registry.ts` (`supportedVersions` array). No workflow file changes — cloud's `build-images.yml`/`deploy.yml` are engine-agnostic.
- **Change defaultVersion**: Update `src/config/engine-registry.ts` (`defaultVersion`). Also update `images/entrypoints/<engine>.sh` if a hardcoded `SPINDB_VERSION` default exists (only `clickhouse.sh` and `cockroachdb.sh` carry these).

## Deprecating Versions

To deprecate a version (stop building it but keep existing binaries downloadable):

1. **Update `databases.yml`** — change the version entry from `true` to an object with `deprecated: true`:
   ```yaml
   versions:
     9.5.0:
       deprecated: true
       note: "Deprecated; superseded by 9.6.0"
   ```

2. **Run `pnpm prep`** — this regenerates databases.json and syncs workflow dropdowns. Deprecated versions are automatically excluded from workflow dropdowns by `sync-versions.ts`.

3. **Rebuild releases.json** — `build-releases-json.ts` propagates the `deprecated` flag from databases.json into releases.json entries, so consumers like spindb can read it.

4. **Update spindb** — see "Downstream Impact" above. The key files are version-maps, engines.json, and engine-defaults.

**Important:** Deprecation does NOT delete binaries. Existing releases remain on R2 and in releases.json. Users can still download and use deprecated versions — they just won't appear in workflow build dropdowns or be recommended in spindb's UI.

### Version-Level cliTools Overrides

When a vendor removes or adds binaries between versions (e.g., MySQL removed `mysqlpump` in 9.0), use version-level `cli_tools` overrides in `databases.yml`:

```yaml
mysql:
  cli_tools:
    server: mysqld
    client: mysql
    utilities:
      - mysqldump
      - mysqladmin
      - mysqlpump     # present in 8.x
  versions:
    9.6.0:
      note: "mysqlpump removed in MySQL 9.0"
      cli_tools:       # overrides engine-level cli_tools
        server: mysqld
        client: mysql
        utilities:
          - mysqldump
          - mysqladmin
    8.4.3: true        # uses engine-level cli_tools (includes mysqlpump)
```

`validate-binaries.sh` extracts the version from archive filenames and checks for version-level `cliTools` overrides before falling back to engine-level. This prevents build failures when the binary list differs between versions.

## Version Tracking

**`UPGRADE_VERSIONS.md`** tracks which engines need upgrades, organized by priority tier. Run `/audit-hostdb-versions` to refresh it with latest upstream versions.

## Engine-Specific Notes

### MariaDB

Three versions are hosted: 10.11, 11.4, and 11.8 — all LTS releases. This is intentional:

- **10.11** (LTS, EOL Feb 2028) — Last LTS in the 10.x line. Many production deployments still run 10.x because the jump to 11.x had breaking changes (removed `mysql_install_db`, system table changes). Users need this to match their production version.
- **11.4** (LTS, EOL May 2029) — First long-term-supported release in 11.x. The "safe upgrade target" for users migrating from 10.x.
- **11.8** (LTS, EOL ~2028) — Latest LTS with newer features. Same major line as 11.4 but both are independently supported LTS releases with different EOL dates.

All three are justified. Do not consolidate.

### FerretDB

Both v1 (1.24.x) and v2 (2.x) are hosted. **v1 must be kept for backwards compatibility** — do not deprecate it. v2 uses DocumentDB (PostgreSQL extension) while v1 uses its own storage engine. Users may depend on either.

## Checksums

Most databases use **SHA-256** checksums. The `pnpm checksums:populate` script downloads files and computes checksums automatically.

**Exception - SQLite**: SQLite uses **SHA3-256** checksums (different algorithm). These are provided directly on [sqlite.org/download.html](https://sqlite.org/download.html) and must be copied manually to `sources.json` using the `sha3_256` field instead of `sha256`.

When adding a new database:
1. Check the vendor's download page for checksum format (SHA-256, SHA3-256, SHA-512, etc.)
2. If SHA-256, use `pnpm checksums:populate <database>` to auto-populate
3. If different algorithm, copy checksums manually and use appropriate field name (e.g., `sha3_256`)

```bash
# Sync all workflows
pnpm sync:versions

# Sync specific database
pnpm sync:versions mysql

# Check if sync needed (for CI)
pnpm sync:versions --check
```

## Development Commands

```bash
# Pre-commit preparation (run before committing)
pnpm prep              # Type-check, lint, sync versions, populate checksums
pnpm prep --fix        # Same as above + auto-fix lint/format issues
pnpm prep --check      # Check only, don't modify files (for CI)

# List databases
pnpm dbs              # Show all databases

# Download binaries locally
pnpm download:mysql -- --version 8.4.7
pnpm download:mysql -- --version 8.4.7 --all-platforms
pnpm download:mariadb -- --version 11.8.5 --build-fallback

# Local Docker builds
./builds/mariadb/build-local.sh --version 11.8.5 --platform linux-arm64

# Scaffolding and maintenance
pnpm add:engine redis              # Scaffold new database
pnpm sync:versions                 # Sync workflow dropdowns with databases.json
pnpm checksums:populate <database> # Populate missing SHA256 checksums

# PostgreSQL: Fetch EDB Windows file IDs
pnpm edb:fileids                   # Show available file IDs from EDB
pnpm edb:fileids -- --update       # Update sources.json with latest IDs

# macOS dylib auditing
pnpm check:dylibs                              # Scan ./dist for Homebrew paths
pnpm check:dylibs -- ./dist/redis              # Scan specific package

# R2 binary hosting
pnpm upload:r2 -- --tag mysql-8.4.3            # Upload single release to R2
pnpm migrate:r2                                 # Migrate all releases to R2
pnpm migrate:r2 -- --dry-run                    # Preview migration
pnpm migrate:r2 -- --database mysql             # Migrate one database only
```

## Querying Available Binaries

```bash
# Raw URL for releases.json
https://raw.githubusercontent.com/robertjbass/hostdb/main/releases.json
```

**Download URL pattern:**
```
https://registry.layerbase.host/{tag}/{filename}
```

**releases.json structure:**
```json
{
  "repository": "robertjbass/hostdb",
  "databases": {
    "mysql": {
      "8.4.3": {
        "releaseTag": "mysql-8.4.3",
        "platforms": {
          "darwin-arm64": {
            "url": "https://registry.layerbase.host/mysql-8.4.3/mysql-8.4.3-darwin-arm64.tar.gz",
            "sha256": "abc123...",
            "size": 165000000
          }
        }
      }
    }
  }
}
```

## Package Configuration

The root `package.json` has `"private": true` because:
- The root package is not published to npm
- Only the future `cli/` package will be published as `@hostdb/cli` or `hostdb`

## GitHub Constraints (Public Repo)

| Resource | Limit |
|----------|-------|
| Actions minutes | Unlimited (public repo) |
| Job timeout | 6 hours per job |
| Release file size | 2 GB per file |
| Total release storage | No limit |

**Build times vary significantly:**
- Downloads: 2-5 minutes
- Docker builds (QEMU): 45-90+ minutes
- Native macOS builds: 30-60 minutes

## macOS Source Build Learnings (PostgreSQL-DocumentDB)

Building PostgreSQL with extensions from source on macOS requires careful handling of library paths and code signing. These lessons apply to any macOS source build that needs relocatable binaries.

### Why Build from Source Instead of Homebrew?

Homebrew binaries have **hardcoded absolute paths** (e.g., `/opt/homebrew/lib/libssl.3.dylib`). For relocatable binaries that work on any machine:

1. Build PostgreSQL from source with relative paths
2. Build extensions (PostGIS, DocumentDB) from source against that PostgreSQL
3. Bundle all Homebrew dependencies and rewrite their paths

### macOS dylib Path Rewriting

macOS dynamic libraries use special path prefixes:

| Prefix | Meaning | When to Use |
|--------|---------|-------------|
| `@rpath` | Search paths defined in the binary's LC_RPATH | Libraries that could be in multiple locations |
| `@loader_path` | Directory containing the loading binary | Bundled libraries next to executables |
| `@executable_path` | Directory containing the main executable | App bundles |

**Workflow for making binaries relocatable:**

1. **Copy dependencies recursively** - Use `otool -L` to find dependencies, copy them to bundle
2. **Handle `@rpath` references** - Resolve by searching Homebrew locations (`/opt/homebrew/lib`, `/usr/local/lib`)
3. **Rewrite paths with install_name_tool**:
   ```bash
   # Change library's own ID
   install_name_tool -id "@loader_path/libfoo.dylib" libfoo.dylib

   # Change reference to another library
   install_name_tool -change "/opt/homebrew/lib/libbar.dylib" "@loader_path/libbar.dylib" libfoo.dylib

   # Add rpath for finding libraries
   install_name_tool -add_rpath "@loader_path" binary

   # Remove Homebrew rpaths
   install_name_tool -delete_rpath "/opt/homebrew/lib" binary
   ```

4. **Re-sign after modification** - macOS requires code signing after any binary modification:
   ```bash
   codesign -s - --force --preserve-metadata=entitlements,requirements,flags,runtime binary
   ```

### Recursive Dependency Bundling

Libraries have transitive dependencies. A recursive function is needed:

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

### DocumentDB SQL Patching

FerretDB's DocumentDB extension has upstream SQL issues that need patching:

1. **Token concatenation (`##`)** - PostgreSQL doesn't support C preprocessor-style `##`:
   ```bash
   # Fix patterns like "documentdb## _rum_" → "documentdb_rum_"
   sed -i '' -e 's/## //g' -e 's/##_/_/g' -e 's/_##/_/g' -e 's/##//g' file.sql
   ```

2. **Wrong library references** - Some functions reference `MODULE_PATHNAME` but are in `pg_documentdb_core`:
   ```bash
   # Fix: bson_in, bson_out, bson_send, bson_recv, bsonquery_* functions
   sed -i '' -E "s/AS 'MODULE_PATHNAME', \\\$function\\\$(bson_in|bson_out|...)...\$/AS '\$libdir\/pg_documentdb_core', .../" file.sql
   ```

### Linux ARM64 Builds (QEMU)

ARM64 Linux builds use QEMU emulation on x64 runners:
- Build times: 45-90+ minutes (vs 3-5 minutes for native)
- Builds can appear "frozen" during long compilation steps
- Use `docker buildx` with `--platform linux/arm64`

### Workflow Concurrency

The release workflow uses concurrency groups to prevent conflicts:
```yaml
concurrency:
  group: release-postgresql-documentdb
  cancel-in-progress: false
```

This means only one build runs at a time - subsequent triggers are queued, not cancelled.

## macOS Dylib Patching (Shared Script)

macOS source builds that link against Homebrew (OpenSSL, pcre2, etc.) produce binaries with absolute paths like `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib`. These break on any Mac without those exact Homebrew packages installed.

**`builds/common/fix-macos-dylibs.sh <package-root>`** fixes this by:
1. Bundling Homebrew dylibs into the package's `lib/` directory
2. Rewriting all absolute paths to `@loader_path` relative references
3. Re-signing modified binaries (required by macOS)
4. Verifying no Homebrew paths remain (fails the build if any found)

**When to use:** Add to any release workflow's macOS build step if the database links against Homebrew libraries at build time. Insert between metadata creation and tarball creation:
```bash
chmod +x "$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh"
"$GITHUB_WORKSPACE/builds/common/fix-macos-dylibs.sh" "$GITHUB_WORKSPACE/install/<database>"
```

**Currently used by:** MariaDB, Redis, Valkey, CouchDB workflows. PostgreSQL-DocumentDB has its own inline implementation.

**Diagnostic:** `pnpm check:dylibs [<path>]` scans packages for non-relocatable paths without modifying anything. The `audit-dylibs` workflow (`workflow_dispatch`) audits published releases on R2.

## Binary Validation (Shared Script)

Every release workflow validates that archives contain all required binaries before creating the GitHub Release. This prevents shipping incomplete releases (e.g., PostgreSQL 17.7.0 once shipped without `psql`, `pg_dump`, and other client tools, breaking SpinDB's backup/restore).

**`builds/common/validate-binaries.sh <database> <release-assets-dir>`** does the following:
1. Extracts the version from archive filenames (e.g., `mysql-9.6.0-darwin-arm64.tar.gz` → `9.6.0`)
2. Checks for version-level `cliTools` overrides in `databases.json` before falling back to engine-level `cliTools`
3. Collects all non-null binary names from those fields (skips `enhanced` tools)
4. For each archive (`.tar.gz` / `.zip`) in the release assets directory, extracts and searches for each required binary
5. Fails the build with clear error messages if any binary is missing

**Dependency-aware:** Some databases depend on others for client tools. For example, QuestDB lists `psql` as its client but depends on PostgreSQL — `psql` comes from the PostgreSQL install, not the QuestDB tarball. The script reads `dependencies` from `databases.json` (both top-level and per-version) and skips binaries provided by dependency databases.

**Name variant handling:** The script handles naming differences between `cli_tools` and actual binaries:
- Windows extensions: `.exe`, `.cmd`, `.bat`
- Hyphen-to-underscore: `typedb-console` → `typedb_console`, `typedb_console_bin`
- Searches recursively through the entire extracted archive (handles `bin/`, root, and custom paths like TypeDB's `server/` and `console/`)

**Currently used by:** All 21 release workflows. Added as a "Validate required binaries" step in each workflow's `release` job, positioned after artifact preparation and before "Create Release".
