# Version Upgrade Tracker

Last audited: 2026-03-11

## Prioritized Upgrade Plan

Ordered by impact. Work through top-to-bottom.

### Tier 1 — Security + Critical Fixes

- [ ] **PostgreSQL 15.15→15.17, 16.11→16.13, 17.7→17.9, 18.1→18.3** — Quarterly security/bugfix release. Most popular engine, 2 patches behind across all 4 lines. Patch bumps only (sources.json + databases.yml).
- [ ] **Valkey 8.0.6 → 8.0.7** — CVE-2026-21863 security fix. Patch bump only.
- [ ] **Redis 8.4.0 → 8.4.2** — Security fixes. Patch bump only.

### Tier 2 — High Impact, Low Effort

- [ ] **SQLite 3.51.2 → 3.52.0** — Fixes 15-year-old corruption bug. Single-binary engine, trivially updated.
- [ ] **DuckDB 1.4.3 → 1.5.0** — Hot engine, rapidly growing user base. New minor release (March 9, 2026). Also patch 1.4.3 → 1.4.4 in existing line.
- [ ] **MariaDB 10.11.15→10.11.16, 11.4.5→11.4.10, 11.8.5→11.8.6** — LTS maintenance patches across all 3 lines.

### Tier 3 — New Major Versions

- [ ] **SurrealDB 3.0.3** — Major version jump (Feb 17, 2026). 2.x likely superseded. Add 3.0, deprecate 2.3.2 (same pattern as MySQL).
- [ ] **Meilisearch 1.36.0** — Three minor versions behind. Fast-moving project.

### Tier 4 — Can Wait

- [ ] **Valkey 9.0.1 → 9.0.3** — Patch bump
- [ ] **MongoDB 8.0.17 → 8.0.19** — Patch bump
- [ ] **CockroachDB 25.4.2 → 25.4.6** — Patch bump
- [ ] **TigerBeetle 0.16.70 → 0.16.76** — Patch bump
- [ ] **ClickHouse 26.1.x / 26.2.x** — Two new major releases since 25.12
- [ ] **Qdrant 1.16.3 → 1.17.0** — New minor release
- [ ] **QuestDB 9.2.3 → 9.3.3** — New minor release
- [ ] **Weaviate 1.35.7 → 1.36.4** — New minor release
- [ ] **CockroachDB 26.1.0** — New Innovation release
- [ ] **Valkey 8.1.6** — New minor line (not yet hosted)
- [ ] **Redis 8.6.0** — New minor line (not yet hosted)
- [ ] **MariaDB 12.x** — New rolling release series (12.2.2 stable GA)

---

## Reference Sections

### Past EOL Versions

- [x] **MySQL 8.0.40, 9.1.0, 9.5.0** — Already deprecated in hostdb
- [ ] **MySQL 8.0** — EOL April 2026 (imminent). Already deprecated.
- [ ] **Redis 7.4.7** — EOL Nov 30, 2026 (~8.5 months). Consider deprecating once 8.x is stable.
- [x] **FerretDB 1.24.2** — v1 line kept for backwards compatibility. **No action needed.**
- [ ] **MongoDB 7.0.28** — EOL Aug 2027 (~17 months). Not urgent.
- [ ] **PostgreSQL 15.x** — EOL Nov 2027 (~20 months). Not urgent.
- [ ] **MariaDB 10.11.x** — EOL Feb 2028. Not urgent.

### Redundant Versions

- [x] **MySQL** — 8.0, 9.1, 9.5 already deprecated. Only 8.4 (LTS) + 9.6 (Innovation). **Done.**
- [x] **PostgreSQL 15, 16, 17, 18** — Each has a 5-year lifecycle. Users need to match production. **Justified.**
- [x] **Valkey 8.0 + 9.0** — Different major versions. **Justified.**
- [x] **Redis 7.4 + 8.4** — Different major versions. 7.4 approaching EOL. **No action yet.**
- [ ] **MariaDB 11.4 + 11.8** — Both 11.x, but both are LTS with different support windows. Keeping both is justified.
- [ ] **MongoDB 8.0 + 8.2** — Both 8.x. Consider whether both are needed once 8.2 is fully adopted.
- [x] **FerretDB 1.24 + 2.7** — v1 kept for backwards compatibility. **Justified.**

### PostgreSQL Details

| Line | Current | Latest | Status | Action |
|------|---------|--------|--------|--------|
| 15 | 15.15.0 | **15.17.0** | 2 patches behind | Update — quarterly security/bugfix release |
| 16 | 16.11.0 | **16.13.0** | 2 patches behind | Update — quarterly security/bugfix release |
| 17 | 17.7.0 | **17.9.0** | 2 patches behind | Update — quarterly security/bugfix release |
| 18 | 18.1.0 | **18.3.0** | 2 patches behind | Update — quarterly security/bugfix release |

PostgreSQL releases quarterly security updates (Feb, May, Aug, Nov). All four lines are 2 patches behind the Feb 2026 release. These should be updated together.

**PostgreSQL-DocumentDB**: 17-0.107.0 — up to date (tied to FerretDB 2.7.0).

---

## Version Check URLs

| Database | Check URL |
|----------|-----------|
| ClickHouse | https://github.com/ClickHouse/ClickHouse/releases |
| CockroachDB | https://github.com/cockroachdb/cockroach/releases |
| CouchDB | https://github.com/apache/couchdb/releases |
| DuckDB | https://github.com/duckdb/duckdb/releases |
| FerretDB | https://github.com/FerretDB/FerretDB/releases |
| InfluxDB | https://github.com/influxdata/influxdb/releases |
| MariaDB | https://mariadb.org/mariadb/all-releases/ |
| Meilisearch | https://github.com/meilisearch/meilisearch/releases |
| MongoDB | https://www.mongodb.com/docs/manual/release-notes/ |
| MySQL | https://dev.mysql.com/downloads/mysql/ |
| PostgreSQL | https://www.postgresql.org/docs/release/ |
| PostgreSQL-DocumentDB | https://github.com/FerretDB/documentdb/releases |
| Qdrant | https://github.com/qdrant/qdrant/releases |
| QuestDB | https://github.com/questdb/questdb/releases |
| Redis | https://github.com/redis/redis/releases |
| SQLite | https://sqlite.org/changes.html |
| SurrealDB | https://github.com/surrealdb/surrealdb/releases |
| TigerBeetle | https://github.com/tigerbeetle/tigerbeetle/releases |
| TypeDB | https://github.com/typedb/typedb/releases |
| Valkey | https://github.com/valkey-io/valkey/releases |
| Weaviate | https://github.com/weaviate/weaviate/releases |
