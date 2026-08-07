# CouchDB Build

Apache CouchDB binaries for all 5 platforms.

## Platform Coverage

| Platform | Source | Notes |
|----------|--------|-------|
| `linux-x64` | Docker build | Apache apt package `couchdb=<version>~jammy`, unpacked on `ubuntu:22.04` |
| `linux-arm64` | Docker build | Apache apt package `couchdb=<version>~jammy`, unpacked on `ubuntu:22.04` (QEMU) |
| `darwin-x64` | Neighbourhoodie | Official macOS x86_64 binary |
| `darwin-arm64` | Neighbourhoodie | Official macOS Apple Silicon binary |
| `win32-x64` | Neighbourhoodie | MSI installer, extracted for portable use |

## Binary Sources

### Linux (Docker build from the Apache apt repository)

CouchDB does not provide standalone Linux binaries - only .deb/.rpm packages that require system installation. `builds/couchdb/Dockerfile` downloads the official Apache package (`couchdb=<version>~jammy`) inside an `ubuntu:22.04` container and unpacks it with `dpkg-deb -x` (no maintainer scripts), then normalizes the tree for relocatable use.

**Repository:** `https://apache.jfrog.io/artifactory/couchdb-deb` (`jammy` suite, key from `https://couchdb.apache.org/repo/keys.asc`)

**Extraction Path:** `/opt/couchdb` inside the unpacked package

**Why not the official `couchdb` Docker image?** It tracks Debian stable and moved from bookworm to trixie at 3.5.2. Only `/opt/couchdb` was ever copied out, so the bundled Erlang runtime kept its link to the image's system libraries: the 3.5.2 extract needed `GLIBC_2.38` (dead on Ubuntu 22.04, glibc 2.35) and `OPENSSL_3.4.0` in `crypto.so` (dead on Ubuntu 24.04, OpenSSL 3.0, where CouchDB aborted with `{undef,{crypto,info_fips,[]}}`). Building against the `jammy` package pins the toolchain to our oldest supported Linux baseline.

**Normalization applied after unpacking:** the FHS symlinks `data -> /var/lib/couchdb` and `var/log -> /var/log/couchdb` become real in-tree directories (`database_dir` defaults to `./data`; a dangling symlink makes `mem3` fail to create `_nodes` and the node dies with `{case_clause,{not_found,no_db_file}}`), the package's `10-filelog.ini` default is dropped, `10-docker-default.ini` (`bind_address = any`) is restored for parity with earlier tarballs, and the packaged `-name` is stripped from `vm.args`.

### macOS & Windows (Neighbourhoodie)

Official binaries are hosted by [Neighbourhoodie](https://neighbourhood.ie/couchdb-support/download-binaries), a CouchDB consulting company that sponsors binary distribution.

**macOS:** ZIP containing `Apache CouchDB.app` bundle
**Windows:** MSI installer

## Usage

### Download for current platform

```bash
pnpm download:couchdb
```

### Download for specific platform

```bash
pnpm download:couchdb -- --version 3.5.1 --platform darwin-arm64
```

### Download for all platforms (macOS/Windows only)

```bash
pnpm download:couchdb -- --all-platforms
```

### Build Linux binaries locally (requires Docker)

```bash
./builds/couchdb/build-local.sh --version 3.5.1 --platform linux-x64
./builds/couchdb/build-local.sh --version 3.5.1 --platform linux-arm64
```

### Download with Docker fallback for Linux

```bash
pnpm download:couchdb -- --all-platforms --build-fallback
```

## Build Times

| Platform | Method | Approximate Time |
|----------|--------|------------------|
| `darwin-x64` | Download + repackage | 1-2 minutes |
| `darwin-arm64` | Download + repackage | 1-2 minutes |
| `win32-x64` | MSI extract | 2-3 minutes |
| `linux-x64` | Package download + unpack | 2-3 minutes |
| `linux-arm64` | Package download + unpack (QEMU) | 5-10 minutes |

## Archive Structure

```
couchdb/
├── bin/
│   ├── couchdb
│   ├── couchjs
│   └── ...
├── etc/
│   ├── default.ini
│   ├── local.ini
│   └── ...
├── lib/
│   └── couch-*/
├── share/
│   └── www/         # Fauxton web UI
├── data/            # Default data directory
└── .hostdb-metadata.json
```

## Configuration

CouchDB uses `.ini` files in `etc/` for configuration:

- `default.ini` - Default settings (do not modify)
- `local.ini` - Local overrides (safe to modify)

### Quick Start

```bash
# Extract
tar -xzf couchdb-3.5.1-linux-x64.tar.gz

# Set admin password (required for first run)
echo "[admins]" >> couchdb/etc/local.ini
echo "admin = mysecretpassword" >> couchdb/etc/local.ini

# Start CouchDB
./couchdb/bin/couchdb

# Access Fauxton UI
open http://127.0.0.1:5984/_utils/
```

## API Access

CouchDB provides an HTTP API - no dedicated CLI client is needed:

```bash
# Check server status
curl http://127.0.0.1:5984/

# Create database
curl -X PUT http://admin:password@127.0.0.1:5984/mydb

# Create document
curl -X POST http://admin:password@127.0.0.1:5984/mydb \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}'

# Query all documents
curl http://admin:password@127.0.0.1:5984/mydb/_all_docs
```

## License

Apache CouchDB is licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Links

- [Official Website](https://couchdb.apache.org/)
- [Documentation](https://docs.couchdb.org/)
- [Docker Hub](https://hub.docker.com/_/couchdb)
- [Neighbourhoodie Downloads](https://neighbourhood.ie/couchdb-support/download-binaries)
- [GitHub](https://github.com/apache/couchdb)
