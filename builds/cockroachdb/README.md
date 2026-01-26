# CockroachDB Builds

Download and repackage CockroachDB binaries for distribution via GitHub Releases.

## Supported Versions

- 25.4.2
- 25.2.10

## Supported Platforms

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

## Binary Sources

| Source | Platforms | Versions | Format |
|--------|-----------|----------|--------|
| Official CockroachDB CDN | All | All | tgz (Unix), zip (Windows) |

CockroachDB distributes official binaries from `binaries.cockroachdb.com`:
- Linux x64: `cockroach-v{VERSION}.linux-amd64.tgz`
- Linux ARM64: `cockroach-v{VERSION}.linux-arm64.tgz`
- macOS Intel: `cockroach-v{VERSION}.darwin-10.9-amd64.tgz`
- macOS Apple Silicon: `cockroach-v{VERSION}.darwin-11.0-arm64.tgz`
- Windows: `cockroach-v{VERSION}.windows-6.2-amd64.zip`

The download script extracts the `cockroach` binary and repackages it into tar.gz (Unix) or zip (Windows) archives with `.hostdb-metadata.json`.

## Single Binary Architecture

CockroachDB uses a single binary (`cockroach`) for both server and client operations:
- **Server**: `cockroach start-single-node`
- **Client**: `cockroach sql`

## Usage

```bash
# Download for current platform
pnpm download:cockroachdb

# Download specific version
pnpm download:cockroachdb -- --version 25.4.2

# Download for all platforms
pnpm download:cockroachdb -- --all-platforms

# Download for specific platform
pnpm download:cockroachdb -- --version 25.4.2 --platform linux-x64
```

## Related Links

- [CockroachDB Official Site](https://www.cockroachlabs.com/)
- [CockroachDB Downloads](https://www.cockroachlabs.com/docs/releases/)
- [Source Repository](https://github.com/cockroachdb/cockroach)
