# Qdrant Builds

Download and repackage Qdrant binaries for distribution via GitHub Releases.

## Status

**In Progress** - All platforms have official binaries available.

## Supported Versions

- 1.16.3

## Supported Platforms

- `linux-x64` - Linux x86_64 (glibc)
- `linux-arm64` - Linux ARM64 (musl)
- `darwin-x64` - macOS Intel
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

## Binary Sources

| Platform | Source | Format | Notes |
|----------|--------|--------|-------|
| linux-x64 | Official | tar.gz | glibc build |
| linux-arm64 | Official | tar.gz | musl build |
| darwin-x64 | Official | tar.gz | |
| darwin-arm64 | Official | tar.gz | |
| win32-x64 | Official | zip | MSVC build |

All binaries are downloaded from official Qdrant GitHub releases.

## Usage

```bash
# Download for current platform
pnpm download:qdrant

# Download specific version
pnpm download:qdrant -- --version 1.16.3

# Download for specific platform
pnpm download:qdrant -- --version 1.16.3 --platform linux-x64

# Download for all platforms
pnpm download:qdrant -- --all-platforms
```

## Archive Contents

Each hostdb release contains:
- `qdrant/qdrant` (or `qdrant/qdrant.exe` on Windows) - The Qdrant server binary
- `qdrant/.hostdb-metadata.json` - Metadata about the repackaged binary

## Running Qdrant

```bash
# Extract and run
tar -xzf qdrant-1.16.3-linux-x64.tar.gz
cd qdrant
./qdrant

# Qdrant starts on:
# - HTTP API: http://localhost:6333
# - gRPC API: localhost:6334
# - Web UI: http://localhost:6333/dashboard
```

## Related Links

- [Qdrant Official Site](https://qdrant.tech/)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Qdrant Downloads](https://github.com/qdrant/qdrant/releases)
- [Source Repository](https://github.com/qdrant/qdrant)
