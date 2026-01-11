# SQLite

SQLite is a self-contained, serverless, zero-configuration SQL database engine. It's the most widely deployed database in the world.

## Versions

| Version | Notes |
|---------|-------|
| **3.51.2** | Latest stable |

SQLite doesn't have LTS versions - they expect everyone to use the latest due to extreme backward compatibility.

## Platforms

| Platform | Source | Notes |
|----------|--------|-------|
| linux-x64 | Official binary | From sqlite.org |
| linux-arm64 | **Source build** | No official binary available |
| darwin-x64 | Official binary | From sqlite.org |
| darwin-arm64 | Official binary | From sqlite.org |
| win32-x64 | Official binary | From sqlite.org |

## Included Tools

The SQLite tools package includes:

| Tool | Description |
|------|-------------|
| `sqlite3` | Interactive command-line shell |
| `sqldiff` | Database diff utility |
| `sqlite3_analyzer` | Storage analyzer |
| `sqlite3_rsync` | Remote database sync |

## Usage

```bash
# Download for current platform
pnpm download:sqlite

# Download specific version
pnpm download:sqlite -- --version 3.51.2

# Download for specific platform
pnpm download:sqlite -- --version 3.51.2 --platform darwin-arm64

# Download for all platforms (skips linux-arm64 which needs source build)
pnpm download:sqlite -- --all-platforms
```

## Building linux-arm64

Since SQLite doesn't provide ARM64 Linux binaries, we build from source:

```bash
# Local Docker build
./builds/sqlite/build-local.sh --version 3.51.2

# Or via GitHub Actions workflow
# (automatically handles linux-arm64 with Docker build)
```

## Output Structure

```
sqlite/
├── bin/
│   ├── sqlite3           # Main CLI
│   ├── sqldiff           # Diff tool
│   ├── sqlite3_analyzer  # Analyzer
│   └── sqlite3_rsync     # Sync tool
└── .hostdb-metadata.json
```

## Checksums

SQLite uses **SHA3-256** checksums (not SHA-256). The download script verifies against the `sha3_256` field in `sources.json`.

## License

SQLite is in the **public domain**. No restrictions on use, modification, or distribution.

## Sources

- [SQLite Download Page](https://sqlite.org/download.html)
- [SQLite Documentation](https://sqlite.org/docs.html)
- [Source Repository](https://github.com/sqlite/sqlite)

## Notes

- SQLite is an embedded database - no server process required
- The CLI tools are statically linked and self-contained
- Version numbering in filenames: 3.51.2 → 3510200 (MAJOR×1000000 + MINOR×1000 + PATCH×100)
