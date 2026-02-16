# TigerBeetle Builds

Download and repackage TigerBeetle binaries for distribution via GitHub Releases.

## Status

**Completed** - All platforms have official binaries available.

## Supported Versions

- 0.16.70

## Supported Platforms

- `linux-x64` - Linux x86_64
- `linux-arm64` - Linux ARM64
- `darwin-x64` - macOS Intel
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

## Binary Sources

| Platform | Source | Format | Notes |
|----------|--------|--------|-------|
| linux-x64 | Official | zip | |
| linux-arm64 | Official | zip | |
| darwin-x64 | Official | zip | Universal (fat) binary |
| darwin-arm64 | Official | zip | Universal (fat) binary |
| win32-x64 | Official | zip | |

All binaries are downloaded from official TigerBeetle GitHub releases.

## Usage

```bash
# Download for current platform
pnpm download:tigerbeetle

# Download specific version
pnpm download:tigerbeetle -- --version 0.16.70

# Download for specific platform
pnpm download:tigerbeetle -- --version 0.16.70 --platform linux-x64

# Download for all platforms
pnpm download:tigerbeetle -- --all-platforms
```

## Archive Contents

Each hostdb release contains:
- `tigerbeetle/tigerbeetle` (or `tigerbeetle/tigerbeetle.exe` on Windows) - The TigerBeetle binary
- `tigerbeetle/.hostdb-metadata.json` - Metadata about the repackaged binary

## Running TigerBeetle

```bash
# Extract and run
tar -xzf tigerbeetle-0.16.70-linux-x64.tar.gz
cd tigerbeetle

# Create a data file first
./tigerbeetle format --cluster=0 --replica=0 --replica-count=1 0_0.tigerbeetle

# Start the server
./tigerbeetle start --addresses=3000 0_0.tigerbeetle

# Connect with the built-in REPL (in another terminal)
./tigerbeetle repl --cluster=0 --addresses=3000
```

## Related Links

- [TigerBeetle Official Site](https://tigerbeetle.com/)
- [TigerBeetle Documentation](https://docs.tigerbeetle.com/)
- [TigerBeetle Downloads](https://github.com/tigerbeetle/tigerbeetle/releases)
- [Source Repository](https://github.com/tigerbeetle/tigerbeetle)
