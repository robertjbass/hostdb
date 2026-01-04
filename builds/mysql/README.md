# MySQL Build

Downloads official MySQL binaries and re-hosts them on GitHub Releases.

## Quick Start

```bash
# Download MySQL 8.4.3 for current platform
pnpm download:mysql

# Download specific version
pnpm download:mysql -- --version 8.0.40

# Download for specific platform
pnpm download:mysql -- --platform linux-arm64

# Download for all platforms
pnpm download:mysql -- --all-platforms
```

## Output

Downloads are saved to `./dist/`:
```
dist/
├── downloads/                              # Cached original downloads
│   └── mysql-8.4.3-linux-x64-original.tar.xz
├── mysql-8.4.3-linux-x64.tar.gz           # Repackaged for distribution
├── mysql-8.4.3-linux-arm64.tar.gz
├── mysql-8.4.3-darwin-x64.tar.gz
├── mysql-8.4.3-darwin-arm64.tar.gz
└── mysql-8.4.3-win32-x64.zip
```

## Files

| File | Purpose |
|------|---------|
| `download.ts` | Downloads official binaries, repackages with metadata |
| `sources.json` | Maps versions/platforms to official download URLs |
| `Dockerfile` | Fallback: build from source if no official binary exists |
| `build-local.sh` | Local Docker build script (for source builds) |

## Workflow

1. **Primary**: Download official binaries from dev.mysql.com
2. **Fallback**: Build from source using Dockerfile (if binary doesn't exist)

## Supported Versions

| Version | Type | Status |
|---------|------|--------|
| 8.4.x | LTS | Official binaries available |
| 8.0.x | GA | Official binaries available |

## License Compliance

MySQL is GPL-2.0 licensed. Re-hosting binaries is permitted as long as:
- License file is included (done automatically)
- Source code is available (links to Oracle's repos)

We add a `.hostdb-metadata.json` file to track provenance.

## Adding New Versions

1. Find URLs at https://dev.mysql.com/downloads/mysql/
2. Add entry to `sources.json`
3. Run `pnpm download:mysql -- --version X.Y.Z`
4. Update `sources.json` with the SHA256 checksum from output
