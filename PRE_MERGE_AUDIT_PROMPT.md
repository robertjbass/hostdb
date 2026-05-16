# Pre-merge audit prompt

> Feed this prompt to a fresh agent session (or a human reviewer) to independently audit the `upgrade/spindb-hostdb-integration` branches before merging. The agent should have local clones of `hostdb`, `spindb`, `layerbase-cloud`, and `layerbase-desktop` at `~/dev/`.

---

## Your job

You are auditing a cross-repo refactor that is about to merge. The branches under review:

| Repo | Branch | Status |
|---|---|---|
| `~/dev/hostdb` | `upgrade/spindb-hostdb-integration` | ~22 commits ahead of `dev` |
| `~/dev/spindb` | `upgrade/spindb-hostdb-integration` | ~18 commits ahead of `dev` |
| `~/dev/layerbase-cloud` | `docs/hostdb-integration-coordination` | doc-only, ahead of `dev` |
| `~/dev/layerbase-desktop` | `docs/hostdb-integration-notes` | doc-only, ahead of `main` |

The maintainer is responsible for **five repositories** in production. One of them (`layerbase-cloud`) hosts prod databases. Your audit needs to be paranoid. A wrong call here can corrupt user data or break production. **Assume nothing.**

## What the refactor does (read this first)

Pre-refactor: `hostdb` was a build pipeline for database binaries hosted on Cloudflare R2. `spindb` hand-maintained `engines/<X>/version-maps.ts` files (21 of them) that had to be kept in sync with hostdb's `databases.json` by hand. The MAPs drifted over time and that drift was a real source of bugs.

Post-refactor: `hostdb` is now also a **published npm package** that bundles its registry (`databases.json` + `releases.json` + `downloads.json`) inside the tarball. Consumers (spindb, layerbase-cloud, layerbase-desktop) install `hostdb` as a normal npm dep with an **exact version pin** (`"hostdb": "0.31.0"` — no caret, no tilde). spindb's `engines/<X>/version-maps.ts` files are now **thin wrappers** that build their legacy exports at module-load time by calling `hostdb`'s typed resolver API. No more hand-maintained MAPs.

Read these in order, then start the audit:

1. `~/dev/hostdb/INTEGRATION_FINDINGS.md` — full audit trail with findings F1–F5 (issues found and fixed during integration) and A1–A14 (post-migration audit findings).
2. `~/dev/hostdb/UPGRADE_PLAYBOOK.md` — operator-facing playbook for the post-integration upgrade flow.
3. `~/dev/hostdb/CLAUDE.md` — the "Coordination rules — do not break these" section is the critical bit.
4. `~/dev/spindb/CLAUDE.md` — `hostdb npm Package & Pinning Strategy` section + `Container version pinning` section.

## Things you specifically need to verify

### A. The wrappers actually do the right thing

For every engine in `~/dev/spindb/engines/*/version-maps.ts`:

- Confirm the file imports `resolveVersion`, `getSupportedMajorVersions`, `listVersions` from `'hostdb'` (NOT from a relative path).
- Confirm `<ENGINE>_VERSION_MAP` is built from `buildVersionMap()` (a function that calls the hostdb resolver), not a static literal.
- Confirm `SUPPORTED_MAJOR_VERSIONS` is sourced from either `getSupportedMajorVersions(ENGINE)` (1-part majors) or `listVersions(ENGINE, { format: 'major-minor' })` (2-part majors).
- For the 5 engines that use 2-part (MariaDB, MongoDB, MySQL, ClickHouse, TigerBeetle), verify the 2-part choice is intentional — `core/version-migration.ts:getMajorVersion()` requires that shape to correctly group LTS-vs-current tracks. Flattening MongoDB to `['7', '8']` would conflate 8.0.x (LTS) with 8.2.x.
- For FerretDB, confirm it imports BOTH `ferretdb` AND `postgresql-documentdb` engine data (it's a dual-engine wrapper).

For each wrapper, run a smoke test: import the public exports in a Node REPL, verify `<ENGINE>_VERSION_MAP[<known-major>]` returns the expected full version. Spot-check ~5 random engines.

### B. The exact-pin invariant is documented AND enforceable

- Confirm `~/dev/spindb/CLAUDE.md` says exact pin, no caret/tilde, with rationale.
- Confirm `~/dev/hostdb/CLAUDE.md` says the same in its "Coordination rules" section.
- Confirm the persistent memories at `~/.claude/projects/-Users-bob-dev-hostdb/memory/hostdb-exact-pin.md` exist. **Note:** these are local-only; the maintainer uses 3 different computers. The actual durable enforcement is the CLAUDE.md files.
- The branch currently has `"hostdb": "file:../hostdb"` (dev wiring). Confirm this is documented as needing replacement at merge time. The merge checklist should explicitly require the swap.

### C. Forward and backward compatibility

**Forward** (old spindb code reading new hostdb data):
- `git show origin/dev:core/hostdb-metadata.ts` (in spindb) reveals the schema the old code parses. The old type doesn't have a `defaults` field. Confirm that adding `defaults` to `databases.json` doesn't break the old type's parsing (it shouldn't — TypeScript ignores unknown fields at runtime, and `unwrapDatabasesJson` is permissive).
- Confirm `releases.json` shape didn't change between dev and the integration branch — only entries were added.

