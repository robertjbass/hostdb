# TypeDB Builds

Download and repackage TypeDB binaries for distribution via GitHub Releases.

## Status

**In Progress** - All platforms have official binaries available.

## Supported Versions

- 3.8.0

## Supported Platforms

- `linux-x64` - Linux x86_64
- `linux-arm64` - Linux ARM64
- `darwin-x64` - macOS Intel
- `darwin-arm64` - macOS Apple Silicon
- `win32-x64` - Windows x64

## Binary Sources

| Platform | Source | Format | Notes |
|----------|--------|--------|-------|
| linux-x64 | Official (Cloudsmith) | tar.gz | |
| linux-arm64 | Official (Cloudsmith) | tar.gz | |
| darwin-x64 | Official (Cloudsmith) | zip | |
| darwin-arm64 | Official (Cloudsmith) | zip | |
| win32-x64 | Official (Cloudsmith) | zip | |

All binaries are downloaded from TypeDB's Cloudsmith repository at `repo.typedb.com`.

## Usage

```bash
# Download for current platform
pnpm download:typedb

# Download specific version
pnpm download:typedb -- --version 3.8.0

# Download for specific platform
pnpm download:typedb -- --version 3.8.0 --platform linux-x64

# Download for all platforms
pnpm download:typedb -- --all-platforms
```

## Archive Contents

Each hostdb release preserves TypeDB's multi-component structure:

```
typedb/
├── typedb                   # launcher script (typedb.bat on Windows)
├── server/
│   ├── typedb_server_bin    # server binary (.exe on Windows)
│   ├── config.yml
│   └── data/
├── console/
│   └── typedb_console_bin   # console binary (.exe on Windows)
├── LICENSE
└── .hostdb-metadata.json
```

## Running TypeDB

```bash
# Extract and run server
tar -xzf typedb-3.8.0-darwin-arm64.tar.gz
cd typedb
./typedb server

# TypeDB starts on port 1729

# Connect with console (in another terminal)
./console/typedb_console_bin
```

## Related Links

- [TypeDB Official Site](https://typedb.com/)
- [TypeDB Documentation](https://typedb.com/docs)
- [TypeDB Downloads](https://cloudsmith.io/~typedb/repos/public-release/packages/)
- [Source Repository](https://github.com/typedb/typedb)
