# Remove Binary Cheatsheet

How to delete released database binaries from GitHub Releases, Cloudflare R2, and `releases.json`.

## Prerequisites

| Credential | Required For | How to Set |
|---|---|---|
| `GITHUB_TOKEN` | Deleting GitHub Releases/assets | `export GITHUB_TOKEN=ghp_...` |
| `R2_ACCOUNT_ID` | Deleting from R2 | `export R2_ACCOUNT_ID=...` |
| `R2_ACCESS_KEY_ID` | Deleting from R2 | `export R2_ACCESS_KEY_ID=...` |
| `R2_SECRET_ACCESS_KEY` | Deleting from R2 | `export R2_SECRET_ACCESS_KEY=...` |
| `R2_BUCKET_NAME` | Deleting from R2 | `export R2_BUCKET_NAME=...` |

## Interactive Mode

Launch the interactive wizard — it walks through release selection, scope, and target with arrow-key menus:

```bash
pnpm delete:releases
```

**Steps:**
1. **Select releases** — checkbox list of every release in `releases.json` (multi-select)
2. **Delete scope** — entire release (all platforms) or pick specific platforms per release
3. **Delete target** — GitHub + R2, GitHub only, or R2 only
4. **Confirm** — review summary and confirm before anything is deleted

### Interactive Dry Run

Preview what would be deleted without making any changes:

```bash
pnpm delete:releases -- --dry-run
```

## Scriptable (Non-Interactive) Mode

Pass all options as flags for CI, scripts, or one-liners. Requires `--database`, `--version`, and `--yes` (to skip prompts).

### Delete an entire release (all platforms, GitHub + R2)

```bash
pnpm delete:releases -- --database mysql --version 8.0.40 --from both --yes
```

Deletes:
- The GitHub Release and all its assets for `mysql-8.0.40`
- All matching files from R2 under the `mysql-8.0.40/` prefix
- The `mysql.8.0.40` entry from `releases.json`
- Publishes the updated `releases.json` to R2

### Delete specific platforms from a release

```bash
pnpm delete:releases -- --database mysql --version 8.0.40 --platform linux-arm64 --from both --yes
```

Repeat `--platform` for multiple:

```bash
pnpm delete:releases -- --database mysql --version 8.0.40 --platform linux-arm64 --platform darwin-x64 --from both --yes
```

Deletes:
- Only the matching platform assets from the GitHub Release (assets whose filenames contain the platform string)
- Only the matching platform files from R2
- Removes those platforms from the version entry in `releases.json` (if no platforms remain, removes the entire version)

### Delete from only one target

```bash
# GitHub only (keeps R2 files)
pnpm delete:releases -- --database mysql --version 8.0.40 --from github --yes

# R2 only (keeps GitHub Release)
pnpm delete:releases -- --database mysql --version 8.0.40 --from r2 --yes
```

### Dry run (scriptable)

```bash
pnpm delete:releases -- --database mysql --version 8.0.40 --from both --dry-run
```

`--dry-run` skips the confirmation prompt automatically and prints what would happen.

## Flag Reference

| Flag | Description |
|---|---|
| `--database NAME` | Database ID (e.g., `mysql`, `postgresql`, `mariadb`) |
| `--version VERSION` | Version to delete (e.g., `8.0.40`) |
| `--platform PLATFORM` | Platform to delete (repeatable). Omit to delete all platforms. Valid: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` |
| `--from TARGET` | Where to delete from: `both` (default), `github`, `r2` |
| `--yes`, `-y` | Skip confirmation prompt |
| `--dry-run` | Preview only, no changes made |
| `--help`, `-h` | Show help |

## What Gets Modified

Every successful deletion updates three things:

1. **GitHub Releases** — entire release deleted, or specific asset files removed
2. **R2 (registry.layerbase.host)** — files under `{tag}/` prefix deleted
3. **releases.json** — version/platform entries removed from the manifest, then the updated file is re-published to R2

If any deletion step fails, `releases.json` is **not** updated (to avoid the manifest drifting out of sync with actual files).

## Related: Publishing releases.json

If you only need to re-publish `releases.json` to R2 (without deleting anything):

```bash
pnpm publish:releases
```

This also runs automatically via GitHub Actions whenever `releases.json` changes on `main`.
