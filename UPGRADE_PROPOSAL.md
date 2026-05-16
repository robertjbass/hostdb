# Version Upgrade Proposal — 2026-05-14

Drafted by Claude for Bob to review on return. Branch: `upgrade/versions`.

This proposal supersedes the March 11 audit in `UPGRADE_VERSIONS.md`. Six engines shipped security releases this week (PostgreSQL May 14, Redis May 5, Valkey May 6, MongoDB May 12, SQLite May 5, Meilisearch May 12), so the priority ordering has shifted.

**Companion docs:**
- `UPGRADE_PLAYBOOK.md` — long-term operator reference (reminders + technical deep-dive)
- `SIMPLIFICATION_IDEAS.md` — recommendations to reduce upgrade overhead in future cycles

---

## 1. How a version bump actually flows through the stack

I traced the contract end-to-end. The data flow is cleaner than I expected:

```
┌─── hostdb ────────────────────────────────────────────────────┐
│ databases.yml  →  databases.json  →  sources.json  →  R2     │
│ (source of    )    (generated   )    (binary URLs )   (CDN)  │
│  truth        )    (by `pnpm prep`)                          │
│                                                              │
│ + .github/workflows/release-{engine}.yml dropdown            │
│   (auto-synced by `pnpm sync:versions`)                      │
└──────────────────────────────────────────────────────────────┘
        ↓ binaries on R2: registry.layerbase.host/{tag}/{file}
        ↓ metadata: registry.layerbase.host/releases.json
┌─── spindb ────────────────────────────────────────────────────┐
│ engines/{engine}/version-maps.ts                             │
│   - VERSION_MAP: { '11.8' → '11.8.5', ... }                  │
│   - SUPPORTED_MAJOR_VERSIONS: ['10.11','11.4','11.8']        │
│                                                              │
│ config/engines.json                                          │
│   - supportedVersions: ['10.11.15','11.4.5','11.8.5']        │
│   - defaultVersion: '11.8.5'                                 │
│                                                              │
│ config/engine-defaults.ts                                    │
│   - latestVersion: '11.8'  (used for display)                │
│                                                              │
│ tests/integration/hostdb-sync.test.ts                        │
│   - validates VERSION_MAP values exist in releases.json      │
└──────────────────────────────────────────────────────────────┘
        ↓ at runtime, spindb create --db-version "11.8"
        ↓ normalizes → 11.8.5 → downloads from R2
┌─── layerbase-cloud ──────────────────────────────────────────┐
│ src/config/engine-registry.ts                                │
│   - supportedVersions: ['10.11','11.4','11.8']  (major.minor)│
│   - defaultVersion: '11.8'                                   │
│                                                              │
│ images/Dockerfile.universal  — engine-version-agnostic       │
│   (only ENV SPINDB_VERSION refers to spindb itself,          │
│    NOT to engine versions)                                   │
│                                                              │
│ images/entrypoints/{clickhouse,cockroachdb}.sh               │
│   - ENGINE-version default ONLY for these two,               │
│     overridable by SPINDB_VERSION env var per container      │
└──────────────────────────────────────────────────────────────┘
```

**Per-change-type cost matrix (this is the practical takeaway):**

| Change type | hostdb edits | spindb edits | cloud edits | CI work |
|---|---|---|---|---|
| **Patch bump same minor** (e.g. 11.8.5→11.8.6) | databases.yml + sources.json + run `pnpm prep` | version-maps.ts (value side only) | none | hostdb workflow build |
| **New minor same major** (e.g. add 11.9) | databases.yml + sources.json + prep | version-maps.ts + engines.json `supportedVersions` | engine-registry.ts `supportedVersions` | hostdb build + spindb test sync + cloud deploy |
| **New major / change defaultVersion** | same as above | + engine-defaults.ts `defaultVersion`/`latestVersion` + engines.json `defaultVersion` | + engine-registry.ts `defaultVersion` + entrypoint scripts if present | full stack |
| **Deprecation** | databases.yml `deprecated: true` only | hostdb-metadata exposes it; spindb already hides at UI layer | optional `supportedVersions` removal | hostdb workflow rerun, spindb test |

