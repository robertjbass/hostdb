# PostgreSQL + DocumentDB

PostgreSQL 17 with DocumentDB extension for use as FerretDB backend.

## Overview

This package bundles PostgreSQL 17 with the DocumentDB extension and several supporting extensions, providing a complete backend for FerretDB.

## Binary Sources

| Platform | Source | Notes |
|----------|--------|-------|
| linux-x64 | Build | Source build inside an `ubuntu:22.04` container |
| linux-arm64 | Build | Source build inside an `ubuntu:22.04` container (QEMU) |
| darwin-x64 | Build | Native build on macOS Intel |
| darwin-arm64 | Build | Native build on macOS Apple Silicon |
| win32-x64 | Build | Stretch goal - hybrid download + source build |

## Bundled Extensions

- **DocumentDB** (0.107.0) - MongoDB wire protocol support for PostgreSQL
- **pg_cron** (1.6.4) - Job scheduler for PostgreSQL
- **pgvector** (0.8.0) - Vector similarity search
- **PostGIS** (3.5.1) - Geospatial extension
- **rum** (1.3.14) - RUM index access method

## Version Naming

Versions follow the pattern: `{pg_major}-{documentdb_version}`

Example: `17-0.107.0` means PostgreSQL 17 with DocumentDB 0.107.0

## Download Script

```bash
# Download for current platform (Linux only via Docker)
pnpm download:postgresql-documentdb -- --version 17-0.107.0

# Download for all platforms
pnpm download:postgresql-documentdb -- --version 17-0.107.0 --all-platforms

# Download for specific platform
pnpm download:postgresql-documentdb -- --version 17-0.107.0 --platform linux-arm64
```

## Archive Structure

Extension and library file extensions vary by platform: `.so` on Linux, `.dylib` on macOS.

```
postgresql-documentdb/
├── bin/
│   ├── postgres
│   ├── initdb
│   ├── pg_ctl
│   ├── psql
│   ├── pg_dump
│   └── pg_restore
├── lib/
│   ├── postgresql/           # PostgreSQL extension modules
│   │   ├── pg_documentdb.{so,dylib}
│   │   ├── pg_documentdb_core.{so,dylib}
│   │   ├── pg_cron.{so,dylib}
│   │   ├── vector.{so,dylib}
│   │   ├── postgis-3.{so,dylib}
│   │   ├── dict_snowball.{so,dylib}
│   │   └── ...
│   ├── libpq.5.dylib         # Bundled shared libraries (macOS)
│   ├── libicuuc.78.dylib
│   ├── libbson2.2.dylib      # From mongo-c-driver (DocumentDB dep)
│   ├── libpcre2-8.0.dylib    # From pcre2 (DocumentDB dep)
│   └── ...
├── share/
│   ├── extension/
│   │   ├── documentdb.control
│   │   ├── pg_cron.control
│   │   ├── vector.control
│   │   ├── postgis.control
│   │   └── rum.control
│   └── postgresql.conf.sample
└── .hostdb-metadata.json
```

## Pre-configured Settings

The bundled `postgresql.conf.sample` includes:

```ini
shared_preload_libraries = 'pg_cron,pg_documentdb_core,pg_documentdb'
cron.database_name = 'postgres'
listen_addresses = 'localhost'
```

## Building from Source (macOS)

For macOS, the build script compiles all extensions from source:

```bash
# Build for current macOS architecture
./builds/postgresql-documentdb/build-macos.sh 17-0.107.0

# Or via the workflow on GitHub Actions
# Uses macos-14 (arm64) and macos-15-intel (x64) runners
```

### Relocatability & Dylib Bundling

macOS binaries must be fully relocatable — no hardcoded Homebrew paths. The build script handles this in Step 10:

