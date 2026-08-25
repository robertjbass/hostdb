# Database Prospects

Databases we plan to add or have evaluated and decided not to support.

## Planned

Databases we intend to add to hostdb. Listed roughly by priority/readiness.

### sqlite-vec

- **Type:** Vector
- **License:** Apache-2.0
- **Repo:** https://github.com/asg017/sqlite-vec
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 0.1.6
- **Why:** SQLite loadable extension for vector similarity search (KNN queries). Pure C, zero dependencies. Pre-built loadable extensions available for all 5 platforms on GitHub Releases. Natural fit since SQLite is already in hostdb — could bundle the extension with SQLite releases or distribute separately. Mozilla Builders backed. Successor to deprecated sqlite-vss (which used FAISS). Supports metadata columns, partition keys, and auxiliary columns.
- **Dependencies:** Requires SQLite 3.41+ as host. Loaded via `.load vec0` in sqlite3 CLI.
- **Notes:** Last stable release v0.1.6 (Nov 2024), alpha v0.1.7 (Jan 2025) — development pace is slow but project is not abandoned.

### Firebird

- **Type:** Relational
- **License:** IDPL-1.0
- **Repo:** https://github.com/FirebirdSQL/firebird
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 5.0.3
- **Why:** Single-file database supporting both embedded (no server process, like SQLite) and client/server modes. Official pre-built binaries available for all platforms. Full SQL support with stored procedures and triggers.

### OpenSearch

- **Type:** Search
- **License:** Apache-2.0
- **Repo:** https://github.com/opensearch-project/OpenSearch
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 3.4.0
- **Why:** AWS fork of Elasticsearch. Distributed search and analytics engine with REST API. Fully open-source.

### TiDB

- **Type:** Distributed SQL
- **License:** Apache-2.0
- **Repo:** https://github.com/pingcap/tidb
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64 (no Windows)
- **Version:** 8.5.4
- **Why:** Distributed SQL with MySQL wire protocol compatibility and horizontal scalability. Can run standalone with UniStore (without TiKV/PD).
- **Notes:** No native Windows binary. macOS binaries only available via TiUP package manager, not direct download.

### RocksDB

- **Type:** Embedded KV
- **License:** GPL-2.0 OR Apache-2.0
- **Repo:** https://github.com/facebook/rocksdb
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 10.10.1
- **Why:** High-performance embedded key-value store (LSM trees) by Meta. Library-first with `ldb` and `sst_dump` CLI tools. Widely used as storage engine by CockroachDB, TiKV, MySQL/MyRocks.
- **Notes:** No official pre-built binaries — build from source required for all platforms.

### Apache Cassandra

- **Type:** Distributed NoSQL
- **License:** Apache-2.0
- **Repo:** https://github.com/apache/cassandra
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 5.0.6
- **Why:** Distributed NoSQL designed for high availability, linear scalability, and fault tolerance.
- **Notes:** Java-based; requires JVM bundled or installed. This is a significant packaging challenge.

### Gel (formerly EdgeDB)

- **Type:** Multi-model
- **License:** Apache-2.0
- **Repo:** https://github.com/geldata/gel
- **Platforms:** linux-x64, darwin-x64, darwin-arm64 (no Windows, linux-arm64 uncertain)
- **Version:** 7.0.0
- **Why:** Graph-relational database built on PostgreSQL with strict typing and declarative schema.
- **Notes:** No Windows binary (Docker only). No GitHub Release assets — distributed via custom install script. linux-arm64 support uncertain.

### RabbitMQ

- **Type:** Message Queue (would be a new type — hostdb has no Message Queue category today)
- **License:** Apache-2.0 / MPL-2.0
- **Repo:** https://github.com/rabbitmq/rabbitmq-server
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 4.1.x (latest stable line)
- **Why:** Industry-standard open-source message broker; natural complement to Redis (already in hostdb as a broker-capable engine). Expands hostdb's scope from "databases" to "stateful services."
- **Dependencies:** Requires Erlang/OTP runtime bundled with every platform tarball — no other hostdb engine drags a full language VM along. Tight version coupling: each RabbitMQ minor supports a narrow OTP range. Likely use compound version keys (`4.1.5-otp27`), same shape as `postgresql-documentdb` uses `17-0.107.0`.
- **Notes:**
  - Linux is easy — Docker-extract from `rabbitmq:X.Y-management` (same pattern as CouchDB, which is also Erlang-based and already ships a bundled Erlang inside its image).
  - macOS is the hard part — needs a relocatable Erlang/OTP built from source on the runner, with `install_name_tool` dylib patching for the crypto/ssl NIFs (existing `builds/common/fix-macos-dylibs.sh` pattern). ~30–60 min/platform build.
  - Windows: extract Erlang's official installer via `7z`, ship a `.bat` wrapper that sets `ERLANG_HOME` to the bundled path.
  - epmd is a node-wide singleton on port 4369 — spindb's port-mapping needs per-instance `RABBITMQ_NODENAME`s for multiple concurrent instances.
  - Decide before starting: ship `rabbitmq_management` plugin enabled by default (most dev workflows want the UI on :15672)?
  - **Strategic question first:** does hostdb want to broaden from "databases" to "stateful services"? If yes, NATS / Kafka / Temporal become obvious next entries (and are all easier than RabbitMQ — none drag a VM along).

