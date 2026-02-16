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

### TimescaleDB

- **Type:** Time-series
- **License:** Apache-2.0 / TSL
- **Repo:** https://github.com/timescale/timescaledb
- **Platforms:** linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64
- **Version:** 2.24.0
- **Why:** Time-series database built on PostgreSQL. Dual-licensed: core is Apache-2.0, advanced features under TSL which restricts competing DBaaS.
- **Dependencies:** PostgreSQL extension, not standalone.
- **Notes:** TSL restricts offering as a competing managed database service.

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
