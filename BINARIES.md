# Binary Structure Reference

Archive structure for each database distributed by hostdb.

## Archive Contents

| Database | Root Directory | Root Contents | Server | Client |
|----------|----------------|---------------|--------|--------|
| MySQL | `mysql/` | `bin/` `lib/` `share/` `LICENSE` `.hostdb-metadata.json` | `bin/mysqld` | `bin/mysql` |
| PostgreSQL | `postgresql/` | `bin/` `lib/` `share/` `.hostdb-metadata.json` | `bin/postgres` | `bin/psql` |
| MariaDB | `mariadb/` | `bin/` `lib/` `share/` `man/` `.hostdb-metadata.json` | `bin/mariadbd` | `bin/mariadb` |
| MongoDB | `mongodb/` | `bin/` `.hostdb-metadata.json` | `bin/mongod` | `bin/mongosh` |
| Redis | `redis/` | `bin/` `.hostdb-metadata.json` | `bin/redis-server` | `bin/redis-cli` |
| Valkey | `valkey/` | `bin/` `.hostdb-metadata.json` | `bin/valkey-server` | `bin/valkey-cli` |
| SQLite | `sqlite/` | `bin/` `.hostdb-metadata.json` | — | `bin/sqlite3` |
| DuckDB | `duckdb/` | `duckdb` `.hostdb-metadata.json` | — | `duckdb` |
| ClickHouse | `clickhouse/` | `bin/` `.hostdb-metadata.json` | `bin/clickhouse` | `bin/clickhouse` |
| Qdrant | `qdrant/` | `qdrant` `.hostdb-metadata.json` | `qdrant` | — (HTTP) |
| Meilisearch | `meilisearch/` | `meilisearch` `.hostdb-metadata.json` | `meilisearch` | — (HTTP) |

## Detailed Structure

### Multi-file (bin/ subdirectory)

```
mysql/
├── bin/
│   ├── mysqld
│   ├── mysql
│   ├── mysqldump
│   └── ...
├── lib/
├── share/
└── .hostdb-metadata.json

postgresql/
├── bin/
│   ├── postgres
│   ├── psql
│   ├── pg_dump
│   └── ...
├── lib/
├── share/
└── .hostdb-metadata.json

mariadb/
├── bin/
│   ├── mariadbd
│   ├── mariadb
│   ├── mariadb-dump
│   └── ...
├── lib/
├── share/
└── .hostdb-metadata.json

mongodb/
├── bin/
│   ├── mongod
│   ├── mongosh
│   ├── mongodump
│   ├── mongorestore
│   └── ...
└── .hostdb-metadata.json

redis/
├── bin/
│   ├── redis-server
│   ├── redis-cli
│   └── redis-benchmark
└── .hostdb-metadata.json

valkey/
├── bin/
│   ├── valkey-server
│   ├── valkey-cli
│   └── valkey-benchmark
└── .hostdb-metadata.json

sqlite/
├── bin/
│   ├── sqlite3
│   ├── sqldiff
│   └── sqlite3_analyzer
└── .hostdb-metadata.json

clickhouse/
├── bin/
│   ├── clickhouse           # monolithic binary
│   ├── clickhouse-server -> clickhouse
│   ├── clickhouse-client -> clickhouse
│   └── clickhouse-local -> clickhouse
└── .hostdb-metadata.json
```

### Single binary (no bin/ subdirectory)

```
duckdb/
├── duckdb                   # or duckdb.exe on Windows
└── .hostdb-metadata.json

qdrant/
├── qdrant                   # or qdrant.exe on Windows
└── .hostdb-metadata.json

meilisearch/
├── meilisearch              # or meilisearch.exe on Windows
└── .hostdb-metadata.json
```

## Archive Formats

| Platform | Format | Extension |
|----------|--------|-----------|
| linux-x64 | gzip tarball | `.tar.gz` |
| linux-arm64 | gzip tarball | `.tar.gz` |
| darwin-x64 | gzip tarball | `.tar.gz` |
| darwin-arm64 | gzip tarball | `.tar.gz` |
| win32-x64 | zip | `.zip` |

**Exception:** ClickHouse has no Windows support (use WSL).

## Metadata File

Every archive includes `.hostdb-metadata.json`:

```json
{
  "name": "mysql",
  "version": "8.4.3",
  "platform": "darwin-arm64",
  "source": "official",
  "rehosted_by": "hostdb",
  "rehosted_at": "2024-01-15T10:30:00Z"
}
```

## Quick Reference

| Database | Has `bin/` subdir | Binary count | Client type |
|----------|-------------------|--------------|-------------|
| MySQL | Yes | Many | CLI (`mysql`) |
| PostgreSQL | Yes | Many | CLI (`psql`) |
| MariaDB | Yes | Many | CLI (`mariadb`) |
| MongoDB | Yes | Many | CLI (`mongosh`) |
| Redis | Yes | Few | CLI (`redis-cli`) |
| Valkey | Yes | Few | CLI (`valkey-cli`) |
| SQLite | Yes | Few | CLI (`sqlite3`) |
| DuckDB | No | 1 | CLI (`duckdb`) |
| ClickHouse | Yes | 1 + symlinks | CLI (`clickhouse client`) |
| Qdrant | No | 1 | HTTP API only |
| Meilisearch | No | 1 | HTTP API only |
