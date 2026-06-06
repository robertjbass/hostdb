# Replace-a-Binary Playbook

How to replace an already-published binary on R2 with a different build of the same engine/version/platform (e.g. a smaller `-minimal` or custom-trimmed tarball) WITHOUT cutting a full release. See also `MINIMAL_BINARIES.md` (the MySQL minimal status) and `REMOVE_BINARY_CHEATSHEET.md` (deleting a binary entirely).

## Why this works (the load-bearing facts)

spindb (the primary consumer) **constructs** the download URL from a fixed template -
`registry.layerbase.host/{engine}-{ver}/{engine}-{ver}-{platform}.tar.gz` - and **ignores** the per-asset `url` in `releases.json`. It does **not** verify `sha256` or `size`; its post-download check just runs `<server-binary> --version`. Therefore:

- The replacement must live at the **canonical key** (you cannot redirect via `releases.json`).
- Replacing the bytes there is transparent to every pinned consumer - no version bump is required for delivery.

Re-verify these assumptions before relying on them (they could change in a future spindb).

## Tooling

- `scripts/rehost-minimal-r2.ts` - backup -> overwrite -> purge, plus `--restore`, `--dry-run`, and a `--max-size-mb` guard (default 400; refuses to overwrite with a larger file, so a stray full build cannot clobber a minimal).
- `.github/workflows/rebuild-minimal-mysql.yml` - the same flow as a dispatchable workflow, with a `mode: rehost | restore` input. It builds + round-trip-tests before overwriting.

## Procedure (local)

```bash
# 1. build the replacement artifact
pnpm download:mysql -- --version 8.4.9 --platform linux-x64 --output ./dist

# 2. validate it (do NOT skip - this is the pg_restore-loss guard)
./builds/mysql/test-roundtrip.sh ./dist/mysql-8.4.9-linux-x64.tar.gz linux-x64
./builds/mysql/test-spindb-e2e.sh ./dist/mysql-8.4.9-linux-x64.tar.gz 8.4.9

# 3. replace on R2 (auto-creates _backup/<key> first)
set -a; source .env; set +a
pnpm tsx scripts/rehost-minimal-r2.ts --tag mysql-8.4.9 --file ./dist/mysql-8.4.9-linux-x64.tar.gz

# 4. verify the live URL serves the new bytes
curl -fsSL -o /tmp/x.tar.gz https://registry.layerbase.host/mysql-8.4.9/mysql-8.4.9-linux-x64.tar.gz
shasum -a 256 /tmp/x.tar.gz   # compare to: shasum -a 256 ./dist/mysql-8.4.9-linux-x64.tar.gz
```

## Rollback (3 independent layers)

1. **R2 `_backup/`** (fastest): `pnpm tsx scripts/rehost-minimal-r2.ts --tag mysql-8.4.9 --filename mysql-8.4.9-linux-x64.tar.gz --restore` (or dispatch the workflow with `mode: restore`).
2. **Local verified original** (if the `_backup/` object is gone): keep a sha-verified copy of the pre-overwrite binary (e.g. under `~/layerbase-mysql-full-backups/`), then `--file <that-original> --no-backup --max-size-mb 2000`.
3. **Vendor rebuild**: the original vendor URL + sha for each replaced entry is preserved in `builds/mysql/sources.json` -> `notes` (`*-full-revert` keys).

## Gotchas

- **CDN purge** needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` (present in `.env` and repo secrets). Without them the script still overwrites but warns, and the old binary stays CDN-cached for up to a year (`max-age=31536000, immutable`).
- **`_backup/` objects are orphans** by `audit:r2-orphans`' definition (not referenced by `releases.json`). Do not run `pnpm audit:r2-orphans --delete` while you rely on them for rollback.
- This path leaves `releases.json` and the GitHub release asset **stale** (still labeled as the old binary). It is cosmetic - nothing reads size/sha for downloads - but to reconcile, run the engine release workflow (`release-<engine>.yml`); it rebuilds + updates the GitHub releases + R2 + regenerates `releases.json`.

## The "proper" full path (consistent from the start)

Per the publish-cascade coordination rules: edit `sources.json` + bump `package.json` -> run the release workflow (updates GitHub releases + R2 + commits a correct `releases.json`) -> merge -> `publish.yml` publishes. This avoids the stale-label residue entirely, at the cost of rebuilding all platforms. Use the direct-replace path above to ship + verify fast; use the release workflow when you want a clean, fully-labeled release.

## Downstream cascade after a binary change

1. **hostdb**: patch bump + CHANGELOG, merge to main -> `publish.yml` -> npm. Verify `npm view hostdb version`.
2. **spindb**: bump the exact `hostdb` pin in `package.json`, open PR -> the CI matrix downloads the live binary and exercises it. Verify `npm view spindb version`.
3. **layerbase-cloud**: bump `ARG SPINDB_VERSION` in `images/Dockerfile.base`, rebuild images. (Note: cloud downloads binaries at container runtime, so the binary change is already live for new containers regardless of this bump - the bump is version alignment.)
4. **layerbase-desktop**: bump `spindb` in `package.json`; next release ships it.
