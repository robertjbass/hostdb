# IN_PROGRESS.md

> **Note:** This file is used to persist work-in-progress information between Claude Code sessions. When starting a new session, say "review IN_PROGRESS.md" to continue where you left off.

---

## sqlite-vec

Add support for sqlite-vec to have an embeddable file-based vector database offering. sqlite-vec is a SQLite loadable extension (.so/.dylib/.dll) that adds vec0 virtual tables for vector indexing with KNN queries. Pure C, zero dependencies, pre-built for all 5 hostdb platforms. Added to `databases.json` as `pending` with version `0.1.6`.

## TypeDB

TypeDB has been integrated into SpinDB but not LayerBase Desktop.

## InfluxDB

InfluxDB has not yet been added to SpinDB. The hostdb build infrastructure is in place (download script, workflow, darwin-x64 source build) but SpinDB integration is still pending.

**Action needed:** Re-run the full InfluxDB release workflow overnight (all platforms). The previous run built the executables successfully but was an incomplete run that didn't update the releases.json manifest. The darwin-x64 source build takes ~2 hours so plan to kick it off before bed.

## FerretDB Windows Support

Need to add DocumentDB extension support for Windows to get FerretDB working on Windows. Currently postgresql-documentdb win32-x64 builds with pgvector only (319MB) — DocumentDB extension itself does not compile on Windows yet.

## FerretDB v1

Consider adding support for FerretDB v1, which does not require postgresql-documentdb as a backend. This would provide a simpler MongoDB-compatible option that avoids the DocumentDB extension build complexity, especially relevant for Windows where DocumentDB is not yet supported.
