# QuestDB Builds

Download and repackage QuestDB binaries for distribution via GitHub Releases.

## Status

**Implemented** - Ready for release.

## Supported Versions

- 9.2.3

## Supported Platforms

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

## Binary Sources

| Source | Platforms | Format | Notes |
|--------|-----------|--------|-------|
| Official `-rt-` package | linux-x64, win32-x64 | tar.gz | JRE included by QuestDB |
| Official no-JRE + Adoptium JRE 21 | linux-arm64, darwin-x64, darwin-arm64 | tar.gz | Bundled by hostdb |

### JRE Bundling

QuestDB only provides runtime packages (`-rt-`) for Linux x64 and Windows x64. For other platforms, we:

1. Download the official `no-jre` package from QuestDB GitHub releases
2. Download Adoptium Temurin JRE 21 LTS for the target platform
3. Bundle them together into a single archive

The bundled JRE is placed in `questdb/jre/` within the archive.

## Usage

```bash
# Download for current platform
pnpm download:questdb

# Download specific version
pnpm download:questdb -- --version 9.2.3

# Download for all platforms
pnpm download:questdb -- --all-platforms
```

## Archive Structure

```
questdb/
├── bin/
│   └── questdb.sh (or questdb.exe on Windows)
├── lib/
│   └── questdb.jar
├── jre/                    # Bundled JRE (linux-arm64, darwin-*)
│   ├── bin/
│   └── lib/
├── questdb.sh              # Main startup script
└── .hostdb-metadata.json   # hostdb metadata
```

## Related Links

- [QuestDB Official Site](https://questdb.io)
- [QuestDB Downloads](https://questdb.io/download/)
- [Source Repository](https://github.com/questdb/questdb)
- [Adoptium Temurin](https://adoptium.net/) - JRE source for bundled platforms