1. **Dependency bundling**: Recursively scans all Mach-O binaries and dylibs for Homebrew dependencies, copies them into the bundle's `lib/` directory.
2. **Path rewriting**: Rewrites all absolute Homebrew paths to `@loader_path/` relative references using `install_name_tool`.
3. **Code signing**: Re-signs all modified binaries (macOS requires this after `install_name_tool` changes).

**Important**: The bundling step must scan both `lib/*.dylib` and `lib/postgresql/*.dylib`. Extension dylibs in `lib/postgresql/` (like `pg_documentdb_core.dylib`) may reference Homebrew libraries (e.g. `libbson2.2.dylib` from `mongo-c-driver`, `libpcre2-8.0.dylib` from `pcre2`) that are not dependencies of any `bin/` binary. If the `lib/postgresql/` subdirectory is not included in the scan, these transitive dependencies will be missing from the bundle, causing `dlopen` failures at runtime.

## Linux builds (Docker)

Linux binaries are **built from source** inside a container by `build-linux.sh`,
not extracted from `ghcr.io/ferretdb/postgres-documentdb`. Extracting that image
would give a tree wired to the image's own PostgreSQL layout and system
libraries; building from source is what makes the package relocatable.

```bash
# Handled by download.ts -> build-linux.sh
./build-linux.sh 17-0.107.0 linux-x64 ./dist
```

**Base image: `ubuntu:22.04` (jammy, glibc 2.35).** It was `debian:bookworm`
until 2026-08-07. Two reasons for the move:

- A "stable" distro tag is a moving target. CouchDB 3.5.2 shipped broken when
  its base followed the upstream image from bookworm to trixie and inherited
  glibc 2.41. `ubuntu:22.04` names one release and stays on it.
- bookworm's glibc is 2.36, already above hostdb's 2.35 floor. The dependency
  bundler copies host libraries into the package, and the published 17-0.107.0
  linux-x64 tarball carries a `lib/libexpat.so.1` that needs `GLIBC_2.36`, so it
  cannot load on Ubuntu 22.04. `builds/common/check-glibc-floor.sh` now fails a
  release for that.

The published 17-0.107.0 artifacts were not rebuilt when the base changed; the
next release is the first jammy build.

## Usage with FerretDB

```bash
# Start PostgreSQL with DocumentDB
./postgresql-documentdb/bin/initdb -D /path/to/data
./postgresql-documentdb/bin/pg_ctl -D /path/to/data -l logfile start

# Connect and create extension
./postgresql-documentdb/bin/psql -c "CREATE EXTENSION documentdb CASCADE;"

# Start FerretDB pointing to this PostgreSQL
./ferretdb/bin/ferretdb --postgresql-url="postgres://localhost:5432/postgres"
```

## License

The archive is a bundle, so no single license covers it. `databases.yml`
records the combined SPDX expression of everything the published archives
carry (the table below plus the components in this one):

| Component | License |
| --- | --- |
| DocumentDB (FerretDB fork, `v0.107-0`) | MIT; vendored libbson and CRoaring are Apache-2.0, Intel RDFP math and PCRE2 are BSD-3-Clause (see `licenses/` in the DocumentDB source) |
| libbson (`lib/libbson-1.0.so*`, built from mongo-c-driver source) | Apache-2.0 |
| PostgreSQL, pg_cron, pgvector, rum | PostgreSQL License |
| PostGIS (3.5.1 Linux, 3.5.2 macOS) | GPL-2.0-or-later |
| GEOS (3.11.1 Linux, 3.14.1 macOS) | LGPL-2.1-or-later |
| PROJ, GDAL | MIT |
| protobuf-c (the BSD-2-Clause component PostGIS links for `ST_AsMVT`) | BSD-2-Clause |

Commercial use is allowed. Redistributing the archive (as the registry does
for CLI and Desktop users) carries the GPL, LGPL and MPL obligations of the
rows marked below: ship their license texts and make their source available.
The published `17-0.107.0` archives do not yet contain license files; their
sources are to be published as the `sources-documentdb-17-0.107.0` release
(see "Source availability for the published archives"), and `licenses/` plus
`SOURCES.txt` move inside the archives at the next DocumentDB/FerretDB paired
rebuild.

