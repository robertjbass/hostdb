# FerretDB v1

Open-source MongoDB alternative using plain PostgreSQL as the backend (v1.x line).

## Overview

FerretDB v1.x translates MongoDB wire protocol queries to PostgreSQL SQL, allowing applications to use MongoDB drivers while storing data in a standard PostgreSQL database. Unlike FerretDB v2.x, v1 does not require the DocumentDB extension.

## Differences from FerretDB v2

| Feature | FerretDB v1 (this) | FerretDB v2 |
|---------|--------------------|-|
| Backend | Plain PostgreSQL | PostgreSQL + DocumentDB |
| Database ID | `ferretdb-v1` | `ferretdb` |
| Dependency | `postgresql` | `postgresql-documentdb` |
| MongoDB compatibility | Basic | Extended |

## Binary Sources

| Platform | Source | Notes |
|----------|--------|-------|
| linux-x64 | Official | Direct binary from GitHub releases |
| linux-arm64 | Official | Direct binary from GitHub releases |
| darwin-x64 | Build | Go cross-compilation |
| darwin-arm64 | Build | Go cross-compilation |
| win32-x64 | Build | Go cross-compilation |

## Bundled Components

Each release bundles:
- **FerretDB** - MongoDB proxy server
- **mongosh** - MongoDB Shell for connecting and querying
- **database-tools** - mongodump, mongorestore, etc.

## Building from Source

FerretDB is written in Go, making cross-compilation trivial:

```bash
# Clone the repository
git clone https://github.com/FerretDB/FerretDB.git
cd FerretDB
git checkout v1.24.2

# Cross-compile for different platforms
GOOS=darwin GOARCH=amd64 go build -o ferretdb-darwin-x64 ./cmd/ferretdb
GOOS=darwin GOARCH=arm64 go build -o ferretdb-darwin-arm64 ./cmd/ferretdb
GOOS=windows GOARCH=amd64 go build -o ferretdb-windows-x64.exe ./cmd/ferretdb
```

## Download Script

```bash
# Download for current platform
pnpm download:ferretdb-v1 -- --version 1.24.2

# Download for all platforms (requires Go for macOS/Windows)
pnpm download:ferretdb-v1 -- --version 1.24.2 --all-platforms

# Download for specific platform
pnpm download:ferretdb-v1 -- --version 1.24.2 --platform darwin-arm64
```

## Archive Structure

```
ferretdb/
├── bin/
│   ├── ferretdb          # FerretDB server
│   ├── mongosh           # MongoDB Shell
│   ├── mongodump         # Database tools
│   ├── mongorestore
│   ├── mongoexport
│   ├── mongoimport
│   └── ...
└── .hostdb-metadata.json
```

## License

Apache-2.0 - Fully permissive for commercial use.
