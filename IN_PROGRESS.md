# IN_PROGRESS.md

> **Note:** This file is used to persist work-in-progress information between Claude Code sessions. When starting a new session, say "review IN_PROGRESS.md" to continue where you left off.

---

## FerretDB/postgresql-documentdb Release Progress

This section tracks the release process for `postgresql-documentdb-17-0.107.0` binaries.

## Current Status (as of 2026-01-25 ~7:00am UTC)

| Platform | Status | Notes |
|----------|--------|-------|
| darwin-arm64 | ✅ Verified | Working in SpinDB |
| darwin-x64 | ✅ Built | Binary exists (42MB) |
| linux-x64 | ✅ Working | Libraries bundle correctly, binaries run (79MB) |
| linux-arm64 | ✅ Built | Build succeeded with 150min timeout (74MB) |
| win32-x64 | ✅ Built | Binary exists (319MB, pgvector only) |

### Key Fixes Applied (v0.14.19)

1. **Build mongo-c-driver from source** (v0.14.17)
   - Debian bookworm's libbson-dev was too old for DocumentDB v0.107.0
   - Now builds mongo-c-driver 1.29.0 for compatible libbson

2. **Fix DocumentDB extension check** (v0.14.18)
   - Use direct file existence check instead of `ls | grep`

3. **Don't bundle C/C++ runtime libraries** (v0.14.19)
   - Exclude libstdc++, libgfortran, libquadmath from bundling
   - These are tightly coupled with glibc and should use system version
   - Fixes glibc version mismatch on Ubuntu 22.04

### Verification Results (linux-x64)

Successfully tested in Docker (ubuntu:22.04 with linux/amd64):
- ✅ initdb --version works
- ✅ postgres --version works
- ✅ ldd shows all dependencies resolved
- ✅ Libraries correctly load from bundle (`lib/`) or system as appropriate
- ✅ No "not found" errors in ldd output

### Fixes Applied This Session

1. **Extended linux-arm64 build timeout** (commit 12652b3)
   - Previous build timed out at 60 min during PostGIS compilation
   - Extended timeout to 150 minutes for QEMU emulated builds

2. **Fixed SpinDB non-interactive mode** (spindb cli/commands/create.ts)
   - Docker E2E test was failing with "Cannot prompt in non-interactive mode"
   - Added TTY check: if no TTY and no explicit --start/--no-start, default to not starting

3. **Fixed locale issue** (spindb tests/docker/Dockerfile)
   - Added `locales` package and `locale-gen en_US.UTF-8`
   - PostgreSQL no longer fails with missing locale error

## Completed! 🎉

All 5 platforms built successfully:
- ✅ darwin-arm64 (35MB)
- ✅ darwin-x64 (42MB)
- ✅ linux-x64 (79MB)
- ✅ linux-arm64 (74MB) - Build run 21328096530 succeeded
- ✅ win32-x64 (319MB)

Release: https://github.com/robertjbass/hostdb/releases/tag/postgresql-documentdb-17-0.107.0

## Monitoring Commands

```bash
# Check linux-arm64 build status
gh run list --repo robertjbass/hostdb --workflow=release-postgresql-documentdb.yml --limit 3

# View specific run
gh run view <RUN_ID> --repo robertjbass/hostdb --json status,conclusion,jobs

# Trigger a rebuild if needed
gh workflow run release-postgresql-documentdb.yml --repo robertjbass/hostdb --ref main -f version=17-0.107.0 -f platforms=linux-arm64
```
