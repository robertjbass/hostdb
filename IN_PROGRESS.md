# IN_PROGRESS.md

> **Note:** This file is used to persist work-in-progress information between Claude Code sessions. When starting a new session, say "review IN_PROGRESS.md" to continue where you left off.

---

## FerretDB Release Plan

This section tracks the release process for `postgresql-documentdb-17-0.107.0` binaries.

## Current Status (as of 2026-01-24 ~6:15pm CST)

Only **darwin-arm64** is confirmed working. Linux builds are **broken** (missing bundled libraries).

| Platform | Status | Notes |
|----------|--------|-------|
| darwin-arm64 | ✅ Confirmed | Working in SpinDB |
| darwin-x64 | ⏳ Untested | Binary exists, needs verification |
| linux-x64 | ❌ Broken | Missing bundled libraries |
| linux-arm64 | ❌ Broken | Missing bundled libraries |
| win32-x64 | ⏳ Untested | Binary exists, needs verification |

### Linux Build Problem

The Linux builds are **missing bundled shared libraries**. Unlike the macOS build which bundles all Homebrew dependencies into `lib/`, the Linux build only sets RPATH but doesn't actually copy the libraries.

**Missing libraries:**
- `libpq.so.5` - PostgreSQL client library (built by us, but not copied to lib/)
- `libicuuc.so.72` - ICU libraries (system version mismatch: built with 72, Docker has 70)

**Root cause:**
- macOS `build-macos.sh` has ~200 lines of library bundling code (lines 536-751)
- Linux `build-linux.sh` only has ~20 lines that set RPATH (lines 320-336)
- Linux build needs equivalent bundling logic using `ldd` and `patchelf`

**Fix needed in `builds/postgresql-documentdb/build-linux.sh`:**
1. After building PostgreSQL, copy `libpq.so*` from the install to `lib/`
2. Use `ldd` to find all non-system dependencies
3. Bundle ICU, OpenSSL, readline, etc. to `lib/`
4. Use `patchelf` to set proper RPATH on all bundled libs

### Active Workflow Runs

```bash
# Check current runs
gh run view 21323166182 --repo robertjbass/hostdb --json status,conclusion
gh run view 21323200833 --repo robertjbass/hostdb --json status,conclusion
```

## Platform Verification Checklist

Each platform needs to be tested in SpinDB to confirm the binaries work.

### darwin-arm64 ✅ VERIFIED
Already confirmed working in SpinDB.

### darwin-x64 - Needs Testing
Requires Intel Mac or Rosetta:
```bash
# Option 1: On Apple Silicon with Rosetta
arch -x86_64 zsh -c "cd ~/dev/spindb && pnpm start engines download ferretdb 2"

# Option 2: On Intel Mac directly
pnpm start engines download ferretdb 2
pnpm start create test-fdb --engine ferretdb
pnpm start start test-fdb
pnpm start info test-fdb
pnpm start delete test-fdb --force
```

### linux-x64 - Needs Testing
Test with Docker:
```bash
docker run --rm -it -v ~/.spindb-test:/root/.spindb node:20 bash -c "
  npm install -g spindb &&
  spindb engines download ferretdb 2 &&
  spindb create test-fdb --engine ferretdb &&
  spindb start test-fdb &&
  spindb info test-fdb &&
  spindb delete test-fdb --force
"
```

### linux-arm64 - Needs Testing
Test with Docker on ARM (M1/M2 Mac runs ARM containers natively):
```bash
docker run --rm -it --platform linux/arm64 -v ~/.spindb-test-arm:/root/.spindb node:20 bash -c "
  npm install -g spindb &&
  spindb engines download ferretdb 2 &&
  spindb create test-fdb --engine ferretdb &&
  spindb start test-fdb &&
  spindb info test-fdb &&
  spindb delete test-fdb --force
"
```

### win32-x64 - Needs Testing
Requires Windows machine or VM:
```powershell
npm install -g spindb
spindb engines download ferretdb 2
spindb create test-fdb --engine ferretdb
spindb start test-fdb
spindb info test-fdb
spindb delete test-fdb --force
```

---

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
