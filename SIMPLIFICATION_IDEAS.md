# Simplification Ideas

The current upgrade flow is overwhelming because version state is duplicated across three repos with three different shapes (full semver → major.minor.patch MAP → major.minor track). This file collects concrete proposals to shrink the surface area without breaking what works.

Ordered by ROI (highest first).

---

## 1. Publish hostdb data as an npm package (HIGH ROI, low risk)

**The problem:** Every patch bump requires editing `engines/<X>/version-maps.ts` in spindb to repoint major/major.minor keys. There are 21 engines, so a multi-engine sweep means 21 nearly-identical edits across 21 nearly-identical files. The comments in those files literally say:

```ts
// TEMPORARY: This version map will be replaced by the hostdb npm package once published.
```

**The fix:**

hostdb's `package.json` already declares the right files for publishing:

```json
"files": ["bin", "cli", "lib", "databases.json", "releases.json", "downloads.json"]
```

Publish it as `hostdb` (already private: false in package.json) or `@layerbase/hostdb-registry`. Make spindb depend on it:

```ts
// engines/mariadb/version-maps.ts becomes a 5-line wrapper:
import { resolveVersion, listVersions } from 'hostdb-registry'
export const normalizeVersion = (v: string) => resolveVersion('mariadb', v)
export const SUPPORTED_MAJOR_VERSIONS = listVersions('mariadb', { format: 'major-minor' })
```

The npm package provides a small resolution library that:
- Reads bundled `databases.json` + `releases.json`
- Implements the same major / major.minor / full-version resolution logic that's currently duplicated 21 times
- Optionally fetches latest at runtime (cached) for users who want auto-updates

**Effects:**
- Patch bumps become **one edit in hostdb only** (databases.yml). Spindb's package.json gets a version bump on `hostdb` and that's it.
- The `tests/integration/hostdb-sync.test.ts` becomes a smoke check rather than a critical sync gate (drift becomes structurally impossible).
- spindb's per-engine code shrinks by ~80 lines × 21 engines ≈ 1700 lines deleted.
- The mental model becomes: "hostdb owns versions, spindb consumes them, cloud consumes spindb." Clean ownership.

**Cost:** ~1 day of focused work. Need to design the resolution API, port the logic, migrate all 21 engines, update the sync test.

**Risk:** Low. The resolution logic is already factored into `createHostdbReleases`. Most of the work is mechanical.

---

## 2. Auto-update PR bot (MEDIUM ROI, low risk, depends on #1)

**The problem:** "Are we behind? Which engines? What's the latest upstream?" is a manual, mental process the user does every few months. Today's audit alone took 30+ minutes of upstream lookups.

**The fix:**

A scheduled GitHub Action in hostdb that, weekly:

