# Merge Playbook — `upgrade/spindb-hostdb-integration`

> Self-contained step-by-step for the agent or engineer executing the merge across all 5 repos. Read this top-to-bottom before starting; do not skip steps; do not reorder.

## What's about to merge

Two repos with integration branches, plus two repos with doc-only branches:

| Repo | Branch | Action |
|---|---|---|
| `~/dev/hostdb` | `upgrade/spindb-hostdb-integration` | merge → dev → main → triggers npm publish 0.31.0 |
| `~/dev/spindb` | `upgrade/spindb-hostdb-integration` | flip hostdb pin → merge → dev → main → publishes spindb 0.50.0 |
| `~/dev/layerbase-cloud` | `docs/hostdb-integration-coordination` | merge to dev (docs only, no behavioral change) |
| `~/dev/layerbase-desktop` | `docs/hostdb-integration-notes` | merge to main (docs only) |

After all four merges land, two follow-up bumps:

| Repo | Action |
|---|---|
| `~/dev/layerbase-cloud` | bump `SPINDB_VERSION=0.50.0` in `images/Dockerfile.base` → image rebuild + deploy |
| `~/dev/layerbase-desktop` | bump `"spindb": "0.50.0"` (exact pin) in `package.json` → ships in next desktop release |

## Implications you need to know BEFORE starting

1. **Ordering is load-bearing.** Step 2 (spindb pin flip) cannot start until step 1 (hostdb publish) completes — `npm install` in spindb would otherwise fail. If you do step 2 first, the merge breaks.
2. **End users see no behavioral change.** All changes are internal architecture (version-maps wrappers, eager-resolution, bundled offline metadata). No CLI surface changes.
3. **Existing prod databases (cloud + desktop) self-heal.** On their next start under spindb 0.50.0, legacy `container.json` files with shorthand `version: '17'` auto-migrate to full versions like `'17.10.0'`. Patch-level changes within major.minor are binary-compatible for every database we host, so this is safe.
4. **Hostdb is published via OIDC.** No secrets needed. If the publish fails, the publish step in `publish.yml` exits non-zero and surfaces as a workflow failure.
5. **`spindb doctor` does NOT need to run.** Auto-migration happens at first start under 0.50.0. The `doctor --fix` command is for users who want to inspect the migration explicitly.
6. **No data corruption risk** for existing containers. Container directories on disk are preserved; only the `version` field in `container.json` gets updated, and the binary on disk is matched by full version (R2 retains all historic binaries).

## Pre-flight checklist (do all before starting)

```bash
# 1. Working directories are clean
cd ~/dev/hostdb && git status        # should be clean except for any local edits you're aware of
cd ~/dev/spindb && git status        # same
cd ~/dev/layerbase-cloud && git status
cd ~/dev/layerbase-desktop && git status

# 2. Branches are pushed
cd ~/dev/hostdb && git fetch && git log @{u}..   # should be empty
cd ~/dev/spindb && git fetch && git log @{u}..
cd ~/dev/layerbase-cloud && git fetch && git log @{u}..
cd ~/dev/layerbase-desktop && git fetch && git log @{u}..

# 3. Confirm versions are pre-bumped (these are the values that WILL ship)
cd ~/dev/hostdb && grep '"version"' package.json   # should show 0.31.0
cd ~/dev/spindb && grep '"version"' package.json   # should show 0.50.0

# 4. Confirm hostdb dep is still file:../hostdb in spindb (it WILL be flipped in step 2)
cd ~/dev/spindb && grep '"hostdb"' package.json    # should show "file:../hostdb"

# 5. Confirm current published versions
npm view hostdb version    # 0.30.0 (the published-but-not-yet-bumped version)
npm view spindb version    # 0.49.0 (same — pre-bump)
```

If any of these don't match, STOP and investigate. Don't proceed until they all match.

## Step 1 — Merge hostdb (publishes 0.31.0 to npm)

```bash
cd ~/dev/hostdb

# Push branch (probably already pushed but verify)
git push origin upgrade/spindb-hostdb-integration

# Open + merge the PR (use --squash or --merge — the project doesn't have a strict policy here, but check existing PR style first)
gh pr create --base dev --head upgrade/spindb-hostdb-integration \
  --title "feat: hostdb npm package surface + bundled offline registry (0.31.0)" \
  --body-file INTEGRATION_FINDINGS.md

# Wait for CI to go green on the PR (ci.yml runs: lint + tests + pack-install smoke)
gh pr checks --watch

# Merge to dev
gh pr merge --merge   # or --squash if that's the team norm

# After dev merge, open dev → main PR
gh pr create --base main --head dev --title "Release: 0.31.0"
gh pr merge --merge

# This push to main triggers publish.yml
# Watch the publish workflow run
gh run watch
```