The cloud is reassuringly thin — patch bumps don't touch the cloud at all because the universal image downloads on demand and only carries major.minor in `engine-registry.ts`.

**Critical clarification on patch resolution** (often misunderstood): When the cloud passes `--db-version 11.8` to spindb, spindb's hardcoded `engines/<X>/version-maps.ts` MAP decides which patch to download. R2 hosts the bytes; spindb decides which bytes. So if R2 has both `11.8.5` and `11.8.6`, a container running spindb-with-MAP-says-`11.8.5` will download 11.8.5 — even if 11.8.6 is sitting there. For new patches to actually flow to users:
1. hostdb publishes the binary to R2 (done by `release-<engine>.yml` workflow).
2. spindb's MAP is updated and a new spindb is published to npm.
3. The cloud's universal Docker image is rebuilt with the new `SPINDB_VERSION` (in `images/Dockerfile.base`).

Skipping any of these three steps means the new patch is unreachable in cloud. See `UPGRADE_PLAYBOOK.md` §A2 and §B2 for the full traceback.

---

## 2. Verified upstream versions (as of 2026-05-14)

I cross-checked the March audit against today's upstream releases. Six engines shipped this week. Source: vendor release pages / GitHub releases, fetched today.

| Engine | Line | We host | Latest stable | Δ | Security? |
|---|---|---|---|---|---|
| **PostgreSQL** | 15 | 15.15.0 | **15.18** | +3 | YES — 11 CVEs across all lines, May 14 2026 |
| **PostgreSQL** | 16 | 16.11.0 | **16.14** | +3 | YES |
| **PostgreSQL** | 17 | 17.7.0 | **17.10** | +3 | YES |
| **PostgreSQL** | 18 | 18.1.0 | **18.4** | +3 | YES |
| **Redis** | 7.4 | 7.4.7 | **7.4.9** | +2 | YES — 5 RCE CVEs (CVE-2026-23479, 25243, 23631, 25588, 25589) |
| **Redis** | 8.x | 8.4.0 | **8.6.3** | new minor | YES (same CVE set) |
| **Valkey** | 8.0 | 8.0.6 | **8.0.9** | +3 | YES — CVE-2026-21863 unauthenticated cluster-bus DoS, plus same RCE set as Redis |
| **Valkey** | 9.0 | 9.0.1 | **9.0.4** | +3 | YES |
| **MongoDB** | 7.0 | 7.0.28 | **7.0.34** | +6 | YES — May 12 CVE drop |
| **MongoDB** | 8.0 | 8.0.17 | **8.0.23** | +6 | YES — CVE-2026-8053, 8199, 8200, 8201, 8202 |
| **MongoDB** | 8.2 | 8.2.3 | **8.2.9** | +6 | YES |
| **MariaDB** | 10.11 | 10.11.15 | **10.11.16** | +1 | Quarterly maintenance, Feb 6 2026 |
| **MariaDB** | 11.4 | 11.4.5 | **11.4.10** | +5 | Quarterly maintenance — **we are very behind** |
| **MariaDB** | 11.8 | 11.8.5 | **11.8.6** | +1 | Quarterly maintenance |
| **SQLite** | 3 | 3.51.2 | **3.53.1** | +2 minors | YES — 15-year-old WAL-reset corruption bug, confirmed; 3.52 was withdrawn, 3.53 absorbed it |
| **MySQL** | 8.4 | 8.4.3 | **8.4.9** | +6 | Quarterly CPU (Oracle security cadence) |
| **MySQL** | 9.x | 9.6.0 | **9.7.0 LTS** | new LTS designation | Oracle promoted 9.7 to LTS |
| **Meilisearch** | 1.x | 1.33.1 | **1.43.1** | +10 minors | YES — authenticated SSRF fix |
| **DuckDB** | 1.4 | 1.4.3 | **1.4.4** | +1 | bugfix |
| **DuckDB** | 1.5 | (new) | **1.5.2** | new minor | 1.4 marked maintenance, 1.5 is the active line |
| **TigerBeetle** | 0.16 | 0.16.70 | **0.17.4** | minor jump | safety/perf |
| **CockroachDB** | 25.4 | 25.4.2 | **25.4.10** | +8 | LTS designation reached |
| **SurrealDB** | 2.x | 2.3.2 | 3.0.5 | major | BSL-licensed, 3.x is breaking |
| **ClickHouse** | 25.12 | 25.12.3.21 | 26.x | new majors | 26.3 is the LTS in the new ladder |
| **Qdrant** | 1.x | 1.16.3 | 1.18.0 | +2 minors | removes deprecated search methods in 1.18 |
| **Weaviate** | 1.x | 1.35.7 | 1.36.13 | +1 minor | stability fixes |
| **QuestDB** | 9.x | 9.2.3 | 9.3.5 | +1 minor | feature |
| **InfluxDB** | 3.x | 3.8.0 | 3.9.0 | +1 minor | DataFusion 51 upgrade |
| **TypeDB** | 3.x | 3.8.0 | 3.10.4 | +2 minors | stats fixes |
| **PostgreSQL-DocumentDB** | 17 | 17-0.107.0 | 17-0.111.0 | +4 patches | follows FerretDB cadence |
| **CouchDB** | 3 | 3.5.1 | 3.5.1 | none | ✓ current |
| **FerretDB** | 1.x | 1.24.2 | 1.24.2 | none | ✓ frozen legacy |
| **FerretDB** | 2.x | 2.7.0 | 2.7.0 | none | ✓ current |
| **libSQL** | 0.24 | 0.24.32 | 0.24.32 | none | ⚠ no releases since Feb 2025 — upstream stalled |