**Backward** (new spindb reading possibly-older bundled hostdb data):
- Confirm the wrapper code in `engines/<X>/version-maps.ts` doesn't depend on any field that's optional in older hostdb versions. The defaults block was added in this branch — wrappers should fall back gracefully if it's missing (e.g., via `getSupportedMajorVersions`'s fallback to `listVersions(format: 'major')`).

### D. Eager resolution + auto-migrate work end-to-end

- Read `cli/commands/create.ts` around the `resolveFullVersion` call. Verify the resolution happens AFTER `dbEngine` is constructed and BEFORE any `containerManager.create` or `dbEngine.initDataDir` call.
- Read `cli/commands/start.ts` for the auto-migrate block. Verify it skips file-based engines (SQLite, DuckDB), skips remote/'unknown' containers, and only fires when `isShorthandVersion()` returns true.
- Read `core/version-utils.ts:isShorthandVersion`. Test it mentally against:
  - `'17'` → shorthand (true)
  - `'17.10'` → shorthand (true)
  - `'17.10.0'` → full (false)
  - `'25.12.3.21'` → full (4-part ClickHouse — should be false)
  - `'17-0.107.0'` → full (compound postgresql-documentdb — should be false; base part is `'17'` which has no `.`, but the `-` suffix makes it full)
  - `''` / `'unknown'` → false (sentinels)
  - **CHECK the compound case carefully** — it's the most likely to be wrong.
- Confirm there's NO path where `containerManager.create` is called with shorthand. Check three sites:
  - `cli/commands/create.ts`
  - `cli/commands/menu/container-handlers.ts`
  - `cli/commands/menu/backup-handlers.ts`

### E. The bundled snapshot agrees with the live registry

- Run `cd ~/dev/spindb && pnpm test:hostdb-sync`. Confirm it passes — this verifies every version in the bundled hostdb snapshot exists on the live R2 registry.
- If it fails, the snapshot is ahead of the live registry, meaning a hostdb release shipped versions that didn't get uploaded properly. That's a blocker.

### F. The pre-publish guards in hostdb are correct

Read `~/dev/hostdb/.github/workflows/publish.yml`:

- Confirm `pnpm build:releases` runs before `git diff --exit-code releases.json` — the drift check is meaningful only if the regenerated file is compared to the committed one.
- Confirm `pnpm build` and `pnpm test` run before `npm publish`.
- Confirm `npm publish` uses `NPM_CONFIG_PROVENANCE: true` (for OIDC trusted publishing).
- Confirm `package.json:publishConfig` has `"access": "public"` and `"provenance": true`.
- Confirm the workflow is triggered ONLY on push to main, not on PR (PRs use version-check.yml).

### G. The pack-install smoke test is real

Read `~/dev/hostdb/.github/workflows/ci.yml`:

- Confirm the matrix runs the install under BOTH `npm` and `pnpm`.
- Confirm the smoke checks include at least one resolver call (`resolveVersion`), at least one loader call (`loadDatabasesJson`), and at least one bundled-data field read (engine count).
- Actually run it locally if you can: `cd ~/dev/hostdb && pnpm pack --pack-destination /tmp/hostdb-audit && cd /tmp/hostdb-audit && echo '{"name":"audit","type":"module"}' > package.json && npm install ./hostdb-*.tgz && node -e "import('hostdb').then(h => console.log(h.listEngines().length === 22 ? 'ok' : 'FAIL'))"`.