### Bundled Linux runtime libraries (17-0.107.0)

The published `17-0.107.0` linux-x64 and linux-arm64 archives were built on
`debian:bookworm` (the base moved to `ubuntu:22.04` on 2026-08-07, see
`build-linux.sh`), and both carry the same 108 third-party libraries in
`lib/` besides PostgreSQL's own and libbson. Derived on 2026-10-19 from the
archive listings: each file mapped to its Debian 12 binary package through
the bookworm `Contents-amd64` index, then to its source package, then to the
license of the library itself in that source package's `debian/copyright` (the
stanza covering the library, not only `Files: *`). Versions are the bookworm
versions on 2026-10-19; a package that received a stable update after the
2026-01-24 build may have been bundled at an earlier revision.

| Libraries in `lib/` | Debian 12 source package | License | Source must be mirrored |
| --- | --- | --- | --- |
| `libaom.so.3` | `aom` 3.6.0-1+deb12u2 (bookworm now 3.6.0-1+deb12u3) | BSD-2-Clause | no |
| `libarmadillo.so.11` | `armadillo` 1:11.4.2+dfsg-1 | Apache-2.0 | no |
| `libarpack.so.2` | `arpack` 3.8.0-3 | BSD-3-Clause | no |
| `libbrotlicommon.so.1`, `libbrotlidec.so.1` | `brotli` 1.0.9-2 | MIT | no |
| `libbz2.so.1.0` | `bzip2` 1.0.8-5 | bzip2-1.0.6 | no |
| `libblosc.so.1` | `c-blosc` 1.21.3+ds-1 | BSD-3-Clause | no |
| `libcfitsio.so.10` | `cfitsio` 4.2.0-3 | CFITSIO | no |
| `libcurl-gnutls.so.4`, `libcurl.so.4` | `curl` 7.88.1-10+deb12u15 (bookworm now 7.88.1-10+deb12u5) | curl | no |
| `libsasl2.so.2` | `cyrus-sasl2` 2.1.28+dfsg-10 | BSD-4-Clause (CMU) | no |
| `libdav1d.so.6` | `dav1d` 1.0.0-2+deb12u1 | BSD-2-Clause | no |
| `libcom_err.so.2` | `e2fsprogs` 1.47.0-2 | MIT (lib/et) | no |
| `libexpat.so.1` | `expat` 2.5.0-1+deb12u2 (bookworm now 2.5.0-1+deb12u4) | MIT | no |
| `libfontconfig.so.1` | `fontconfig` 2.14.1-4 | HPND-sell-variant | no |
| `libfreetype.so.6` | `freetype` 2.12.1+dfsg-5+deb12u4 | FTL OR GPL-2.0-or-later | no |
| `libfreexl.so.1` | `freexl` 1.0.6-2 | MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later | yes |
| `libfyba.so.0`, `libfygm.so.0`, `libfyut.so.0` | `fyba` 4.1.1-8 | MIT | no |
| `libgdal.so.32` | `gdal` 3.6.2+dfsg-1 | MIT | no |
| `libgeos.so.3.11.1`, `libgeos_c.so.1` | `geos` 3.11.1-1 | LGPL-2.1-or-later | yes |
| `libgif.so.7` | `giflib` 5.2.1-2.5+deb12u1 | MIT | no |
| `libgmp.so.10` | `gmp` 2:6.2.1+dfsg1-1.1 | LGPL-3.0-or-later OR GPL-2.0-or-later | yes |
| `libgnutls.so.30` | `gnutls28` 3.7.9-2+deb12u7 | LGPL-2.1-or-later | yes |
| `libhdf5_serial.so.103`, `libhdf5_serial_hl.so.100` | `hdf5` 1.10.8+repack1-1 | BSD-3-Clause | no |
| `libicudata.so.72`, `libicui18n.so.72`, `libicuuc.so.72` | `icu` 72.1-3+deb12u1 | ICU | no |
| `libjbig.so.0` | `jbigkit` 2.1-6.1 | GPL-2.0-or-later | yes |
| `libjson-c.so.5` | `json-c` 0.16-2 | MIT | no |
| `libkeyutils.so.1` | `keyutils` 1.6.3-2 | LGPL-2.0-or-later | yes |
| `libgssapi_krb5.so.2`, `libk5crypto.so.3`, `libkrb5.so.3`, `libkrb5support.so.0` | `krb5` 1.20.1-2+deb12u5 | MIT (MIT Kerberos) | no |
| `libblas.so.3`, `liblapack.so.3` | `lapack` 3.11.0-2 | BSD-3-Clause | no |
| `liblcms2.so.2` | `lcms2` 2.14-2+deb12u1 | MIT | no |
| `libLerc.so.4` | `lerc` 4.0.0+ds-2 | Apache-2.0 | no |
| `libaec.so.0`, `libsz.so.2` | `libaec` 1.0.6-1 | BSD-2-Clause | no |
| `libde265.so.0` | `libde265` 1.0.11-1+deb12u2 (bookworm now 1.0.11-1+deb12u3) | LGPL-3.0-or-later | yes |
| `libdeflate.so.0` | `libdeflate` 1.14-1 | MIT | no |
| `libffi.so.8` | `libffi` 3.4.4-1 | MIT | no |
| `libgeotiff.so.5` | `libgeotiff` 1.7.1-2 | LicenseRef-libgeotiff (MIT-style attribution) | no |
| `libdfalt.so.0`, `libmfhdfalt.so.0` | `libhdf4` 4.2.15-5 | LicenseRef-HDF4 (BSD-style) | no |
| `libheif.so.1` | `libheif` 1.15.1-1+deb12u1 | LGPL-3.0-or-later | yes |
| `libidn2.so.0` | `libidn2` 2.3.3-1 | LGPL-3.0-or-later OR GPL-2.0-or-later | yes |
| `libjpeg.so.62` | `libjpeg-turbo` 1:2.1.5-2 | IJG AND BSD-3-Clause AND Zlib | no |
| `libkmlbase.so.1`, `libkmldom.so.1`, `libkmlengine.so.1` | `libkml` 1.3.0-10 | BSD-3-Clause | no |
| `libpng16.so.16` | `libpng1.6` 1.6.39-2+deb12u5 (bookworm now 1.6.39-2+deb12u6) | Libpng | no |
| `libpsl.so.5` | `libpsl` 0.21.2-1 | MIT | no |
| `librttopo.so.1` | `librttopo` 1.1.0-3 | GPL-2.0-or-later | yes |
| `libssh2.so.1` | `libssh2` 1.10.0-3 (bookworm now 1.10.0-3+deb12u1) | BSD-3-Clause | no |
| `libtasn1.so.6` | `libtasn1-6` 4.19.0-2+deb12u1 | LGPL-2.1-or-later | yes |
| `libtirpc.so.3` | `libtirpc` 1.3.3+ds-1 | BSD-3-Clause | no |
| `libltdl.so.7` | `libtool` 2.4.7-7~deb12u1 | LGPL-2.0-or-later (libltdl) | yes |
| `libunistring.so.2` | `libunistring` 1.0-2 | LGPL-3.0-or-later OR GPL-2.0-or-later | yes |
| `libwebp.so.7` | `libwebp` 1.2.4-0.2+deb12u1 | BSD-3-Clause | no |
| `libxml2.so.2` | `libxml2` 2.9.14+dfsg-1.3~deb12u6 (bookworm now 2.9.14+dfsg-1.3~deb12u4) | MIT | no |
| `libzstd.so.1` | `libzstd` 1.5.4+dfsg2-5 | BSD-3-Clause OR GPL-2.0-only | no |
| `liblz4.so.1` | `lz4` 1.9.4-1 | BSD-2-Clause | no |
| `libmariadb.so.3` | `mariadb` 1:10.11.18-0+deb12u1 (bookworm now 1:10.11.19-0+deb12u1) | LGPL-2.0-or-later (libmariadb) | yes |
| `libminizip.so.1` | `minizip` 1.1-8+deb12u1 | Zlib | no |
| `libtinfo.so.6` | `ncurses` 6.4-4 | X11 (ncurses) | no |
| `libnetcdf.so.19` | `netcdf` 1:4.9.0-3 | BSD-3-Clause | no |
| `libhogweed.so.6`, `libnettle.so.8` | `nettle` 3.8.1-2 | LGPL-3.0-or-later OR GPL-2.0-or-later | yes |
| `libnghttp2.so.14` | `nghttp2` 1.52.0-1+deb12u3 | MIT | no |
| `libnspr4.so`, `libplc4.so`, `libplds4.so` | `nspr` 2:4.35-1 | MPL-2.0 | yes |
| `libnss3.so`, `libnssutil3.so`, `libsmime3.so` | `nss` 2:3.87.1-1+deb12u2 (bookworm now 2:3.87.1-1+deb12u4) | MPL-2.0 | yes |
| `libnuma.so.1` | `numactl` 2.0.16-1 | LGPL-2.1-only | yes |
| `libogdi.so.4.1` | `ogdi-dfsg` 4.1.0+ds-6 | LicenseRef-OGDI (BSD-style) | no |
| `libopenjp2.so.7` | `openjpeg2` 2.5.0-2+deb12u3 | BSD-2-Clause | no |
| `liblber-2.5.so.0`, `libldap-2.5.so.0` | `openldap` 2.5.13+dfsg-5 | OLDAP-2.8 | no |
| `libcrypto.so.3`, `libssl.so.3` | `openssl` 3.0.20-1~deb12u2 (bookworm now 3.0.22-1~deb12u1) | Apache-2.0 | no |
| `libp11-kit.so.0` | `p11-kit` 0.24.1-2 | BSD-3-Clause | no |
| `libpcre2-8.so.0` | `pcre2` 10.42-1 (bookworm now 10.42-1+deb12u2) | BSD-3-Clause WITH PCRE2-exception | no |
| `libpoppler.so.126` | `poppler` 22.12.0-2+deb12u2 (bookworm now 22.12.0-2+deb12u3) | GPL-2.0-only OR GPL-3.0-only | yes |
| `libproj.so.25` | `proj` 9.1.1-1 | MIT | no |
| `libprotobuf-c.so.1` | `protobuf-c` 1.4.1-1 | BSD-2-Clause | no |
| `libqhull_r.so.8.0` | `qhull` 2020.2-5 | Qhull | no |
| `libreadline.so.8` | `readline` 8.2-1.3 | GPL-3.0-or-later | yes |
| `librtmp.so.1` | `rtmpdump` 2.4+20151223.gitfa8646d.1-2 | LGPL-2.1-or-later (librtmp) | yes |
| `libsnappy.so.1` | `snappy` 1.1.9-3 | BSD-3-Clause | no |
| `libspatialite.so.7` | `spatialite` 5.0.1-3 | MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later | yes |
| `libsqlite3.so.0` | `sqlite3` 3.40.1-2+deb12u2 | blessing (public domain) | no |
| `libsuperlu.so.5` | `superlu` 5.3.0+dfsg1-2 | BSD-3-Clause | no |
| `libtiff.so.6` | `tiff` 4.5.0-6+deb12u4 | libtiff | no |
| `libodbc.so.2`, `libodbcinst.so.2` | `unixodbc` 2.3.11-2+deb12u1 | LGPL-2.1-or-later | yes |
| `liburiparser.so.1` | `uriparser` 0.9.7+dfsg-2 | BSD-3-Clause | no |
| `libx265.so.199` | `x265` 3.5-2 | GPL-2.0-or-later | yes |
| `libxerces-c-3.2.so` | `xerces-c` 3.2.4+debian-1 | Apache-2.0 | no |
| `liblzma.so.5` | `xz-utils` 5.4.1-1+deb12u1 (bookworm now 5.4.1-1+deb12u2) | LicenseRef-Public-Domain | no |
| `libz.so.1` | `zlib` 1:1.2.13.dfsg-1 | Zlib | no |

