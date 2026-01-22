# Meilisearch Builds

Download and repackage Meilisearch binaries for distribution via GitHub Releases.

## Supported Versions

- 1.33.1

## Supported Platforms

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

## Binary Sources

| Source | Platforms | Versions | Format |
|--------|-----------|----------|--------|
| Official GitHub Releases | All | All | Raw binary |

Meilisearch distributes raw binaries (not archives) from their GitHub releases:
- Linux: `meilisearch-linux-amd64`, `meilisearch-linux-aarch64`
- macOS: `meilisearch-macos-amd64`, `meilisearch-macos-apple-silicon`
- Windows: `meilisearch-windows-amd64.exe`

The download script packages these into tar.gz (Unix) or zip (Windows) archives with `.hostdb-metadata.json`.

## Usage

```bash
# Download for current platform
pnpm download:meilisearch

# Download specific version
pnpm download:meilisearch -- --version 1.33.1

# Download for all platforms
pnpm download:meilisearch -- --all-platforms

# Download for specific platform
pnpm download:meilisearch -- --version 1.33.1 --platform linux-x64
```

## Related Links

- [Meilisearch Official Site](https://www.meilisearch.com/)
- [Meilisearch GitHub Releases](https://github.com/meilisearch/meilisearch/releases)
- [Source Repository](https://github.com/meilisearch/meilisearch)
