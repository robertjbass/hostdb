# IN_PROGRESS.md

> **Note:** This file is used to persist work-in-progress information between Claude Code sessions. When starting a new session, say "review IN_PROGRESS.md" to continue where you left off.

---

## FerretDB Release Plan

This section tracks the release process for `postgresql-documentdb-17-0.107.0` binaries.

## Current Status (as of 2026-01-24 ~5:30pm CST)

| Platform | Status | Run ID | Notes |
|----------|--------|--------|-------|
| darwin-arm64 | ✅ Released | - | Working in SpinDB |
| darwin-x64 | 🔄 Queued | **21323200833** | Waiting for linux-arm64 to complete |
| linux-x64 | ✅ Released | - | Working in SpinDB |
| linux-arm64 | 🔄 Building | **21323166182** | QEMU build started ~5:14pm CST |
| win32-x64 | ✅ Released | - | Added to releases.json |

### Active Build Runs to Monitor

```bash
# Check linux-arm64 build (started first, QEMU - expect 45-90 min)
gh run view 21323166182 --repo robertjbass/hostdb

# Check darwin-x64 build (queued, will start after linux-arm64)
gh run view 21323200833 --repo robertjbass/hostdb

# Quick status check for both
gh run view 21323166182 --repo robertjbass/hostdb --json status,conclusion && \
gh run view 21323200833 --repo robertjbass/hostdb --json status,conclusion
```

## How to Trigger Builds

```bash
# Trigger a single platform build
gh workflow run release-postgresql-documentdb.yml \
  --repo robertjbass/hostdb \
  --ref main \
  -f version=17-0.107.0 \
  -f platforms=<platform>

# Platform options: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64
# Can also use: all (builds all platforms)
```

**Examples:**
```bash
# Rebuild linux-arm64
gh workflow run release-postgresql-documentdb.yml --repo robertjbass/hostdb --ref main -f version=17-0.107.0 -f platforms=linux-arm64

# Rebuild darwin-x64
gh workflow run release-postgresql-documentdb.yml --repo robertjbass/hostdb --ref main -f version=17-0.107.0 -f platforms=darwin-x64

# Rebuild all platforms
gh workflow run release-postgresql-documentdb.yml --repo robertjbass/hostdb --ref main -f version=17-0.107.0 -f platforms=all
```

## How to Monitor Builds

```bash
# List recent workflow runs
gh run list --repo robertjbass/hostdb --workflow=release-postgresql-documentdb.yml --limit 5

# Check specific run status
gh run view <RUN_ID> --repo robertjbass/hostdb --json status,conclusion,jobs

# Watch a run in real-time
gh run watch <RUN_ID> --repo robertjbass/hostdb

# Get failed job logs
gh run view <RUN_ID> --repo robertjbass/hostdb --log-failed
```

## Workflow Concurrency

The workflow has a concurrency setting that **queues** builds instead of running them in parallel:
```yaml
concurrency:
  group: release-postgresql-documentdb
  cancel-in-progress: false
```

This means if you trigger darwin-x64 while linux-arm64 is building, darwin-x64 will wait in the queue.

## Build Times

| Platform | Method | Typical Duration |
|----------|--------|------------------|
| darwin-arm64 | Native (macos-14) | 30-45 min |
| darwin-x64 | Native (macos-15-intel) | 30-45 min |
| linux-x64 | Docker | 5-10 min |
| linux-arm64 | Docker + QEMU | 45-90 min |
| win32-x64 | Docker | 5-10 min |

## After Build Completes

### 1. Verify Release Assets
```bash
gh release view postgresql-documentdb-17-0.107.0 --repo robertjbass/hostdb --json assets --jq '.assets[].name'
```

Should show all 5 platforms:
- postgresql-documentdb-17-0.107.0-darwin-arm64.tar.gz
- postgresql-documentdb-17-0.107.0-darwin-x64.tar.gz
- postgresql-documentdb-17-0.107.0-linux-arm64.tar.gz
- postgresql-documentdb-17-0.107.0-linux-x64.tar.gz
- postgresql-documentdb-17-0.107.0-win32-x64.zip

### 2. Update releases.json (if needed)
```bash
pnpm update:releases -- --database postgresql-documentdb --version 17-0.107.0 --tag postgresql-documentdb-17-0.107.0
```

### 3. Verify in SpinDB
```bash
cd ~/dev/spindb
pnpm start engines download ferretdb 2
pnpm start create test-fdb --engine ferretdb
pnpm start start test-fdb
pnpm start info test-fdb
pnpm start delete test-fdb --force
```

## Common Issues

### Build Frozen (linux-arm64)
QEMU ARM64 builds can appear frozen during long compilation steps. If no progress after 60+ minutes:
```bash
# Cancel the run
gh run cancel <RUN_ID> --repo robertjbass/hostdb

# Retrigger
gh workflow run release-postgresql-documentdb.yml --repo robertjbass/hostdb --ref main -f version=17-0.107.0 -f platforms=linux-arm64
```

### darwin-x64 SDK Issues
If darwin-x64 fails with `strchrnul` or SDK errors, the build script may need `MACOSX_DEPLOYMENT_TARGET` adjustment. Check `builds/postgresql-documentdb/build-macos.sh`.

### Release Asset Not Updated
If the workflow completes but the release still has old binaries:
```bash
# Delete old asset
gh release delete-asset postgresql-documentdb-17-0.107.0 postgresql-documentdb-17-0.107.0-<platform>.tar.gz --repo robertjbass/hostdb --yes

# Upload new asset (from workflow artifacts or local build)
gh release upload postgresql-documentdb-17-0.107.0 /path/to/artifact.tar.gz --repo robertjbass/hostdb
```

## Key Files

- `builds/postgresql-documentdb/build-macos.sh` - macOS build script (source build)
- `builds/postgresql-documentdb/build-linux.sh` - Linux build script (Docker)
- `.github/workflows/release-postgresql-documentdb.yml` - GitHub Actions workflow
- `databases.json` - Database status and platform support
- `releases.json` - Release manifest with download URLs

## Patches Applied in Build Scripts

Both build scripts apply these patches to fix upstream DocumentDB bugs:

1. **Token concatenation (`##`)** - PostgreSQL doesn't support C preprocessor-style `##`
2. **Wrong library references** - Functions like `bson_in`, `bsonquery_*` reference wrong library

See `builds/postgresql-documentdb/build-macos.sh` lines ~391-411 for the patch implementation.