**Verify the publish succeeded:**

```bash
npm view hostdb version   # MUST show 0.31.0 now
npm view hostdb dist.tarball   # confirms the new tarball URL
```

If `npm view hostdb version` still returns 0.30.0:

- Check the publish workflow: `gh run list --workflow=publish.yml --limit=3`
- Common cause: drift gate detected stale `releases.json` (the workflow regenerates and compares). Fix: locally run `pnpm build:releases`, commit, push, the next push to main retries.
- Less common: npm OIDC token issue. Surface to the maintainer.

**DO NOT PROCEED to step 2 until `npm view hostdb version` shows 0.31.0.**

## Step 2 — Flip spindb's hostdb pin and merge

```bash
cd ~/dev/spindb
git checkout upgrade/spindb-hostdb-integration
git pull

# Flip the pin from file:../hostdb to exact "0.31.0"
# The script verifies hostdb@0.31.0 is on npm before flipping — refuses to run otherwise
pnpm flip-hostdb-pin

# Review what changed
git diff package.json pnpm-lock.yaml

# Commit the flip
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): pin hostdb 0.31.0"
git push

# Open spindb feature → dev PR
gh pr create --base dev --head upgrade/spindb-hostdb-integration \
  --title "feat: consume hostdb npm package (0.50.0)" \
  --body "See ~/dev/hostdb/INTEGRATION_FINDINGS.md for full context."

# Wait for green CI on dev PR
gh pr checks --watch

# Merge to dev
gh pr merge --merge

# Open dev → main PR. WAIT for ALL tests to pass before merging.
gh pr create --base main --head dev --title "Release: spindb 0.50.0"

# CRITICAL: do not merge dev → main with any failing tests. Re-run transient failures.
# Per spindb's branch workflow: feature → dev → main, every check must be green.
gh pr checks --watch
gh pr merge --merge
```

**Verify the publish succeeded:**

```bash
npm view spindb version   # MUST show 0.50.0 now
```

## Step 3 — Merge layerbase-cloud docs

```bash
cd ~/dev/layerbase-cloud
git checkout docs/hostdb-integration-coordination
git pull

# Open PR to dev. DO NOT push directly to main on layerbase-cloud — push to main triggers prod deploy.
gh pr create --base dev --head docs/hostdb-integration-coordination \
  --title "docs: note hostdb npm coordination + integration test prompt"

# Wait for green CI
gh pr checks --watch
gh pr merge --merge
```

This branch contains only docs (`CLAUDE.md` clarification + `SPINDB_HOSTDB_INTEGRATION_TEST_PROMPT.md`). No code or config changes. The dev → main promotion can happen on the team's normal cadence — there's no urgency since SPINDB_VERSION hasn't been bumped yet.

## Step 4 — Merge layerbase-desktop docs

```bash
cd ~/dev/layerbase-desktop
git checkout docs/hostdb-integration-notes
git pull

# Desktop's branch workflow is feature → main directly (no dev intermediate per the repo's current setup)
gh pr create --base main --head docs/hostdb-integration-notes \
  --title "docs: note hostdb transitive dep + bundle assembly"

gh pr checks --watch
gh pr merge --merge
```

Docs-only — no version bump, no new release.

## Step 5 — Bump SPINDB_VERSION in layerbase-cloud

Only do this after step 2 completes and `npm view spindb version` returns 0.50.0.

```bash
cd ~/dev/layerbase-cloud
git checkout dev
git pull

# Create a feature branch for the bump
git checkout -b chore/bump-spindb-0.50.0

# Edit images/Dockerfile.base — find ARG SPINDB_VERSION=X.Y.Z and bump to 0.50.0
# Also update deploy/setup.sh in two places (production env template + staging env template)
# See cloud's CLAUDE.md "Bumping SpinDB version" section for the exact lines

# Commit
git add images/Dockerfile.base deploy/setup.sh
git commit -m "chore(image): bump SpinDB to 0.50.0 (hostdb 0.31.0 dep)"
git push -u origin chore/bump-spindb-0.50.0

# Open PR to dev. NEVER push directly to main on layerbase-cloud (push to main = prod deploy).
gh pr create --base dev --head chore/bump-spindb-0.50.0

gh pr checks --watch
gh pr merge --merge

# When ready to deploy to prod, open dev → main PR
gh pr create --base main --head dev --title "Deploy: SpinDB 0.50.0"
# Wait for ALL checks green, including image build workflow
gh pr checks --watch
gh pr merge --merge
```

The push to main triggers `build-images.yml` (rebuilds the universal Docker image) and `deploy.yml` (rolls servers).

**Verify the cloud deploy:**

After deploy completes, exec into a cloud user container and run:

```bash
spindb --version           # should print 0.50.0
node -e "console.log(require('hostdb/package.json').version)"   # should print 0.31.0
```

