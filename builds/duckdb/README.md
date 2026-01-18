# DuckDB Builds

Download and repackage DuckDB binaries for distribution via GitHub Releases.

## Status

**In Progress** - Official binaries available for all platforms, no source builds needed.

## Supported Versions

- 1.4.3

## Supported Platforms

- `linux-x64` - Linux x86_64
- `linux-arm64` - Linux ARM64
- `darwin-x64` - macOS Intel
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

## Binary Sources

All binaries are sourced directly from official DuckDB GitHub releases.

| Source | Platforms | Format |
|--------|-----------|--------|
| [GitHub Releases](https://github.com/duckdb/duckdb/releases) | All | .gz (Linux), .zip (macOS/Windows) |

## Archive Format

DuckDB distributes binaries in two formats:
- **Linux**: gzip-compressed single binary (`.gz`)
- **macOS/Windows**: zip archive containing single binary (`.zip`)

hostdb repackages these into:
- **Unix** (Linux/macOS): `.tar.gz` with `duckdb/` directory
- **Windows**: `.zip` with `duckdb/` directory

Each archive contains:
- `duckdb` (or `duckdb.exe` on Windows) - the DuckDB CLI binary
- `.hostdb-metadata.json` - metadata about the rehosted binary

## Usage

```bash
# Download for current platform
pnpm download:duckdb

# Download specific version
pnpm download:duckdb -- --version 1.4.3

# Download for specific platform
pnpm download:duckdb -- --version 1.4.3 --platform darwin-arm64

# Download for all platforms
pnpm download:duckdb -- --all-platforms
```

## URL Pattern

GitHub release URLs follow this pattern:
```
https://github.com/duckdb/duckdb/releases/download/v{VERSION}/duckdb_cli-{platform}.{ext}
```

Platform mapping:
| hostdb Platform | DuckDB Platform | Extension |
|-----------------|-----------------|-----------|
| linux-x64 | linux-amd64 | .gz |
| linux-arm64 | linux-arm64 | .gz |
| darwin-x64 | osx-amd64 | .zip |
| darwin-arm64 | osx-arm64 | .zip |
| win32-x64 | windows-amd64 | .zip |

## Related Links

- [DuckDB Official Site](https://duckdb.org/)
- [DuckDB Documentation](https://duckdb.org/docs/)
- [DuckDB GitHub](https://github.com/duckdb/duckdb)
- [DuckDB Releases](https://github.com/duckdb/duckdb/releases)