---

## Unsupported

Databases we've evaluated and decided not to add, with reasoning.

### ArangoDB

- **Type:** Multi-model
- **License:** BSL-1.1 / ArangoDB Community License
- **Repo:** https://github.com/arangodb/arangodb
- **Why not:** License changed to BSL-1.1 (source) + ArangoDB Community License (binaries) in v3.12. Community binaries have 100GB dataset limit. Dropped native macOS and Windows binaries in v3.12 (Docker only). linux-arm64 is evaluation-only, not production-recommended.

### Chroma

- **Type:** Vector
- **License:** Apache-2.0
- **Repo:** https://github.com/chroma-core/chroma
- **Why not:** Python-only distribution via pip. No standalone native binaries for any platform. Rust core is compiled as Python extension, not standalone executable.

### Dgraph

- **Type:** Multi-model
- **License:** Apache-2.0
- **Repo:** https://github.com/dgraph-io/dgraph
- **Why not:** Official binaries are Linux-only since v21.03.0 (macOS/Windows dropped Feb 2021). Requires two processes (dgraph zero + dgraph alpha) with no single-process mode. Dynamically links jemalloc which blocks Windows builds. Ratel UI removed from binary, now separate project. Acquired twice (Dgraph Labs -> Hypermode -> Istari Digital Oct 2025).

### DuckDB VSS

- **Type:** Vector
- **License:** MIT
- **Repo:** https://github.com/duckdb/duckdb_vss
- **Why not:** DuckDB extension, not a standalone database. Auto-installs within DuckDB via `INSTALL vss; LOAD vss;`. Explicitly marked experimental and not production-ready by the DuckDB team — WAL recovery is not implemented for custom HNSW indexes, risking data loss on crash. No separate GitHub releases; distributed through DuckDB's built-in extension hub. Since DuckDB is already in hostdb, this would not be a separate entry — could potentially be pre-bundled with DuckDB releases if it reaches production status.

### Kuzu

- **Type:** Graph
- **License:** MIT
- **Repo:** https://github.com/kuzudb/kuzu
- **Why not:** Repo archived Oct 2025 ("Kuzu is working on something new"). Community forks: Ladybug (ex-Facebook/Google lead), Bighorn (Kineviz), RyuGraph (Predictable Labs). No clear successor yet. Last release v0.11.3 binaries still downloadable but unmaintained.

### Milvus

- **Type:** Vector
- **License:** Apache-2.0
- **Repo:** https://github.com/milvus-io/milvus
- **Why not:** Docker-only distribution. No native binaries for any platform. Complex multi-component architecture requiring etcd + MinIO — even "standalone" mode needs both running alongside the server. CGO dependencies (C++ FAISS/Knowhere vector index libraries) prevent pure Go cross-compilation. GitHub releases contain only Docker Compose files. Linux-only even in Docker.
- **Re-reviewed 2026-08-14 — decision unchanged.** Beyond the packaging problem, the multi-component architecture is a downstream blocker: every spindb engine is a single supervised server process, so Milvus would force a multi-process orchestration concept into spindb's lifecycle (start/stop/status/branch) that no other engine needs. Docker-only distribution is also a direct contradiction of spindb's "local databases without Docker" premise. The vector slot is already covered by Qdrant and Weaviate. Do not re-investigate unless Milvus ships single-binary native releases with embedded metadata/object storage.

### TimescaleDB

- **Type:** Time-series
- **License:** Apache-2.0 (core) / TSL (advanced features)
- **Repo:** https://github.com/timescale/timescaledb
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 2.24.0
- **Why not (decided 2026-08-14):** Three reasons, in order of weight.
  1. **Licensing is asymmetric across the ecosystem.** Core is Apache-2.0, but the features people actually adopt Timescale for — columnar compression, continuous aggregates, hyperfunctions — are TSL, which bars offering the software as a competing managed database service. That is fine for local spindb/desktop use and a direct problem for layerbase-cloud, which is exactly such a service. Timescale would be the first engine needing `hostedServiceAllowed: false` on the build users actually want, which means two divergent artifacts (Apache-2.0-only for cloud, full community for local) — cost we are not taking on for one engine.
  2. **It is a PostgreSQL extension, not a database.** Shipping it as its own engine means a duplicate PostgreSQL binary matrix per version plus spindb's full 20+ file engine checklist, for something that is not a server. The correct shape is a generalized "PostgreSQL extension flavors" mechanism (`spindb create postgresql --extensions ...`), generalizing the existing `postgresql-documentdb` one-off. If that mechanism is ever built, pgvector and PostGIS are the higher-demand first flavors — Timescale would follow, under the constraint in (1).
  3. **Non-trivial downstream work past the binary.** Hypertable dumps require bracketing `pg_restore` with `timescaledb_pre_restore()` / `timescaledb_post_restore()` and a version-matched extension on the target, so spindb's restore path needs real engine-specific handling, not just a download-path change.
- **Re-open only if:** the extension-flavor mechanism lands in spindb for pgvector/PostGIS first, *or* the TSL terms change such that a managed service can offer the full community build. Re-verify licensing before any re-evaluation — Timescale rebranded to TigerData and moved licensing terms around in 2025.