### H. The downstream test prompt is comprehensive

Read `~/dev/layerbase-cloud/SPINDB_HOSTDB_INTEGRATION_TEST_PROMPT.md`:

- Confirm Test 1 (existing prod container survives bump) is the FIRST test — that's the highest-risk scenario.
- Confirm there's a test for the LTS-vs-latest defaults block (MongoDB '8' → 8.0.x not 8.2.x).
- Confirm there's a test for offline metadata (no network egress required for `spindb engines supported`).

### I. Cross-repo coordination memo

The maintainer manages 5 repos. After this merge, every new database version requires:

1. Edit hostdb (`databases.yml` + `defaults` block if needed + `sources.json`).
2. Bump hostdb's package.json patch version.
3. Run engine release workflow.
4. Merge to main → npm publish fires.
5. Bump `hostdb` exact-pin in spindb package.json.
6. Bump spindb's own version.
7. Merge spindb feature → dev → main → spindb publish fires.
8. Bump `SPINDB_VERSION` in layerbase-cloud `images/Dockerfile.base`.
9. Bump `spindb` exact-pin in layerbase-desktop package.json.

Verify:
- This sequence is documented in `~/dev/hostdb/UPGRADE_PLAYBOOK.md` Part A3.
- The hostdb CLAUDE.md "Coordination rules" section captures the same sequence.
- Skipping step 4 → step 8 fails (Docker build can't `npm install -g spindb@X` if hostdb dep isn't on npm yet). Mentally trace what happens if a maintainer does step 8 prematurely.

### J. The drift gate (defaults-sync test) is meaningful

Read `~/dev/hostdb/tests/defaults-sync.test.ts`:

- Confirm it has snapshots for all 22 engines (including postgresql-documentdb).
- Confirm at least these critical mappings are present and correct:
  - `mongodb '8' → '8.0.23'` (LTS, NOT 8.2.x)
  - `mysql '8' → '8.4.9'` (LTS, NOT 9.x)
  - `mariadb '11' → '11.8.6'` (latest 11.x LTS)
  - `postgresql '18' → '18.4.0'`
  - `clickhouse '25.12.3.21'` (4-part identity)
  - `postgresql-documentdb '17' → '17-0.107.0'` (compound)

Run the test: `cd ~/dev/hostdb && pnpm test 2>&1 | grep defaults-sync`. Should be all green.

### K. Spindb test coverage didn't decline

- Before this branch: `pnpm test:unit` ran 1562 tests.
- This branch: `pnpm test:unit` should run 1555 (1562 minus 7 deleted from `engines-registry.test.ts`, which only tested the removed `filterEnginesByPlatform`).
- Confirm the test deletion is justified (the function was removed) and nothing else regressed.
- Run `pnpm test:unit` and `pnpm test:cli` and `pnpm test:hostdb-sync`. All three must be green.

### L. The R2 audit script works without false positives

Run `cd ~/dev/hostdb && set -a; source .env; set +a; pnpm audit:r2-orphans`. Should report:
- ~265 binaries + 3 registry JSON files = 268 referenced
- 57 companion checksums.txt files (expected, not orphans)
- 0 true orphans

If it reports >0 true orphans, investigate — those represent stale binaries from abandoned engines.

### M. Edge cases worth stress-testing

Write a smoke script that calls these and verifies the answers:

```ts
import { resolveVersion, normalizeVersion } from 'hostdb'

// Should return null (unknown engine)
console.log(resolveVersion('nonexistent', '1') === null)

// Should return null (engine exists, version doesn't)
console.log(resolveVersion('postgresql', '99.99.99') === null)

// Identity for known full version
console.log(resolveVersion('postgresql', '18.4.0') === '18.4.0')

// Identity for deprecated version (still resolvable per A3 finding)
console.log(resolveVersion('mysql', '8.0.40') === '8.0.40')

// Prefix match for major-only key not in defaults block
console.log(resolveVersion('postgresql', '17') === '17.10.0')

// Defaults pick wins over prefix match
console.log(resolveVersion('mongodb', '8') === '8.0.23') // NOT 8.2.9

// Compound version identity
console.log(resolveVersion('postgresql-documentdb', '17-0.107.0') === '17-0.107.0')

// 4-part ClickHouse identity
console.log(resolveVersion('clickhouse', '25.12.3.21') === '25.12.3.21')

// 3-part prefix matches 4-part ClickHouse
console.log(resolveVersion('clickhouse', '25.12.3') === '25.12.3.21')

// normalizeVersion returns input unchanged on miss
console.log(normalizeVersion('postgresql', 'garbage') === 'garbage')
```