> Note on libSQL: Turso has shifted focus to their newer Rust SQLite-compatible "Turso" project. `libsql-server` (sqld) has had no release in 15 months. We don't need to bump anything, but worth flagging as upstream-stale for future planning.

---

## 3. Recommended phasing

The user's production constraint is what drives the shape of this plan: deprecations cannot happen until replacements are live on layerbase-cloud. I'm splitting the work into three additive phases plus an optional cleanup phase.

### Phase 1 — Security patches (no schema-level changes anywhere) — DO FIRST

These are **pure patch additions inside the same minor line**. They add new entries to hostdb and update the value side of spindb's VERSION_MAP. **They do not require any cloud change** because the cloud only knows major.minor.

After Phase 1 is deployed and stable in cloud, you decide whether old patches are deprecated or simply left available.

| # | Engine | New version | Lines |
|---|---|---|---|
| 1 | PostgreSQL | 15.18 / 16.14 / 17.10 / 18.4 | all 4 |
| 2 | Redis | 7.4.9 | 7.4 line |
| 3 | Valkey | 8.0.9 / 9.0.4 | both |
| 4 | MongoDB | 7.0.34 / 8.0.23 / 8.2.9 | all 3 |
| 5 | MariaDB | 10.11.16 / 11.4.10 / 11.8.6 | all 3 |
| 6 | SQLite | 3.53.1 | replaces 3.51.2 (no major change, just a higher minor) |
| 7 | Meilisearch | 1.43.1 | (10-minor jump but no API breakage in 1.x line, and the SSRF fix is in here) |
| 8 | MySQL | 8.4.9 | 8.4 LTS line only (defer 9.7 to Phase 2) |
| 9 | DuckDB | 1.4.4 | 1.4 maintenance line only (defer 1.5 to Phase 2) |

