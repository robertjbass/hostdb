# SurrealDB Builds

Download and repackage SurrealDB binaries for distribution via GitHub Releases.

## Supported Versions

- 2.3.2

## Supported Platforms

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

## Binary Sources

| Source | Platforms | Versions | Format |
|--------|-----------|----------|--------|
| Official GitHub Releases | All | All | tgz (Unix), exe (Windows) |

SurrealDB distributes official binaries from their GitHub releases:
- Linux/macOS: `surreal-v{VERSION}.{platform}.tgz`
- Windows: `surreal-v{VERSION}.windows-amd64.exe` (raw binary)

The download script extracts/packages the `surreal` binary into tar.gz (Unix) or zip (Windows) archives with `.hostdb-metadata.json`.

## Single Binary Architecture

SurrealDB uses a single binary (`surreal`) for both server and client operations:
- **Server**: `surreal start`
- **Client**: `surreal sql`

## Usage

```bash
# Download for current platform
pnpm download:surrealdb

# Download specific version
pnpm download:surrealdb -- --version 2.3.2

# Download for all platforms
pnpm download:surrealdb -- --all-platforms

# Download for specific platform
pnpm download:surrealdb -- --version 2.3.2 --platform linux-x64
```

## Related Links

- [SurrealDB Official Site](https://surrealdb.com/)
- [SurrealDB GitHub Releases](https://github.com/surrealdb/surrealdb/releases)
- [Source Repository](https://github.com/surrealdb/surrealdb)