"Source must be mirrored" is `yes` when every license choice is GPL, LGPL or
MPL. The darwin archives bundle Homebrew libraries instead and are not covered
by this table; record them here when they are next listed.

### Source availability for the published archives

An operator publishes, as the assets of a dedicated
`sources-documentdb-17-0.107.0` GitHub release mirrored to
`https://registry.layerbase.host/sources-documentdb-17-0.107.0/<file>`:

- the PostGIS 3.5.1 (Linux) and 3.5.2 (macOS) source tarballs;
- the GEOS source of each platform. Linux bundles Debian's `libgeos3.11.1`
  and `libgeos-c1v5` (`lib/libgeos.so.3.11.1`, and `libgeos_c.so.1` reports
  `3.11.1-CAPI-1.17`), built from Debian source package `geos` `3.11.1-1`,
  the only `geos` version bookworm has shipped. macOS bundles Homebrew's GEOS
  3.14.1, built from the upstream tarball:

  | File | sha256 |
  | --- | --- |
  | `geos_3.11.1.orig.tar.bz2` | `6d0eb3cfa9f92d947731cc75f1750356b3bdfc07ea020553daf6af1c768e0be2` |
  | `geos_3.11.1-1.debian.tar.xz` | `17535f9b6d6e162d66c1f04a0c694925742334c300fb739d1359f7a803f1be10` |
  | `geos_3.11.1-1.dsc` | `ab9efb0785cc49745a609b7250e3ecd258d151b162547d5a5a5cc1e84808a8e5` |
  | `geos-3.14.1.tar.bz2` | `3c20919cda9a505db07b5216baa980bacdaa0702da715b43f176fb07eff7e716` |

  The Debian files come from `https://deb.debian.org/debian/pool/main/g/geos/`
  and match the checksums in the `.dsc`; `geos-3.14.1.tar.bz2` is the file
  `builds/postgresql/postgis.sh` pins;