**Touched files for each row in Phase 1:**
- `databases.yml` — add new version key `true`
- `builds/{engine}/sources.json` — add URLs/checksums for 5 platforms
- Run `pnpm prep` — regenerates databases.json + syncs workflow dropdown + populates SHA256s
- Trigger `.github/workflows/release-{engine}.yml` per platform via `workflow_dispatch`
- After release: `releases.json` auto-updated by `update-releases` job
- spindb side: update `engines/{engine}/version-maps.ts` to point major→latest patch, add identity mapping, leave previous patches in place for backward compatibility (existing containers must keep working)
- spindb side: bump version, run `pnpm test:hostdb-sync` to verify, ship
- cloud side: **no changes needed** — `engine-registry.ts` still says `'11.8'` etc.

Phase 1 has **zero deprecations** and is purely additive. If any single engine fails it doesn't block the others. This is the safest possible upgrade batch.

### Phase 2 — New minor lines and feature bumps — DO ONLY AFTER PHASE 1 IS LIVE IN PROD

These add new minor.major tracks alongside existing ones. They require cloud changes because the cloud's `supportedVersions` list expands.

| # | Engine | Add | Rationale |
|---|---|---|---|
| 1 | DuckDB | 1.5.2 | DuckDB 1.4 is now maintenance; 1.5 is the active line. Keep 1.4 for compatibility, add 1.5 as a parallel offering. |
| 2 | Redis | 8.6.3 | New active minor in 8.x. 8.4.0 is stale (3 minors behind). |
| 3 | Valkey | 8.1.7 | Active intermediate line between 8.0 and 9.0. Optional — could skip if 8.0 + 9.0 coverage is enough. |
| 4 | MySQL | 9.7.0 | Oracle promoted 9.7 to LTS. Add it; do not deprecate 9.6 yet — it's still recent. |
| 5 | Qdrant | 1.18.0 | Includes breaking changes (removed deprecated search methods). Add as new track. |
| 6 | Weaviate | 1.36.13 | Stability fixes; should be safe additive. |
| 7 | InfluxDB | 3.9.0 | DataFusion 51 upgrade. |
| 8 | QuestDB | 9.3.5 | Feature minor. |
| 9 | TypeDB | 3.10.4 | Stats fixes; minor jump within 3.x. |
| 10 | PostgreSQL-DocumentDB | 17-0.111.0 | Tracks FerretDB; safe to bump in place because FerretDB 2.7.0 supports both 0.107 and 0.111. |
| 11 | TigerBeetle | 0.17.4 | 0.16 → 0.17 is a minor-level jump for TigerBeetle's versioning style. |
| 12 | CockroachDB | 25.4.10 | Same major.minor as current (25.4), so this is actually Phase-1-style — could be moved earlier. |

**Cloud changes per row:** Add the new major.minor to `supportedVersions` in `src/config/engine-registry.ts`. No `defaultVersion` change in Phase 2 — defaults stay where they are until users are migrated.

### Phase 3 — Major version additions and deprecations — DO ONLY AFTER PHASES 1+2 ARE STABLE

These are the higher-risk changes. Each one needs its own validation pass.

| # | Engine | Change | Notes |
|---|---|---|---|
| 1 | ClickHouse | Add 26.3 LTS | Current 25.12 stays. 26.3 is the new LTS in ClickHouse's monthly-train naming scheme. **ClickHouse has no Windows support** — 4 platforms only (linux-x64/arm64, darwin-x64/arm64). Don't add `win32-x64` to `platforms` or `sources.json`. |
| 2 | SurrealDB | Add 3.0.5; consider deprecating 2.3.2 | 3.x is a major break. Add first, deprecate later only after layerbase-cloud customers are migrated. |
| 3 | MariaDB | Consider adding 12.2.2 GA | Rolling release series; only worth it if user demand is high. The three LTS lines (10.11/11.4/11.8) are likely sufficient for production. |
| 4 | Redis 7.4 | Consider deprecating after Nov 2026 EOL | Not now. |
| 5 | MySQL 9.6 | Eventual deprecation now that 9.7 LTS exists | Not Phase 2, Phase 3+. |

### Phase 4 — Optional cleanup (post-deprecation)