1. For each engine, fetches the upstream releases page (already documented in `UPGRADE_VERSIONS.md` § Version Check URLs).
2. Diffs against `databases.json`.
3. For each engine with a new version, opens a PR that:
   - Adds the version to `databases.yml` as `true`
   - Adds the URL + checksum to `sources.json` (best-effort; if it can't auto-populate, leaves a TODO)
   - Includes a summary in the PR description: "Engine X has new versions: Y, Z. Y is a security release fixing CVE-..."

The user reviews the PR, accepts it, and the existing release workflow kicks in.

**Effects:**
- "Are we behind?" becomes "look at the open `upgrade-bot/*` PRs."
- Security releases are picked up within a week of upstream publishing.
- Removes the audit step from every upgrade cycle.

**Cost:** ~2 days. The hard part is per-engine URL fetching (GitHub API for repos, vendor pages for others) and SHA-256 fetching from upstream.

**Risk:** Low. PRs are reviewable; the bot can't merge itself.

---

## 3. Consolidate spindb's three duplicate version sources (MEDIUM ROI)

**The problem:** spindb has the same version info in three places:
- `engines/<X>/version-maps.ts` — VERSION_MAP, SUPPORTED_MAJOR_VERSIONS
- `config/engines.json` — supportedVersions, defaultVersion
- `config/engine-defaults.ts` — defaultVersion, latestVersion

A patch bump that promotes a new defaultVersion touches all three. It's easy to forget one.

**The fix:**

Pick one source of truth (the hostdb npm package from #1 is best). Make the other two derived:
- `config/engines.json` is generated from the npm package + a thin overrides file.
- `config/engine-defaults.ts` reads from the same.

The defaults that aren't version-related (ports, superuser, clientTools) stay where they are.

**Effects:**
- One file owns version data per engine in spindb. The rest are computed.
- No more "did I update engines.json after version-maps.ts?" mistakes.

**Cost:** ~1 day if combined with #1; ~2 days standalone.

---

## 4. Encode platform exceptions structurally (LOW ROI, very low risk)

**The problem:** Several engines have weird platform exceptions (ClickHouse: no Windows. libSQL: no Windows. FerretDB v2: no Windows. PostgreSQL-DocumentDB: no Windows. TigerBeetle: macOS uses universal binary). These are tribal knowledge; the playbook (Part A4) lists them but it's easy to miss.

**The fix:**

`databases.yml` already has a `platforms` array per engine. Push it deeper:
- Per-version platform overrides (already used for FerretDB)
- Auto-validate that workflows don't try to build for a platform not in the array
- Auto-generate the workflow matrix from this list (less brittle than the hand-maintained `runs-on` keys)

**Effects:**
- Adding a new engine with a platform exception doesn't require workflow hand-edits.
- Workflow drift (e.g., adding `win32-x64` to the matrix but no Windows binary in sources.json) becomes a `prep --check` failure.

**Cost:** ~1 day. Mostly workflow-template plumbing.

---

## 5. Single-command release flow (LOW ROI, removes friction)

**The problem:** A patch bump currently requires 11 manual steps (Playbook §A3). Most are 30-second commands but the orchestration is mental overhead.

**The fix:**

```bash
pnpm release <engine> <version>
```

Wraps:
1. Edit databases.yml + sources.json (interactive prompts for URLs/checksums)
2. `pnpm prep`
3. Commit + push
4. `gh workflow run release-<engine>.yml`
5. `gh run watch` until green
6. Output a hint card with the spindb-side changes to make

**Effects:**
- The hostdb half of an upgrade goes from 6 commands to 1.
- The spindb half stays manual (it's a different repo) but is reduced to a copy-paste from the hint card.

**Cost:** ~half a day. The actual work is all wiring around existing scripts.

---

## 6. Don't merge hostdb into spindb (explicit non-recommendation)

The user asked whether to merge. I think no — for reasons spelled out in `UPGRADE_PROPOSAL.md` §5. Summary:

- They serve different concerns on different cadences. hostdb is a heavy build pipeline (Docker, QEMU, R2 uploads) that fires monthly. spindb is a lightweight runtime CLI that ships continuously.
- Merging attaches hostdb's 21 release workflows to every spindb commit, or requires path-filtered workflows that recreate the split with worse ergonomics.
- The actual pain — manual sync — is solved better by #1 (the npm package) than by repo unification.

If after #1 + #2 are done the architecture still feels overwhelming, revisit. But solve the right problem first.

---

## What I'd actually do, in order

If I were the user, I'd do this:

1. **First**, ship the May 2026 upgrade sweep using the current process (i.e., what `UPGRADE_PROPOSAL.md` Phase 1 lays out). Don't refactor while you're upgrading — it conflates two changes that have different risks.

2. **Second**, after that sweep is in production for ~2 weeks (proving the current process works), build #1 (the npm package). This is where most of the perceived complexity actually lives.

3. **Third**, layer #2 (auto-update bot) on top of #1. This makes future sweeps almost trivial.

4. #3, #4, #5 are nice-to-haves. Pick them up only if you find yourself hitting their specific pain points.

The total simplification arc is ~1 week of focused work, and at the end the upgrade flow is essentially:
- A bot opens a PR
- You review and merge it
- CI runs the release workflow
- spindb bumps the npm dependency on hostdb-registry; CI runs tests; npm publish
- Cloud bumps SPINDB_VERSION; image rebuilds; deploy

Nothing else. Three repos, three commits, fully scripted.
