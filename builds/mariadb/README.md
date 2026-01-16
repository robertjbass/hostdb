# MariaDB Builds

Download and repackage MariaDB binaries for distribution via GitHub Releases.

## Platform Coverage

**All 5 platforms are fully supported for all versions.**

| Platform | Method | Runner | Build Time |
|----------|--------|--------|------------|
| linux-x64 | Official binary or Docker build | ubuntu-latest | ~2-5 min (download) |
| linux-arm64 | Docker build (QEMU) | ubuntu-latest | ~45-90 min |
| darwin-x64 | Native source build | macos-13 (Intel) | ~30-60 min |
| darwin-arm64 | Native source build | macos-14 (Apple Silicon) | ~30-60 min |
| win32-x64 | Official binary | ubuntu-latest | ~2-5 min |

## Binary Sources

MariaDB binaries come from multiple sources depending on platform and version:

| Source | Platforms | Versions | Format |
|--------|-----------|----------|--------|
| Official Archive | linux-x64, win32-x64 | All | tar.gz, zip |
| MariaDB4j (Maven) | darwin-arm64 | 11.4.5 only | JAR |
| Source Build (Docker) | linux-x64, linux-arm64 | All | tar.gz |
| Source Build (Native macOS) | darwin-x64, darwin-arm64 | All | tar.gz |

### Official Archive (archive.mariadb.org)

MariaDB Foundation provides binary tarballs for Linux x64 and Windows x64 only.

**URL patterns:**
- Linux: `https://archive.mariadb.org/mariadb-{VERSION}/bintar-linux-systemd-x86_64/mariadb-{VERSION}-linux-systemd-x86_64.tar.gz`
- Windows: `https://archive.mariadb.org/mariadb-{VERSION}/winx64-packages/mariadb-{VERSION}-winx64.zip`

### MariaDB4j (Maven Central)

