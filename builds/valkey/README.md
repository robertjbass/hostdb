# Valkey Build

Valkey binaries for all 5 platforms.

Valkey is a Linux Foundation-backed fork of Redis with BSD-3-Clause license, making it a drop-in replacement for Redis that's safe for commercial use.

## Sources

| Platform | Source | Notes |
|----------|--------|-------|
| `linux-x64` | Source build | Docker on ubuntu-latest |
| `linux-arm64` | Source build | Docker with QEMU emulation |
| `darwin-x64` | Source build | Native on macos-15-intel |
| `darwin-arm64` | Source build | Native on macos-14 |
| `win32-x64` | Source build | Native on windows-latest |

**Note:** Unlike Redis, Valkey has official Windows support, so all platforms are built from source.

## Building

### Local Docker build (Linux)

```bash
# Build for linux-x64
./builds/valkey/build-local.sh --version 9.0.1

# Build for linux-arm64 (requires QEMU)
./builds/valkey/build-local.sh --version 9.0.1 --platform linux-arm64
```

### Native macOS build

macOS builds must be done natively on macOS runners. The GitHub Actions workflow handles this automatically.

### Native Windows build

Windows builds must be done natively on Windows runners. The GitHub Actions workflow handles this automatically.

## Versions

Currently configured versions (from `databases.json`):

- 9.0.1 (latest)
- 8.0.6 (LTS)

## Build Notes

### Valkey compilation

Valkey has a simple build system with minimal dependencies (forked from Redis):

```bash
# Basic build
make

# With TLS support
make BUILD_TLS=yes
```

### Output structure

```
valkey/
├── bin/
│   ├── valkey-server
│   ├── valkey-cli
│   ├── valkey-benchmark
│   ├── valkey-check-aof
│   └── valkey-check-rdb
├── valkey.conf
├── sentinel.conf
└── .hostdb-metadata.json
```

## License

Valkey is licensed under BSD-3-Clause, making it safe for commercial use without licensing concerns.

This is a key advantage over Redis (which uses RSALv2/SSPLv1/AGPL-3.0) for commercial deployments.
