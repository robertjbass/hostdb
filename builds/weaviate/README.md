# Weaviate Builds

Download and repackage Weaviate binaries for distribution via GitHub Releases.

## Supported Versions

- 1.35.7

## Supported Platforms

- `linux-x64` — Official binary from GitHub Releases
- `linux-arm64` — Official binary from GitHub Releases
- `darwin-x64` — Cross-compiled from source (Go, CGO_ENABLED=0)
- `darwin-arm64` — Cross-compiled from source (Go, CGO_ENABLED=0)
- `win32-x64` — Cross-compiled from source (Go, CGO_ENABLED=0)

## Binary Sources

| Source | Platforms | Format | Notes |
|--------|-----------|--------|-------|
| Official (GitHub Releases) | linux-x64, linux-arm64 | tar.gz | Single binary archive |
| Cross-compiled from source | darwin-x64, darwin-arm64, win32-x64 | Go build | CGO_ENABLED=0, pure Go |

## How It Works

Weaviate is written in pure Go with `CGO_ENABLED=0`, making cross-compilation trivial:

1. **Linux**: Download official tar.gz archives from GitHub Releases, extract the `weaviate` binary, repackage with metadata
2. **macOS/Windows**: Clone the Weaviate repo at the target tag, cross-compile with `GOOS`/`GOARCH` + `CGO_ENABLED=0`, repackage with metadata

The Go entry point is `./cmd/weaviate-server`.

## Usage

```bash
# Download for current platform
pnpm download:weaviate

# Download specific version
pnpm download:weaviate -- --version 1.35.7

# Download for a specific platform
pnpm download:weaviate -- --version 1.35.7 --platform linux-x64

# Download for all platforms (requires Go 1.23+ for cross-compilation)
pnpm download:weaviate -- --all-platforms
```

## Notes

- Windows support is experimental — Weaviate uses mmap for storage which has limited Windows support
- Cross-compilation requires Go 1.23+ installed locally or in CI
- The source repo is cloned once and reused for all cross-compile targets

## Related Links

- [Weaviate Official Site](https://weaviate.io)
- [Weaviate GitHub Releases](https://github.com/weaviate/weaviate/releases)
- [Source Repository](https://github.com/weaviate/weaviate)