[MariaDB4j](https://github.com/MariaDB4j/MariaDB4j) provides pre-built macOS ARM64 binaries packaged as Maven JARs.

**Maven coordinates:**
```
groupId: ch.vorburger.mariaDB4j
artifactId: mariaDB4j-db-macos-arm64
version: 11.4.5
```

**Limitations:**
- Only darwin-arm64 11.4.5 is available
- darwin-x64 only has old versions (10.2.11 max, from 2018)
- No linux-arm64 binaries

### Source Build (Docker)

For Linux platforms without official binaries, we build from source using Docker:

- **linux-x64** - Can be built from source as fallback
- **linux-arm64** - Built from source via QEMU emulation

**Build time:** 45-90+ minutes per platform

### Source Build (Native macOS)

macOS builds require real Apple hardware because Docker containers run Linux, not macOS. GitHub Actions provides macOS runners:

- **darwin-x64** - Built on `macos-13` runner (Intel hardware)
- **darwin-arm64** - Built on `macos-14` runner (Apple Silicon hardware)

**Build time:** 30-60 minutes per platform

**Why Docker can't build for macOS:**
Docker containers share the host's kernel. Since macOS has a different kernel than Linux, Docker on any host can only produce Linux binaries. GitHub Actions solves this by providing actual Mac hardware as runners.

## Usage

```bash
# Download for current platform
pnpm download:mariadb

# Download specific version
pnpm download:mariadb -- --version 11.8.5

# Download for specific platform
pnpm download:mariadb -- --version 11.4.5 --platform darwin-arm64

# Download for all platforms (skips build-required)
pnpm download:mariadb -- --version 11.4.5 --all-platforms

# Download for all platforms WITH source build fallback
pnpm download:mariadb -- --version 11.4.5 --all-platforms --build-fallback
```

## Building from Source

For platforms without pre-built binaries, use the Docker-based build:

```bash
# Build linux-x64 from source
./builds/mariadb/build-local.sh --version 11.8.5 --platform linux-x64

# Build linux-arm64 from source (requires Docker with QEMU or ARM host)
./builds/mariadb/build-local.sh --version 11.8.5 --platform linux-arm64

# Build without Docker cache
./builds/mariadb/build-local.sh --version 11.8.5 --no-cache

# Auto-cleanup extracted files after tarball creation
./builds/mariadb/build-local.sh --version 11.8.5 --cleanup
```

The build script:
1. Downloads MariaDB source from archive.mariadb.org
2. Compiles in a Docker container (Ubuntu 22.04 base)
3. Creates a portable tarball with metadata

## Output

Downloads and builds are saved to `./dist/`:

```
dist/
├── downloads/
│   └── mariadb-11.4.5-linux-x64-original.tar.gz  (cached original)
└── mariadb-11.4.5-linux-x64.tar.gz               (repackaged for release)
```

Repackaged archives contain:
- MariaDB binaries in a `mariadb/` directory
- `.hostdb-metadata.json` with provenance information

## Supported Versions

| Version | Type | Support Until |
|---------|------|---------------|
| 11.8.5 | LTS | June 2028 |
| 11.4.5 | LTS | May 2029 |
| 10.6.24 | LTS | July 2026 |

## Platform Coverage

**Full coverage: 5 platforms × 3 versions = 15 binaries**

| Platform | 11.8.5 | 11.4.5 | 10.6.24 | Method |
|----------|--------|--------|---------|--------|
| linux-x64 | ✅ | ✅ | ✅ | Official binary |
| linux-arm64 | ✅ | ✅ | ✅ | Docker source build |
| darwin-x64 | ✅ | ✅ | ✅ | Native macOS build (macos-13) |
| darwin-arm64 | ✅ | ✅ | ✅ | Native macOS build (macos-14) |
| win32-x64 | ✅ | ✅ | ✅ | Official binary |

## GitHub Actions

The release workflow automatically builds all platforms in parallel:

1. Go to Actions → "Release MariaDB" → Run workflow
2. Select version and platforms (default: all)
3. Click "Run workflow"

Each platform builds in a separate parallel job with the appropriate runner:

| Platform | Runner | Build Type |
|----------|--------|------------|
| linux-x64 | ubuntu-latest | Docker (download or source) |
| linux-arm64 | ubuntu-latest | Docker (QEMU source build) |
| darwin-x64 | macos-13 | Native source build |
| darwin-arm64 | macos-14 | Native source build |
| win32-x64 | ubuntu-latest | Download official binary |

**Build times on GitHub Actions:**
| Platform | Method | Time |
|----------|--------|------|
| linux-x64 | Download | ~2-5 min |
| linux-arm64 | Source build (QEMU) | ~45-90 min |
| darwin-x64 | Native build | ~30-60 min |
| darwin-arm64 | Native build | ~30-60 min |
| win32-x64 | Download | ~2-5 min |

Total time for "all" with parallel builds: ~45-90 minutes (limited by slowest build)

## Historical Gaps and Resolution

Before implementing native macOS builds, there were significant gaps in platform coverage:

### Previous Limitations

| Platform | Issue |
|----------|-------|
| linux-arm64 | No official binaries from MariaDB Foundation |
| darwin-x64 | MariaDB4j only has ancient versions (10.2.11 from 2018) |
| darwin-arm64 | MariaDB4j only has 11.4.5 |

### Why These Gaps Existed

1. **MariaDB Foundation** only provides pre-built binaries for Linux x64 and Windows x64
2. **MariaDB4j** is a Java project that embeds MariaDB binaries, but their macOS coverage is incomplete
3. **Docker cannot build macOS binaries** because containers share the host's Linux kernel

### How We Resolved Them

1. **linux-arm64**: Docker source builds with QEMU emulation on ubuntu-latest
2. **darwin-x64**: Native source builds on GitHub Actions `macos-13` (Intel) runners
3. **darwin-arm64**: Native source builds on GitHub Actions `macos-14` (Apple Silicon) runners

### Potential MariaDB4j Contributions

If you'd like to contribute to the MariaDB4j project to improve their binary coverage:

- **Repository**: https://github.com/MariaDB4j/MariaDB4j
- **Opportunity**: Add more darwin-arm64 versions (currently only 11.4.5)
- **Opportunity**: Add darwin-x64 builds for modern versions (currently stuck at 10.2.11)
- **Opportunity**: Add linux-arm64 builds (currently none available)

The binaries we build here could potentially be contributed upstream to MariaDB4j.

## Related Links

- [MariaDB Downloads](https://mariadb.org/download/)
- [MariaDB Archive](https://archive.mariadb.org/)
- [MariaDB4j GitHub](https://github.com/MariaDB4j/MariaDB4j)
- [MariaDB4j Maven](https://repo.maven.apache.org/maven2/ch/vorburger/mariaDB4j/)
