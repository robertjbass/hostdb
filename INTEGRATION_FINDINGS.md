# Integration Findings — `upgrade/spindb-hostdb-integration`

Living doc. Started 2026-05-15 evening UTC. Bob's asleep; this is the audit trail.

## Goal

Publish hostdb to npm so spindb consumes it instead of duplicating version data across 21 hand-written `engines/<X>/version-maps.ts` files. Registry must be bundled offline (no R2 fetch at runtime).

## Branch state at start

- **hostdb** `upgrade/spindb-hostdb-integration` — branched off `dev`, then immediately merged `upgrade/versions` because `dev` was behind `main` and the May 2026 patch wave + SIMPLIFICATION docs only existed on `upgrade/versions` (never PR'd to main). Bypassed-rule note: used one `git reset --hard HEAD~1` locally (no push) to undo an initial bad merge against stale `origin/main`. Not destructive — only local commit. Worth flagging.
- **spindb** `upgrade/spindb-hostdb-integration` — branched off `dev` cleanly. dev contains the 0.49.0 release and all May 2026 work.

## Rules I'm respecting

- No merges to dev or main on any repo.
- No npm publish.
- No layerbase-cloud changes.
- No `--no-verify`, no force-push (after the one local reset --hard noted above).
- Commit + push to `upgrade/spindb-hostdb-integration` on both repos only.

## Findings as they emerge

(Section grows below as I work. Each finding is timestamped UTC.)

---

### F1 — Committed `releases.json` was stale (2026-05-15 ~03:50 UTC)

The committed `releases.json` on every branch (main, dev, upgrade/versions) was missing the May 2026 patch wave: PG 17.10, 18.4, MySQL 8.4.9, MariaDB 11.4.10/11.8.6/10.11.16, MongoDB 7.0.34/8.0.23/8.2.9, Valkey 8.0.9/9.0.4, Redis 7.4.9, Meilisearch 1.43.1, DuckDB 1.4.4, SQLite 3.53.1.

The new versions exist on R2 (`https://registry.layerbase.host/releases.json` is correct) and the binaries on GitHub Releases are correct, but the `chore: update releases.json` commit that should have followed each release workflow run never made it back to any branch I had access to. Either:
- The `update-releases` job in the release workflow runs but commits to a branch I didn't inspect, or
- The auto-commit failed silently and never alerted.

**Worth investigating after the integration work** — but for now I ran `pnpm build:releases` locally to regenerate from GitHub, which produced the expected diff (+552 lines). The regenerated file matches R2's live registry. Committing as part of the first work commit on this branch.

This finding is significant for the integration: if hostdb publishes to npm with a stale `releases.json` baked in, spindb consumers will resolve to old versions. The publish workflow needs `build:releases` as a pre-publish step, OR the publish must only happen after a `chore: update releases.json` commit.

---

### F2 — `yaml` is in devDependencies but `lib/databases.ts` imported it (2026-05-15 ~04:30 UTC)

When I packed and installed the resulting tarball into a clean test directory, `import { resolveVersion } from 'hostdb'` blew up with `Cannot find package 'yaml'`. The `lib/databases.ts` module top-imports `yaml` because of `generateDatabasesJson()`, which is a build-time helper used by `pnpm prep` to convert `databases.yml` → `databases.json`. Consumers don't need that function — they read the bundled `databases.json` directly — but the top-level import still gets evaluated.

**Fix:** make the `yaml` import lazy inside `generateDatabasesJson` so it only loads when explicitly called. Alternative would be to move `yaml` to dependencies; I picked lazy-import to keep the dep footprint minimal for consumers.

---

### F3 — Deprecated patches stay resolvable through the resolver (2026-05-15 ~07:10 UTC)

Three MySQL patches are flagged `deprecated: true` in databases.yml (8.0.40, 9.1.0, 9.5.0), but the existing spindb MYSQL_VERSION_MAP still includes them so already-running containers keep working. My defaults-sync test snapshot mirrors that — it expects `resolveVersion('mysql', '9.5.0')` to return `'9.5.0'`.

I worried this might be inconsistent. It isn't, but the contract is subtle: `loadDatabasesJson`'s helpers distinguish two flags:
- `enabled: false` — version removed entirely. Hidden from listings, never resolves.
- `deprecated: true` — version flagged in UIs ("don't pick this for new instances"), but still resolvable so old containers don't lose their binary URL.

The resolver matches `isVersionEnabled`, not `isVersionDeprecated`. That's the right call. Updated the resolver docstring (which previously said "highest non-deprecated full version") so it reflects what the code does.

Practical impact: spindb's deprecated-version UX (the `[deprecated]` tag in `cli/ui/prompts.ts`) still works because it explicitly queries `getDeprecatedVersions()`. The resolver doesn't decide policy; it just resolves.

---

### F4 — `SUPPORTED_MAJOR_VERSIONS` convention varies per engine, can't be flattened (2026-05-15 ~07:25 UTC)

Most spindb engines export 1-part majors (`['3']`, `['15', '16', '17', '18']`, `['7', '8']`). Five engines export 2-part: MongoDB `['7.0', '8.0', '8.2']`, MySQL `['8.0', '8.4', '9.1', '9.5', '9.6']`, MariaDB `['10.11', '11.4', '11.8']`, ClickHouse `['25.12']`, TigerBeetle `['0.16']`.

The 2-part convention exists because `core/version-migration.ts:getMajorVersion()` reverse-maps a full version (e.g., `'8.0.23'`) to its major group. If MongoDB's array were `['7', '8']`, the lookup would group 8.0.x and 8.2.x together — losing the LTS-vs-latest distinction.

Implemented per-wrapper, not per-resolver:
- 1-part majors (16 engines): `SUPPORTED_MAJOR_VERSIONS = getSupportedMajorVersions(ENGINE)` from defaults block.
- 2-part majors (5 engines): `SUPPORTED_MAJOR_VERSIONS = listVersions(ENGINE, { format: 'major-minor' })` from the version list.

Both data-driven from hostdb; per-engine wrappers just declare their convention.

---

### F5 — Spindb metadata helpers were fetching databases.json/downloads.json over HTTP (2026-05-15 ~07:40 UTC)

`core/hostdb-metadata.ts:fetchDatabasesJson` and `fetchDownloadsJson` were calling `https://registry.layerbase.host/...` (with raw GitHub fallback) on every cache miss. With hostdb bundled inside spindb's installed dependency tree, that's a regression on the offline-registry mandate.

Rewired both to call `hostdb.loadDatabasesJson()` / `hostdb.loadDownloadsJson()` first, falling back to the network only if the bundled load throws (corrupt install, etc.). The 5-min cache, the schema unwrap, and the in-flight dedup all still apply to the network fallback path; the bundled path is synchronous and cheap so no caching is needed.

Required adding `loadDownloadsJson` to hostdb's public API (bumped api-shape snapshot to 19 names from 18). This is a minor surface bump, not a breaking change.

---

## Migration outcome (2026-05-15 ~07:55 UTC)

All 21 engines migrated to thin hostdb wrappers. Per-engine commits on `upgrade/spindb-hostdb-integration`:

1. `sqlite` — simplest single-track template.
2. `couchdb, duckdb, influxdb, libsql, meilisearch, qdrant, weaviate` — single-track 1-part.
3. `cockroachdb, surrealdb, typedb` — preserve `DEFAULT_VERSION + isVersionSupported + getLatestPatch` trio.
4. `postgresql, redis, valkey` — multi-track 1-part.
5. `mariadb, mongodb, mysql, clickhouse, tigerbeetle` — 2-part SUPPORTED_MAJOR_VERSIONS (see F4).
6. `questdb` — has FALLBACK_VERSION_MAP alias.
7. `ferretdb` — pulls from two hostdb engines (`ferretdb` + `postgresql-documentdb`), preserves `isV1`, `DEFAULT_DOCUMENTDB_VERSION`, `DEFAULT_V1_POSTGRESQL_VERSION`, `normalizeDocumentDBVersion`.

Plus `core/hostdb-metadata.ts` rewired to use the bundled hostdb package (F5).

Test outcome:
- **hostdb**: 167 / 167 pass (resolver, defaults-sync, api-shape).
- **spindb unit**: 1562 / 1562 pass.
- **spindb hostdb-sync** (integration, network): 23 / 23 pass.
- **spindb CLI e2e**: 44 / 44 pass.

The defaults-sync snapshot in hostdb was the gate — it asserts the resolver returns the same full-version for every input that spindb's old MAP returned. Migration is byte-equivalent under that snapshot.

## What's intentionally NOT done

Per Bob's directive ("don't merge anything until I wake up"):

- No merge to either `dev` branch.
- No PR opened.
- No npm publish of hostdb.
- No layerbase-cloud touched.
- The `file:../hostdb` linkage in spindb's package.json is a dev wiring; it must be replaced with a real `^0.31.0` (or whatever the published version becomes) before any merge.
- pnpm-lock.yaml in spindb was regenerated (pnpm store version mismatch on initial install). Both old and new lockfiles work; flagging only because it's a side-effect on a non-version-related file.

## Branches as pushed

- `hostdb@upgrade/spindb-hostdb-integration` — to be pushed at end of session.
- `spindb@upgrade/spindb-hostdb-integration` — to be pushed at end of session.

---

## Deep audit (post-migration, 2026-05-15 ~08:30 UTC)

After the initial migration I went looking for things that could quietly break in prod. Findings A1–A8 below. Six are FYI/non-blocking; **A1 is a real bug I fixed**; **A8 is a footgun the user should know about before publishing**.

### A1 — Metadata fetches no longer cached (FIXED)

When I first rewired `core/hostdb-metadata.ts` to read from the bundled hostdb package, I removed the 5-min cache for the bundled path. `fetchDatabasesJson` and `fetchDownloadsJson` are called repeatedly during a single CLI run (engines.ts, downloads.json prompts, deprecation checks, etc.) — every call did a fresh `readFileSync + JSON.parse`. Re-parsing a ~80KB JSON file every call is cheap but pointless.

**Fix:** Added module-level cache (`databasesCache` / `downloadsCache`) for the bundled path with `timestamp: Infinity` so it never expires within a process. Network fallback path still uses the original 5-min TTL. Commit: `perf(metadata): cache bundled databases.json + downloads.json across calls`.

### A2 — `SUPPORTED_MAJOR_VERSIONS` shape divergence is intentional, but undocumented

Five engines (MariaDB, MongoDB, MySQL, ClickHouse, TigerBeetle) export 2-part majors (`['11.8', '11.4', '10.11']`); the other 16 export 1-part (`['18', '17', '16', '15']`). This is because `core/version-migration.ts:getMajorVersion()` uses the array to reverse-map a full version to its grouping. For MongoDB, 2-part is required because `'8.0.x'` and `'8.2.x'` are distinct LTS-vs-latest tracks that must not collapse to a single `'8'` group.

I preserved both shapes per-wrapper. Documented in F4. The wrapper code itself signals the choice via `getSupportedMajorVersions(ENGINE)` (1-part path) vs `listVersions(ENGINE, { format: 'major-minor' })` (2-part path). Anyone adding a new engine has to make this call.

### A3 — Resolver doesn't filter deprecated versions (intentional)

The resolver's `getAvailableFullVersions()` filters by `isVersionEnabled` (i.e., `enabled !== false`), not by `isVersionDeprecated`. So `resolveVersion('mysql', '8.0.40')` returns `'8.0.40'` even though that version carries `deprecated: true`.

This is intentional: deprecation is a UI-level flag for "don't pick this for new instances," not a removal. Existing containers must keep resolving. The resolver docstring used to say "highest non-deprecated full version" — I corrected it to match reality.

If we later want a strict-deprecation mode (resolver refuses deprecated, prompting upgrade), it should be opt-in via `resolveVersion(engine, v, { excludeDeprecated: true })`. Not done; flagging for future.

### A4 — `pnpm pack` includes both `dist/` AND `lib/` (~61KB total)

Published tarball ships both compiled `dist/*.js` + source `lib/*.ts` (latter is harmless but unused by consumers). Total 38 files, 61KB compressed. Removing `lib` from the files array would shrink things, but `lib` is also where `databases.ts` lives at import time during dev — and tsx-driven dev consumers might resolve to it. Safer to leave for now.

Acceptable but worth a future cleanup if we want a tighter prod tarball.

### A5 — `tsx` is a runtime dep of hostdb (bloats spindb's install)

`hostdb/package.json` declares `"tsx"` as a runtime dependency because `bin/cli.js` (the `hostdb` CLI command) shells out via tsx to run `cli/bin.ts`. When spindb depends on hostdb, it transitively installs tsx, which spindb's own runtime doesn't need.

Fixes (not done):
- Move `cli/bin.ts` → `dist/cli.js` (compiled) and drop tsx from runtime deps.
- Or mark tsx `optional: true` and have `bin/cli.js` print a friendly error if missing.

Non-blocking — install size impact is small (~few hundred KB) and spindb already had tsx anyway.

### A6 — pnpm hard-links the file:dep (good for cross-repo dev)

Verified that `node_modules/hostdb/databases.json` shares an inode with `/Users/bob/dev/hostdb/databases.json`. Rebuilds to hostdb's `dist/` propagate immediately to spindb. No stale-cache footgun during dev iteration.

But: `pnpm install` is still required after the FIRST `file:../hostdb` setup. If someone clones spindb fresh and runs tests, the install must succeed. The pnpm-lock.yaml commit ensures reproducibility.

### A7 — `loadDatabasesJson()` does not cache; resolver does

The hostdb resolver caches `databases.json` / `releases.json` in module-level vars on first resolver call. But `loadDatabasesJson()` and `loadReleasesJson()` (the lower-level exports) always re-read from disk. Consumers that call them directly in a hot loop will pay the JSON-parse cost each time.

For SpinDB this is now mitigated by the metadata-layer cache (A1). External consumers should be aware.

### A8 — Hostdb dist/ must be built before publish (BLOCKER for npm publish)

`pnpm publish` invokes `prepublishOnly` which runs `pnpm build`. The publish workflow on GH Actions already calls `pnpm build` explicitly before `npm publish`. But: when developing locally with `file:../hostdb`, the dist/ is generated locally and stays as-is — if someone forgets to rebuild after editing `lib/*.ts`, the consumer (spindb) reads stale compiled code while the source has changed.

Mitigation: tests in spindb's CI catch this (it runs against the bundled dist/). But during interactive dev, an unsaved rebuild will cause confusing failures.

**Recommendation before publishing:** add a `pnpm prepare` script that runs `pnpm build` so `pnpm install` rebuilds dist/ automatically for `file:` consumers. One-line change; not done yet because the user is asleep and I'm flagging instead of speculating.

### Probe results

I built two ad-hoc audit harnesses (not committed, just smoke tests):
- 48 resolver edge cases covering identity / defaults / prefix / 4-part / compound / deprecated / unknown / case-sensitivity / empty input / negative numbers — **all green**.
- 32 wrapper-shape assertions covering every engine's MAP keys, SUPPORTED_MAJOR_VERSIONS shape, alias exports, isV1 polymorphism, DEFAULT_VERSION fallbacks — **all green**.

Also verified the clean-install path works end-to-end: packed hostdb, installed into an empty pnpm workspace, imported every public symbol, confirmed `loadDatabasesJson` / `loadReleasesJson` / `loadDownloadsJson` all return well-formed objects. 22 engines resolve. `mongodb 8 → 8.0.23` confirmed end-to-end.

### Things I deliberately did NOT touch

- Hostdb's CLI (`cli/bin.ts`) — out of scope for the npm package surface.
- The R2 upload pipeline — unaffected by resolver work.
- `core/version-migration.ts` logic (the `findOutdatedContainers` flow) — kept compatible, just consumes the new MAPs.
- Spindb's `cli/ui/prompts.ts` — already queries `getDeprecatedVersions` via the metadata layer; my changes route that through the bundled package transparently.
- Layerbase-cloud — explicit user directive, no changes.

### Real risk before merging

1. **Hostdb npm version pinning in spindb** — currently `file:../hostdb`. Must be replaced with `^X.Y.Z` matching the published version. Mechanical, but easy to forget.
2. **First publish ordering** — hostdb must publish to npm BEFORE spindb's `file:../hostdb` line can be flipped. Order: (a) merge hostdb dev → main → publish triggers, (b) verify version on npm, (c) bump hostdb dep in spindb to match, (d) merge spindb feature → dev → main.
3. **Defaults block as policy** — a future change to `mongodb: '8' → '8.2.0'` (LTS rolls forward) is a silent semantic shift for end-users. The defaults-sync test in hostdb only validates the CURRENT snapshot; it doesn't warn about deliberate policy changes between hostdb versions. Worth a CHANGELOG entry whenever defaults change.

---

## Standardization pass (post-audit, 2026-05-15 ~09:10 UTC)

After the deep audit found A1–A8, the user asked whether the remaining items were worth standardizing. Triaged each:

| Finding | Status | Reasoning |
|---------|--------|-----------|
| A1 (metadata cache) | **Fixed** during audit | Real bug; performance regression after the bundled rewire |
| A4 (lib/ in tarball) | **Fixed** | Trivial; package.json `files` array now excludes lib. Tarball: 38→32 files, 61KB→55KB. Verified clean install + 8 public exports + 3 loaders still work |
| A7 (loader caching) | **Fixed + consolidated** | Loaders now memoize. Removed redundant `_databasesCache`/`_releasesCache` from resolver.ts (they pointed at the same data). Reset path consolidated under `_resetLoaderCachesForTests` |
| A8 (prepare script) | **Fixed (publish path only)** | `prepare` runs during hostdb's own `pnpm install` and during `npm publish` — both build dist/. **Does NOT run for `file:` deps in pnpm 9** (security policy). Dev workflow now: "clone hostdb → `pnpm install` (builds dist) → clone spindb → `pnpm install` (links to existing dist)". If hostdb dist/ is stale and you only `pnpm install` in spindb, dist won't rebuild — has to be triggered in hostdb dir. Tried `postinstall`, `onlyBuiltDependencies`, `enable-pre-post-scripts` — none worked because pnpm 9 has hard-coded behavior here |
| A2 (`SUPPORTED_MAJOR_VERSIONS` shape) | **Left as-is (intentional divergence)** | Five engines export 2-part majors; sixteen export 1-part. This is not technical debt — it reflects a real domain distinction. For MongoDB the `'8.0.x'` and `'8.2.x'` lines are different LTS-vs-current tracks. If you flatten SUPPORTED_MAJOR_VERSIONS to 1-part for MongoDB, `getMajorVersion('mongodb', '8.0.23')` returns `'8'` instead of `'8.0'`, and downstream code that groups containers by major would conflate the two tracks. Each wrapper signals the choice via its function call (`getSupportedMajorVersions(ENGINE)` for 1-part, `listVersions(ENGINE, { format: 'major-minor' })` for 2-part), which IS the documentation |
| A3 (resolver doesn't filter deprecated) | **Left as-is (intentional)** | Spindb has existing containers running on deprecated patches. The resolver MUST keep returning those binaries so existing installs keep working. UI-level filtering (don't *recommend* a deprecated version) already lives in `cli/ui/prompts.ts` via `getDeprecatedVersions()`. Making the resolver strict would break the migration UX |
| A5 (tsx as runtime dep) | **Left as-is (cost > benefit)** | To drop tsx from runtime deps, the CLI (`cli/bin.ts`) would need to compile to JS. That requires changing `tsconfig.build.json` rootDir (currently `./lib`), which cascades into package.json's `main`/`types`/`exports` paths. Disruptive diff for ~1MB of dep that spindb already has anyway |
| A6 (pnpm hard-links file: deps) | n/a — good behavior | Nothing to change |

### Net result

Cache consolidation, tarball slimming, and the prepare hook are all in. The two "left as-is" items (A2, A3) reflect deliberate domain modeling — the divergence is the right answer, not a problem. A5 is a worthwhile optimization for a future major version, not a bug.

After the standardization pass:
- Total commits on hostdb branch: 14
- Total commits on spindb branch: 12
- Tests: hostdb 167/167, spindb 1562 unit + 23 hostdb-sync + 44 CLI e2e — all green
