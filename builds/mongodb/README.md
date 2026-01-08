# MongoDB Binaries

Official MongoDB Community Server binaries repackaged for hostdb.

## License Warning

MongoDB is licensed under **SSPL-1.0** (Server Side Public License), which **restricts commercial and closed-source use**. If you need MongoDB compatibility for commercial projects, use [FerretDB](https://www.ferretdb.com/) instead (Apache 2.0 license).

## Versions

| Version | Type | EOL | Notes |
|---------|------|-----|-------|
| 8.2.3 | Rapid Release | March 2026 | Latest features, shorter support |
| 8.0.17 | LTS | Sept 2029 | **Recommended** - 5-year support |
| 7.0.28 | LTS | Aug 2026 | Previous LTS |

## Source

All binaries are official MongoDB Community Server releases from:
- **CDN**: `https://fastdl.mongodb.org/`

## Platforms

| Platform | Source |
|----------|--------|
| linux-x64 | Ubuntu 22.04 x86_64 |
| linux-arm64 | Ubuntu 22.04 ARM64 |
| darwin-x64 | macOS x86_64 |
| darwin-arm64 | macOS ARM64 |
| win32-x64 | Windows x64 |

## Usage

```bash
# Download for current platform (default: 8.0.17)
pnpm download:mongodb

# Download specific version
pnpm download:mongodb -- --version 7.0.28

# Download for all platforms
pnpm download:mongodb -- --version 8.0.17 --all-platforms
```

## What's Included

The repackaged archive contains:
- `mongod` - Database server
- `mongos` - Sharding router
- MongoDB shell and tools

## Notes

- Linux binaries target Ubuntu 22.04 (glibc 2.35+)
- macOS binaries work on recent macOS versions
- Windows binaries are standard x64 releases
