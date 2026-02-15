# FerretDB

Open-source MongoDB alternative using PostgreSQL as the backend.

## Overview

FerretDB translates MongoDB wire protocol queries to PostgreSQL SQL, allowing applications to use MongoDB drivers while storing data in PostgreSQL.

## Version Lines

FerretDB has two major version lines with different backend requirements:

| Version | Backend | Notes |
|---------|---------|-------|
| v2.x (e.g., 2.7.0) | PostgreSQL + DocumentDB extension | Extended MongoDB compatibility, more features |
| v1.x (e.g., 1.24.2) | Plain PostgreSQL | Lighter weight, works everywhere PostgreSQL runs |

Both version lines are built and released from the same workflow and `sources.json`. The download script handles version-specific differences automatically (e.g., different binary naming conventions, v1's `version.txt` requirement).

## Binary Sources

| Platform | Source | Notes |
|----------|--------|-------|
| linux-x64 | Official | Direct binary from GitHub releases |
| linux-arm64 | Official | Direct binary from GitHub releases |
| darwin-x64 | Build | Go cross-compilation |
| darwin-arm64 | Build | Go cross-compilation |
| win32-x64 | Build | Go cross-compilation |

**Binary naming differs between versions:**
- v2.x: `ferretdb-amd64-linux` (arch-os order)
- v1.x: `ferretdb-linux-amd64` (os-arch order)

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
git checkout v2.7.0

# Cross-compile for different platforms
GOOS=darwin GOARCH=amd64 go build -o ferretdb-darwin-x64 ./cmd/ferretdb
GOOS=darwin GOARCH=arm64 go build -o ferretdb-darwin-arm64 ./cmd/ferretdb
GOOS=windows GOARCH=amd64 go build -o ferretdb-windows-x64.exe ./cmd/ferretdb
```

**v1.x note:** FerretDB v1 embeds `build/version/version.txt` via `go:embed`. Without this file, the binary panics on startup. The download script generates it automatically before building.

## Download Script

```bash
# Download v2 for current platform
pnpm download:ferretdb -- --version 2.7.0

# Download v1 for all platforms (requires Go for macOS/Windows)
pnpm download:ferretdb -- --version 1.24.2 --all-platforms

# Download for specific platform
pnpm download:ferretdb -- --version 2.7.0 --platform darwin-arm64
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
