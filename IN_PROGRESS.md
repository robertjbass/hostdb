# IN_PROGRESS.md

> **Note:** This file is used to persist work-in-progress information between Claude Code sessions. When starting a new session, say "review IN_PROGRESS.md" to continue where you left off.

---

## FerretDB/postgresql-documentdb Release Progress

This section tracks the release process for `postgresql-documentdb-17-0.107.0` binaries.

## Current Status (as of 2026-01-25 ~5:00am UTC)

| Platform | Status | Notes |
|----------|--------|-------|
| darwin-arm64 | ✅ Verified | Working in SpinDB |
| darwin-x64 | ⏳ Untested | Binary exists, needs verification |
| linux-x64 | ✅ Working | Libraries bundle correctly, binaries run |
| linux-arm64 | ⏳ Building | GitHub Actions triggered, 45-90 min build |
| win32-x64 | ⏳ Untested | Binary exists, needs verification |

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

### Remaining Issue (SpinDB, not hostdb)

SpinDB Docker E2E test shows PostgreSQL startup failure due to missing locale:
```
LOG: invalid value for parameter "lc_messages": "en_US.UTF-8"
FATAL: configuration file contains errors
```

This is a SpinDB/Docker configuration issue (locale not installed), not a hostdb binary issue. The binaries themselves work correctly.

## Next Steps

1. ✅ linux-x64 build is complete and verified
2. ⏳ Wait for linux-arm64 build to complete (~45-90 min)
3. Fix SpinDB Docker test to install locale or use C locale
4. Test darwin-x64 and win32-x64 platforms

## Monitoring Commands

```bash
# Check linux-arm64 build status
gh run list --repo robertjbass/hostdb --workflow=release-postgresql-documentdb.yml --limit 3

# View specific run
gh run view <RUN_ID> --repo robertjbass/hostdb --json status,conclusion,jobs

# Trigger a rebuild if needed
gh workflow run release-postgresql-documentdb.yml --repo robertjbass/hostdb --ref main -f version=17-0.107.0 -f platforms=linux-arm64
```