After deprecations are live, no other action is needed — deprecated binaries remain downloadable forever from R2. SpinDB's UI hides them. No churn.

---

## 4. Risk and test impact

**hostdb tests:** None — hostdb's CI is the build-and-publish workflows themselves. The "test" is that `validate-binaries.sh` passes on each archive (already runs in every workflow).

**spindb tests:**
- `tests/integration/hostdb-sync.test.ts` — verifies every value in every VERSION_MAP exists in releases.json. **This is the canary.** As soon as new versions are published to R2, this test will pass. It needs network access (CI must reach `registry.layerbase.host`).
- `tests/unit/{engine}-version-validator.test.ts` — many of these have hardcoded version strings in assertions (e.g., `assert(isVersionSupported('3.5.1'))`). For Phase 1 patch bumps, these tests **mostly continue to pass** because we're adding versions, not removing. Some assertions like `isVersionSupported('2.7.0')` for `influxdb` (checking a NON-supported version returns false) are fragile if we ever started supporting that version. I spot-checked and Phase 1 doesn't trip any of them.
- `tests/unit/engines-registry.test.ts` and `tests/unit/version-migration.test.ts` — schema-level, should be unaffected by additive version changes.

**layerbase-cloud tests:** No version-string assertions found in cloud's test files for engines I sampled. The cloud's `engine-registry.ts` is the source of truth and adding to `supportedVersions` is additive.

**Production risk profile:**
- Phase 1 is **lowest risk** because nothing in cloud changes. Existing containers keep their pinned version. New containers can opt into the new patch by passing the higher number, but the default major.minor still resolves to its old patch until spindb's VERSION_MAP swings the pointer.
- The migration moment is when spindb's VERSION_MAP changes `'11.8' → '11.8.6'` (was `'11.8' → '11.8.5'`). Any new `spindb create --db-version 11.8` will download 11.8.6 from R2. Existing containers don't restart.
- Cloud deploys spindb as a Docker `ENV SPINDB_VERSION`. So the moment cloud bumps spindb, new user containers will pick the new patches. **Once the cloud image is rebuilt with the new spindb version, the bump is live for all new database creations.**

**Rollback strategy:** If a patch turns out broken in prod, you can either:
1. Revert spindb's VERSION_MAP pointer (`'11.8' → '11.8.6'` back to `'11.8.5'`) — fastest fix because R2 retains both binaries.
2. Mark the bad version `deprecated: true` in hostdb's databases.yml — slower, but more durable.

---

## 5. Should we merge hostdb into spindb?

**Recommendation: no — but finish the hostdb-as-data-package idea.**

The two repos do completely different things on completely different cadences:
- **hostdb** is a build pipeline. Its CI is heavy (Docker builds, QEMU emulation for ARM64, native macOS runners, EDB Windows downloads, R2 uploads, Cloudflare cache purges). A single PostgreSQL build run can take 30-60 minutes. The workload fires only when versions update (~monthly).
- **spindb** is a runtime CLI. Its CI is lightweight (`tsc --noEmit`, unit tests, fast integration). It's released continuously (24+ versions this year alone).

Merging means every spindb commit drags hostdb's 21 release workflows along, or you'd be filtering paths in workflows — at which point you've recreated the two-repo split with worse ergonomics.

The actual pain point is **manual sync** of spindb's `version-maps.ts` against hostdb's `releases.json`. The comments in those version-maps even say so:

```ts
// TEMPORARY: This version map will be replaced by the hostdb npm package once published.
```

That's the right direction. Concrete recommendation:

1. Keep the repos separate.
2. Publish hostdb's `databases.json` and `releases.json` as a small `@layerbase/hostdb-registry` npm package (already half-set-up — hostdb's package.json has `"files": ["...","databases.json","releases.json","downloads.json"]`).
3. spindb imports it at build time. The `version-maps.ts` files become trivial wrappers that read the imported JSON.
4. `tests/integration/hostdb-sync.test.ts` becomes a smoke test rather than a critical sync gate, because the npm package guarantees consistency.

