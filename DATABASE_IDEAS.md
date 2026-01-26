# Database Candidates

This document tracks all database candidates for hostdb, organized by status and viability.

## Supported (Already Integrated)

Databases with binaries already built and released.

| Database | Stars | License | Platforms | Type |
|----------|-------|---------|-----------|------|
| MySQL | 12K | GPL-2.0 | All 5 | Relational |
| MariaDB | 13K | GPL-2.0 | All 5 | Relational |
| PostgreSQL | 18K | PostgreSQL | All 5 | Relational |
| PostgreSQL-DocumentDB | - | Apache-2.0 | All 5 | Document |
| MongoDB | 28K | SSPL-1.0 | All 5 | Document |
| CouchDB | 6K | Apache-2.0 | All 5 | Document |
| FerretDB | 10K | Apache-2.0 | All 5 | Document |
| Redis | 68K | RSALv2/SSPL | All 5 | Key-Value |
| Valkey | 20K | BSD-3-Clause | All 5 | Key-Value |
| SQLite | 8K | Public Domain | All 5 | Embedded SQL |
| DuckDB | 30K | MIT | All 5 | Analytical |
| ClickHouse | 40K | Apache-2.0 | 4 (no Win) | Analytical |
| Qdrant | 24K | Apache-2.0 | All 5 | Vector |
| Meilisearch | 52K | MIT | All 5 | Search |
| CockroachDB | 31K | CCL | All 5 | Distributed SQL |
| SurrealDB | 31K | BSL-1.1 | All 5 | Multi-model |

## Priority Queue (Next to Implement)

### Quick Wins (Single Cross-Platform Binaries)

| # | Database | Stars | Binary | Why Quick |
|---|----------|-------|--------|-----------|
| 1 | **Weaviate** | 15K | Go | All 5 platforms, binary on GitHub releases |

### Then: Popular + Not Painful

| # | Database | Stars | Difficulty | Why This Order |
|---|----------|-------|------------|----------------|
| 4 | **TimescaleDB** | 18K | Medium | PG extension - we already have PostgreSQL builds |
| 5 | **Milvus** | 42K | High | Most stars, but needs etcd/minio, Linux-focused packaging |
| 6 | **Chroma** | 26K | Highest | Python-based - requires bundling runtime |

### Reference Links

- [CockroachDB Releases](https://www.cockroachlabs.com/docs/releases/) - official binaries
- [SurrealDB 2.0 Announcement](https://surrealdb.com/blog/surrealdb-delivers-future-ready-database-technology-for-developers-and-enterprises-with-release-of-surrealdb-2-0)
- [Weaviate Binary Install](https://forum.weaviate.io/t/how-to-run-weaviate-using-a-binary/100)
- [TimescaleDB Releases](https://github.com/timescale/timescaledb/releases)
- [Milvus Standalone Binary](https://milvus.io/docs/install_standalone-binary.md)
- [Chroma PyPI](https://pypi.org/project/chromadb/)

---

## Later Queue (Added to databases.json)

These databases are in databases.json as pending but will be implemented after the priority queue.

| Database | Stars | License | Type | Notes |
|----------|-------|---------|------|-------|
| **Dgraph** | 21K | Apache-2.0 | Multi-model | Native GraphQL, single Go binary |
| **Gel** | ~15K | Apache-2.0 | Multi-model | Formerly EdgeDB, PostgreSQL-based |
| **TiDB** | 38K | Apache-2.0 | Distributed SQL | Official binaries, MySQL-compatible |
| **QuestDB** | 15K | Apache-2.0 | Time-series | Java-based, ships JVM |
| **OpenSearch** | 10K | Apache-2.0 | Search | Java-based, ships JVM |
| **ArangoDB** | 14K | Apache-2.0 | Multi-model | Official binaries available |
| **Cassandra** | 9K | Apache-2.0 | Distributed NoSQL | Java dependency, high complexity |

## Difficult (Popular But Unlikely to Execute)

Popular databases with licensing or technical barriers.

| Database | Stars | License | Platforms | Issue |
|----------|-------|---------|-----------|-------|
| Elasticsearch | 72K | SSPL/Elastic | All 5 | License prohibits competitive services |
| Dragonfly | 30K | BSL-1.1 | 4 (WSL Win) | BSL restricts competitive cloud services |
| ScyllaDB | 14K | AGPL-3.0 | All 5 | AGPL network copyleft |
| Garnet | 10K | MIT | All 5 | Requires .NET runtime bundled |

## Unsupported (Licensing Reasons)

Databases with licenses incompatible with redistribution.

| Database | Stars | License | Issue |
|----------|-------|---------|-------|
| Neo4j | 14K | GPL-3.0 | Copyleft - derivatives must be GPL |
| Typesense | 22K | GPL-3.0 | Copyleft - derivatives must be GPL |
| MinIO | 51K | AGPL-3.0 | Network copyleft - any use triggers AGPL |

## Unsupported (Proprietary/Cloud-Only)

Databases without redistributable binaries.

| Database | Notes |
|----------|-------|
| Pinecone | Cloud-only, no binaries to redistribute |
| Fauna | Cloud-only, proprietary |
| PlanetScale | Cloud-only, proprietary |
| Supabase | Platform (not a DB itself) |

## Removed from databases.json

Databases previously considered but removed.

| Database | Reason |
|----------|--------|
| libSQL | Development stalled (last release Feb 2025), uncertain future |
| RocksDB | Embedded library, not standalone - doesn't fit hostdb's purpose |
| FoundationDB | Niche (Apple ecosystem), complex cluster setup |
| InfluxDB | Covered by QuestDB/TimescaleDB; v3 pivoted to cloud-first |
| KeyDB | Valkey won the Redis-fork war (Linux Foundation backing, 3x stars) |

## Unknown (Worth Researching Later)

Databases that may be worth adding in the future.

| Database | Stars | License | Type | Why Research |
|----------|-------|---------|------|--------------|
| TigerBeetle | 10K | Apache-2.0 | Financial OLTP | Niche but devoted users |
| RisingWave | 7K | Apache-2.0 | Streaming | No Windows, but growing |
| LanceDB | 5K | Apache-2.0 | Embedded Vector | Complements Qdrant |

---

## Sources

- [SurrealDB GitHub](https://github.com/surrealdb/surrealdb)
- [Weaviate GitHub](https://github.com/weaviate/weaviate)
- [Milvus 40K stars](https://www.prnewswire.com/news-releases/milvus-surpasses-40-000-github-stars-reinforcing-leadership-in-open-source-vector-databases-302646510.html)
- [Dgraph GitHub](https://github.com/dgraph-io/dgraph)
- [Chroma GitHub](https://github.com/chroma-core/chroma)
- [Gel (EdgeDB) rebrand](https://github.com/geldata/gel)
- [Pinecone alternatives](https://blog.apify.com/pinecone-alternatives/)
