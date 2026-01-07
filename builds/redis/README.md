# Redis Build

Redis binaries for all 5 platforms.

## Sources

| Platform | Source | Notes |
|----------|--------|-------|
| `linux-x64` | Source build | Docker on ubuntu-latest |
| `linux-arm64` | Source build | Docker with QEMU emulation |
| `darwin-x64` | Source build | Native on macos-15-intel |
| `darwin-arm64` | Source build | Native on macos-14 |
| `win32-x64` | [redis-windows](https://github.com/redis-windows/redis-windows) | Unofficial but well-maintained |

## Building

### Download Windows binary

```bash
pnpm download:redis -- --version 8.4.0 --platform win32-x64
```

### Local Docker build (Linux)

```bash
# Build for linux-x64
./builds/redis/build-local.sh --version 8.4.0

# Build for linux-arm64 (requires QEMU)
./builds/redis/build-local.sh --version 8.4.0 --platform linux-arm64
```

### Native macOS build

macOS builds must be done natively on macOS runners. The GitHub Actions workflow handles this automatically.

## Versions

Currently configured versions (from `databases.json`):

- 8.4.0
- 8.2.3
- 8.0.5
- 7.4.7

## Build Notes

### Redis compilation

Redis has a simple build system with minimal dependencies:

```bash
# Basic build
make

# With TLS support
make BUILD_TLS=yes
```

### Windows

Redis does not officially support Windows. The [redis-windows](https://github.com/redis-windows/redis-windows) project provides unofficial Windows builds using MSYS2/Cygwin. We use the MSYS2 builds for better compatibility.

### Output structure

```
redis/
├── bin/
│   ├── redis-server
│   ├── redis-cli
│   ├── redis-benchmark
│   ├── redis-check-aof
│   └── redis-check-rdb
├── redis.conf
├── sentinel.conf
└── .hostdb-metadata.json
```

## License

Redis is licensed under RSALv2/SSPLv1 (7.4+) and AGPL-3.0 (8.0+).

**Note:** For commercial use, consider [Valkey](https://github.com/valkey-io/valkey) as a BSD-licensed drop-in replacement.