## Step 6 — Bump spindb pin in layerbase-desktop

Only do this after step 2 completes.

```bash
cd ~/dev/layerbase-desktop
git checkout main
git pull
git checkout -b chore/bump-spindb-0.50.0

# Bump "spindb": "0.50.0" in package.json (exact pin)
# Use pnpm CLI for safety:
pnpm pkg set dependencies.spindb=0.50.0

# Regenerate lockfile
pnpm install

# Re-bundle to verify it works
pnpm prepare:spindb

# Verify the bundle assembled with the right versions
node -e "const p = require('./build/spindb/package.json'); console.log('spindb:', p.version)"
ls build/spindb/node_modules/hostdb/package.json   # should exist
node -e "console.log(require('./build/spindb/node_modules/hostdb/package.json').version)"   # should print 0.31.0

# Commit
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): bump spindb to 0.50.0 (transitively pulls hostdb 0.31.0)"
git push -u origin chore/bump-spindb-0.50.0

gh pr create --base main --head chore/bump-spindb-0.50.0
gh pr checks --watch
gh pr merge --merge
```

The new spindb ships to end users on the next desktop release (electron-builder runs via `release.yml`).

## After all six steps — verification

```bash
# 1. Final version check
npm view hostdb version   # 0.31.0
npm view spindb version   # 0.50.0

# 2. Cloud sanity (run inside a user container)
spindb engines supported --json | jq '.engines.postgresql.defaultVersion'   # "18"
spindb engines supported --json | jq '.engines.postgresql.supportedVersions'   # ["18","17","16","15"]

# 3. Test the LTS-vs-current policy is reaching cloud
spindb create probe-mongo --engine mongodb --db-version 8 --port 27018 --no-start
cat ~/.spindb/containers/mongodb/probe-mongo/container.json | jq .version
# MUST be "8.0.23" (LTS), NEVER "8.2.x"

spindb delete probe-mongo --force

# 4. Run the cloud test prompt (~/dev/layerbase-cloud/SPINDB_HOSTDB_INTEGRATION_TEST_PROMPT.md)
#    against staging. 8 test scenarios.
```

## Rollback plans

| If this fails | Do this |
|---|---|
| hostdb publish fails (step 1) | The workflow exits non-zero. Fix the underlying issue, re-merge to main (each push retries the publish). |
| spindb pin flip fails (step 2) | The script refuses to flip if hostdb@0.31.0 isn't on npm. Wait for step 1 to actually complete and re-run. |
| spindb publish fails | Same as hostdb — fix and re-trigger. |
| Cloud image build fails after SPINDB_VERSION bump | Likely cause: hostdb pin not yet on npm (race with step 1). Verify `npm view hostdb version` returns 0.31.0; if so, re-run the image build workflow. |
| Cloud deploy succeeds but a user database fails to start under new spindb | This shouldn't happen — start-time auto-migrate (A10) handles legacy shorthand. But if it does: revert SPINDB_VERSION on cloud (set back to 0.49.0), redeploy. User data is preserved (only container.json version field changes; data dir untouched). Diagnose the specific failure, file a bug, fix forward. |
| Desktop end user reports the new spindb is broken | Worst case: revert the desktop spindb bump, ship a desktop patch release with the old spindb. Existing installed desktops keep their bundled spindb until the user upgrades. |

## Set this up while you're here

The publish workflow doesn't currently notify Slack on failure. Add a step or use the repo's Slack integration before relying on the publish cascade unattended.

- Workflow: `~/dev/hostdb/.github/workflows/publish.yml`
- Add a `failure: notify Slack` step using a Slack webhook secret.
- Or subscribe to repo-level workflow failures via GitHub's Slack app.

## Reference docs

- `~/dev/hostdb/INTEGRATION_FINDINGS.md` — full A1–A14 audit findings + architectural rationale
- `~/dev/hostdb/UPGRADE_PLAYBOOK.md` — long-term operator playbook (this file is the one-shot variant)
- `~/dev/hostdb/CLAUDE.md` — Coordination rules section (the load-bearing invariants)
- `~/dev/spindb/CLAUDE.md` — hostdb npm Package & Pinning Strategy
- `~/dev/spindb/scripts/flip-hostdb-pin.mjs` — the merge-time helper (read it before running it)
- `~/dev/layerbase-cloud/SPINDB_HOSTDB_INTEGRATION_TEST_PROMPT.md` — post-merge verification
- `~/dev/hostdb/PRE_MERGE_AUDIT_PROMPT.md` — the audit framework that signed off on this merge

## Final question

Do not start step 1 unless the answer to this is yes:

> Did the second audit pass return clean? Are all CI checks green on the integration branches?

If yes: proceed.