All should print `true`.

### N. Things that look right but might be wrong

Look hard for these landmines:

1. **Did anyone accidentally hand-edit a wrapper after the migration?** Grep for `: string }> = {` (the old static-MAP literal pattern) in `spindb/engines/*/version-maps.ts`. There should be ZERO hits.

2. **Are there still hardcoded version strings in non-test code that should derive from hostdb?** Search `spindb/cli` and `spindb/core` for hardcoded major versions (`'17'`, `'18'`, `'8.4'`, etc.) in CONTEXTS THAT AREN'T comments or test fixtures. Some are legitimate (e.g., FerretDB Windows fallback uses `FERRETDB_VERSION_MAP['1']` which is intentional).

3. **The `enabled !== false` vs `deprecated: true` distinction.** Confirm that deprecated versions still resolve via the resolver (per A3 finding). Test: `resolveVersion('mysql', '8.0.40')` must return `'8.0.40'`, not null.

4. **Does the wrapper handle an engine entry that has NO defaults block?** It should fall back to `listVersions(format: 'major')`. Confirm by reading `getSupportedMajorVersions` in `lib/resolver.ts`.

5. **The `prepare` script in hostdb runs on `pnpm install`.** Confirm that's still the case — the publish path depends on `dist/` being built. If someone removed it, npm publish would ship without dist/.

6. **The cloud's Dockerfile.base** at `~/dev/layerbase-cloud/images/Dockerfile.base` still does `npm install -g spindb@${SPINDB_VERSION}`. Confirm npm transitively resolves the exact-pinned hostdb. If the cloud is on a network with a corporate npm mirror, that mirror needs to carry hostdb too — flag this concern.

7. **Desktop's `prepare-spindb.mjs`** runs `npm install --production --ignore-scripts`. Confirm hostdb's `dist/` is shipped with the tarball (the prepublish step runs in the publishing pipeline, so dist IS in the npm-hosted tarball). The `--ignore-scripts` here is fine.

### O. Things you should explicitly check by running code

```bash
# In hostdb dir
cd ~/dev/hostdb
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm pack --pack-destination /tmp

# Audit R2
set -a; source .env; set +a
pnpm audit:r2-orphans

# In spindb dir
cd ~/dev/spindb
pnpm install
pnpm lint
pnpm test:unit
pnpm test:hostdb-sync
pnpm test:cli

# Smoke the published tarball
mkdir -p /tmp/audit-consumer && cd /tmp/audit-consumer
echo '{"name":"audit","type":"module"}' > package.json
npm install /tmp/hostdb-*.tgz
node -e "import('hostdb').then(h => {
  if (h.listEngines().length !== 22) { console.error('FAIL: engine count'); process.exit(1); }
  if (h.resolveVersion('mongodb', '8') !== '8.0.23') { console.error('FAIL: mongodb LTS'); process.exit(1); }
  if (h.resolveVersion('postgresql', '18') !== '18.4.0') { console.error('FAIL: pg 18'); process.exit(1); }
  console.log('ok');
})"
```

Every command should succeed. Any failure is a blocker.

## What to report back

A flat list of:

1. **Blockers** — things that MUST be fixed before merge.
2. **Concerns** — things that aren't blockers but the maintainer should know about.
3. **Improvements** — nice-to-haves that could be future work.

For each finding, include: severity (blocker/concern/improvement), what's wrong, where (file:line if applicable), and why it matters.

Do not say "looks good" without evidence. If you didn't actually check something on this list, say so explicitly.

## Non-goals

- Re-running the integration. The work is done. You're verifying it's correct.
- Re-arguing the design. The "single source of truth via hostdb npm package" architecture is settled. Question correctness, not direction.
- Style preferences. If the code works, it works.

## Final question to answer

At the end of your audit, answer this one question:

> **Should the maintainer merge `upgrade/spindb-hostdb-integration` on both hostdb and spindb to their respective `dev` branches today?**

Pick one: **YES**, **NO**, or **YES WITH CAVEATS** (list the caveats).
