# InfluxDB Builds

Download and repackage InfluxDB 3 binaries for distribution via GitHub Releases.

## Status

**In Progress** - 4 of 5 platforms have official binaries; darwin-x64 requires source build.

## Supported Versions

- 3.8.0

## Supported Platforms

- `linux-x64` - Linux x86_64
- `linux-arm64` - Linux ARM64
- `darwin-x64` - macOS Intel (source build)
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

## Binary Sources

| Platform | Source | Format | Notes |
|----------|--------|--------|-------|
| linux-x64 | Official (dl.influxdata.com) | tar.gz | |
| linux-arm64 | Official (dl.influxdata.com) | tar.gz | |
| darwin-x64 | Source build | tar.gz | No official macOS Intel binary |
| darwin-arm64 | Official (dl.influxdata.com) | tar.gz | |
| win32-x64 | Official (dl.influxdata.com) | zip | |

## Usage

```bash
# Download for current platform
pnpm download:influxdb

# Download specific version
pnpm download:influxdb -- --version 3.8.0

# Download for specific platform
pnpm download:influxdb -- --version 3.8.0 --platform linux-x64

# Download for all platforms (skips darwin-x64 build-required)
pnpm download:influxdb -- --all-platforms
```

## Archive Contents

Each hostdb release preserves InfluxDB's structure with the bundled Python runtime:

```
influxdb/
├── influxdb3              (or .exe on Windows)
├── LICENSE-APACHE
├── LICENSE-MIT
├── python/                (bundled Python 3.13 runtime for PYO3 plugin system)
│   ├── bin/
│   ├── lib/
│   └── ...
└── .hostdb-metadata.json
```

## Running InfluxDB

```bash
# Extract and run
tar -xzf influxdb-3.8.0-darwin-arm64.tar.gz
cd influxdb
./influxdb3 serve

# InfluxDB starts on port 8086
# Query via HTTP API or SQL
```

## Source Build (darwin-x64)

The macOS Intel build is done from source since InfluxData doesn't publish an official binary for this platform.

### Build Dependencies
- Rust toolchain (stable)
- Python 3.12+ (for PYO3 plugin system)
- protobuf (for gRPC code generation)
- cmake

### Manual Build
```bash
./builds/influxdb/build-macos.sh --version 3.8.0 --output ./dist
```

## URL Pattern

```
CDN: https://dl.influxdata.com/influxdb/releases/
Linux/macOS: influxdb3-core-{VERSION}_{PLATFORM}.tar.gz
Windows:     influxdb3-core-{VERSION}-windows_amd64.zip
Checksums:   {url}.sha256
```

Note the URL quirk: Linux/macOS use underscore before platform (`_linux_amd64`), while Windows uses a dash before `windows` (`-windows_amd64`).

## Related Links

- [InfluxDB Official Site](https://www.influxdata.com/)
- [InfluxDB Documentation](https://docs.influxdata.com/influxdb3/core/)
- [InfluxDB Downloads](https://dl.influxdata.com/influxdb/releases/)
- [Source Repository](https://github.com/influxdata/influxdb)