- the Debian source package (`.orig`, `.debian` and `.dsc`) of every other row
  marked `yes` in the table above;
- the license texts (`LICENSES.tar.gz`) and a `SHA256SUMS` of all assets.

GitHub renames asset names containing `+` or `:`, so upload Debian files with
`+` replaced by `-` and list the original names in the release notes.

```bash
gh release create sources-documentdb-17-0.107.0 --repo robertjbass/hostdb \
  --latest=false --title "Sources: sources-documentdb-17-0.107.0" \
  --notes-file sources-notes.md \
  postgis-3.5.1.tar.gz postgis-3.5.2.tar.gz \
  geos_3.11.1.orig.tar.bz2 geos_3.11.1-1.debian.tar.xz geos_3.11.1-1.dsc \
  geos-3.14.1.tar.bz2 <other-marked-debian-source-files> LICENSES.tar.gz SHA256SUMS
gh workflow run reupload-r2.yml --repo robertjbass/hostdb --ref main \
  -f tags=sources-documentdb-17-0.107.0
```

Check the PostGIS tarballs from `https://download.osgeo.org/postgis/source/`
against their published `.md5`, and every Debian file against its `.dsc`,
before uploading. `sources-` tags are skipped by `build-releases-json.ts` and
are never offered for deletion by `audit-r2-orphans.ts`, so the objects stay as
long as the archives do.