This removes the manual sync burden without conflating two pipelines with different shapes.

---

## 6. Goal-mode kickoff prompt

When you come back to switch me into goal mode, paste this prompt verbatim — it's self-contained.

> Execute Phase 1 of the upgrade plan in `/Users/bob/dev/hostdb/UPGRADE_PROPOSAL.md`. Work bottom-up, one engine at a time, in this order so easy wins are unblocked first: SQLite (single binary), Meilisearch (single binary), Redis, Valkey, MariaDB, MongoDB, MySQL, DuckDB, PostgreSQL.
>
> For each engine:
> 1. Update `databases.yml` to add the new version(s) as `true`. Leave old versions in place.
> 2. Update `builds/{engine}/sources.json` with new URLs and checksums. Use `pnpm checksums:populate {engine}` for SHA-256 auto-population.
> 3. Run `pnpm prep` to regenerate `databases.json` and sync workflow dropdowns.
> 4. Commit (conventional commit format, NO AI attribution).
> 5. Push and trigger the release workflow via `gh workflow run release-{engine}.yml --field version={X} --field platforms=all`.
> 6. Wait for the build to finish (`gh run watch`). On failure, investigate, fix, retry.
> 7. Once `releases.json` reflects the new version, switch to `~/dev/spindb`:
>    - Update `engines/{engine}/version-maps.ts` (add new version, update major.minor pointer).
>    - Run `pnpm test:hostdb-sync` and `pnpm test:unit` to confirm.
>    - Commit; do not bump spindb version yet — batch all engines into one spindb version bump at the end.
> 8. Move to the next engine.
>
> After all Phase 1 engines are uploaded and `releases.json` reflects them:
> - Bump spindb's package.json to the next minor (since this is a behavior change).
> - Update spindb CHANGELOG.md with a one-line entry per engine bump.
> - Open a PR from `upgrade/versions` (or current branch) to `main` on spindb. Merge after CI green.
> - npm publish happens automatically via OIDC workflow on merge.
> - Then in `~/dev/layerbase-cloud`: update `images/Dockerfile.base` `ARG SPINDB_VERSION=<new>`. Commit, push to main. CI rebuilds the universal image and rolls servers.
> - Verify in prod by provisioning a test container via the cloud API and confirming `spindb info` reports the new patch version.
>
> Hard rules:
> - Never run destructive git operations without asking.
> - Never deprecate any version yet. This phase is purely additive.
> - If a single engine's release workflow fails twice in a row, skip it and continue. Note it in a "Phase 1 blockers" section in this file.
> - When uncertain about a checksum or platform availability, prefer to skip that platform rather than guess.
> - **ClickHouse is not in Phase 1.** When you do touch it later (Phase 3), remember it has no Windows binary — `platforms` arrays must not include `win32-x64`.
> - Update `UPGRADE_PLAYBOOK.md` Part C (Maintenance ledger) at the end of the sweep with a one-line entry recording what was changed.
>
> ## Goal completion criteria
>
> The goal is **fully complete** when ALL of the following are true:
> 1. Every engine in Phase 1's table above has its new versions live on R2 (verify by querying `releases.json` at `registry.layerbase.host/releases.json`).
> 2. spindb's `engines/<X>/version-maps.ts` repoints each engine's major.minor key to the new patch and has identity mappings for the new full versions.
> 3. `pnpm test:hostdb-sync` and `pnpm test:unit` pass in spindb.
> 4. spindb's version is bumped, CHANGELOG updated, PR merged to main, npm publish succeeded.
> 5. layerbase-cloud's `Dockerfile.base` has the new `SPINDB_VERSION`, the universal image rebuild is green, and deploy.yml has rolled to all servers.
> 6. A provisioned cloud test database (PostgreSQL 18 is a good representative) reports the new patch via `spindb info`.
>
> If any engine fails to publish to R2 after a second retry, note it in this proposal under a "Phase 1 blockers" heading and proceed without it — partial completion is OK, total stall is not.
