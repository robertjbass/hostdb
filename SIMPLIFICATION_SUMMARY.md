# Simplification Summary

The plain-English version of `SIMPLIFICATION_SCOPE.md`. Drafted 2026-05-15.

---

## What we're doing

Publish hostdb to npm so spindb can install it and read the version data instead of copying it.

Right now spindb has 21 hand-written files (one per database engine) that each list "for MariaDB, version 11 means 11.8.6, version 11.4 means 11.4.10, ..." This week's nine-engine sweep needed ~30 of those file edits to do what was conceptually one decision per engine. After this change, each of those 21 files shrinks to a 5-line wrapper that just imports from `hostdb`, and the next sweep is one dependency-version bump.

That's the whole thing. Three small steps:

1. Add a `resolveVersion()` function and a few helpers to hostdb's existing `lib/`.
2. Write down each engine's default-version policy explicitly in `databases.yml` (today these rules only exist as comments in spindb).
3. Publish hostdb to npm, replace spindb's 21 files with thin wrappers, bump the cloud image.

---

## What it costs

About 2–3 days of focused work, ~3 weeks of calendar time. The calendar is longer than the work because we wait two weeks for the May 2026 patch wave to soak first, then do the spindb migration one engine at a time so any breakage is contained.

---

## The one risk that matters

Today, "MongoDB version 8" means 8.0 (the LTS), and "MariaDB version 11" means 11.8 (the newest one). These are different rules, and they only live as comments in spindb's hand-written files. If we ship a resolver that just says "pick the highest version starting with 8," MongoDB users would silently flip to 8.2 and not realize until something breaks in production.

**The fix:** write each engine's rule down explicitly in `databases.yml`, and run a test before publishing that confirms the new resolver returns *exactly* what spindb returns today for every engine. If anything diverges, decide on purpose whether to ratify the new behavior or fix the resolver. Don't publish until the test is green.

---

## Smaller risks

- **Once hostdb is on npm, third parties might depend on it.** That means we can't rename functions casually. Mitigation: pick names once, carefully; treat `resolveVersion` and friends as a contract. Start at `0.31.x` (signals "still settling") for the first month; promote to `1.0.0` after a clean monthly patch cycle.
- **Big-bang spindb migration is risky.** Mitigation: per-engine PRs into `dev`, ~3 per day. Each one is independently revertable.
- **Cloud could break.** Mitigation: standard dev → main flow for the `SPINDB_VERSION` bump. Verify a fresh PostgreSQL 18 provision still returns `PostgreSQL 18.4` before declaring done.

---

## How we'd know it worked

- hostdb is published on npm.
- All 21 of spindb's `version-maps.ts` files are 5-line wrappers that import from `hostdb`.
- A fresh PostgreSQL 18 on `dev.cloud.layerbase.com` still returns `PostgreSQL 18.4`.
- No hotfixes shipped for a month after.

If those four hold on **2026-08-15** (about three months from now), call it done.

---

## What we're NOT doing

- **The weekly upgrade bot.** Separate idea, separate decision. Defer.
- **Consolidating spindb's other config files.** Becomes a half-day of cleanup after this lands; pick it up then if it still seems worth it.
- **Auto-generating the release workflows.** No drift problem has actually hurt this year; defer.
- **A `pnpm release` orchestrator command.** Nice-to-have whenever; not part of this.
- **Merging hostdb and spindb into one repo.** Explicit non-recommendation. They have different cadences; keep them apart.
- **ClickHouse, libSQL, and Phase 2 engine upgrades.** Tracked separately.

---

## Final position

Do it. Start 2026-05-30. About 3 weeks calendar. The biggest payoff is that multi-engine sweeps like this week's stop requiring dozens of spindb file edits — the spindb side becomes one line in `package.json`.
