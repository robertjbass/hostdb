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

The macOS Intel build is done from source since InfluxData has never published official `x86_64-apple-darwin` binaries for InfluxDB 3. The build script replicates their CircleCI build process natively on macOS.

### How It Works

1. Downloads [python-build-standalone](https://github.com/astral-sh/python-build-standalone) (PBS) for `x86_64-apple-darwin` — the same portable Python runtime InfluxData uses in official builds
2. Generates a `PYO3_CONFIG_FILE` pointing at the PBS Python (this is how InfluxDB's build tells PyO3 where to find the Python library)
3. Builds with `cargo build --release --package influxdb3` (repo's `rust-toolchain.toml` selects the correct Rust version)
4. Rewrites the Python dylib path from an absolute path to `@executable_path/python/lib/libpython3.13.dylib` using `install_name_tool`
5. Re-signs the binary with ad-hoc `codesign`
6. Packages the binary + PBS `python/` directory + license files into a tar.gz

### Build Dependencies
- Rust toolchain (auto-selected from repo's `rust-toolchain.toml`, currently 1.91)
- protobuf (for gRPC code generation)
- cmake
- pkg-config

### Build Time
Expect 30-60 minutes due to Fat LTO (`lto = "fat"` in the release profile).

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
