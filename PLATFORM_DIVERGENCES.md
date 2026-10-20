# Platform divergences

The one canonical record of where an engine's published archives differ
between operating systems and architectures: which extensions, modules and
features exist on `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64` and
`win32-x64`, per engine and per version.

**Scope.** Content of the archives hostdb publishes, nothing else. This is not
the cloud's `DIVERGENCES.md` (`~/dev/layerbase-cloud/DIVERGENCES.md`), which
tracks consumers (cloud, desktop) implementing database logic outside spindb.
It is not `MINIMAL_BINARIES.md` either, which covers which archives are
stripped to a minimal binary set.

**Why it lives in hostdb.** hostdb owns every build recipe and every archive
(`~/dev/layerbase-cloud/INVARIANTS.md` section 5). A divergence is created or
removed by a recipe change in this repo, so the record sits next to the change
and is updated in the same PR. spindb, Cloud, Desktop and the web read it; none
of them can change it.

## Rules

- **Every PR that changes a build recipe updates this file in the same PR**
  when the change adds, removes or scopes an extension, module or feature on
  any platform, or changes which platforms a version ships on. A recipe PR
  that does not touch this file says "no platform divergence change" in its
  description.
- **Every row is verified against a published archive**, not against the
  recipe's intent. Verify with a file listing of the archive from the
  registry (`curl -sfL <url> | tar -tzf - | grep <file>`), and record the date.
  A recipe can say one thing while R2 still holds an older build (see the
  `uuid-ossp` rows below).
- A cell is one of: `yes`, `no`, `yes (<detail>)`, `not built` (no archive for
  that platform), `retired`, or `unverified` (archive exists, nobody has
  listed it yet). Never leave a guess in a cell.
- When a platform gap is closed, change the cell and add a line to the change
  log at the bottom with the hostdb version that closed it.

## PostgreSQL (`postgresql`)

Verified 2026-10-19 by listing the published archives at
`https://registry.layerbase.host/postgresql-<version>/` (control files under
`share/extension/` and modules under `lib/`).

### 18.6.0

| Extension / feature | linux-x64 | linux-arm64 | darwin-arm64 | darwin-x64 | win32-x64 |
| --- | --- | --- | --- | --- | --- |
| Core contrib (45 control files, e.g. pg_stat_statements, pgcrypto, pg_trgm, hstore, citext, ltree) | yes | yes | yes | yes | unverified (EDB zip) |
| `uuid-ossp` | yes | **no** | **no** | **no** | unverified (EDB zip) |
| `pg_cron` 1.6.8 | yes | no | no | no | no |
| PostGIS | no (planned, see below) | no | no | no | no |
| pgvector | no | no | no | no | no |
| License files in archive | no | no | no | no | unverified |

### 19.0.0-beta.3

| Extension / feature | linux-x64 | linux-arm64 | darwin-arm64 | darwin-x64 | win32-x64 |
| --- | --- | --- | --- | --- | --- |
| Core contrib | yes (46 control files) | yes | yes | unverified | not built |
| `uuid-ossp` | yes | **no** | **no** | unverified | not built |
| `pg_cron` 1.6.8 | yes | no | no | unverified | not built |
| PostGIS | no (planned, see below) | no | no | no | not built |
| pgvector | no | no | no | no | not built |

### Why the PostgreSQL rows diverge

- **`uuid-ossp` exists only on linux-x64.** The recipe fix (`--with-uuid=e2fs`
  on Linux and macOS, `CHANGELOG.md` 0.42.x "PostgreSQL binaries now ship the
  `uuid-ossp` extension") applies to every future build, but only the
  linux-x64 archives were rebuilt in place (`CHANGELOG.md` 0.42.1: "The other
  four platforms are unchanged"). The linux-arm64 and darwin archives of
  18.6.0 and 19.0.0-beta.3 on R2 were built before the fix and still lack it.
  Closing the gap is a partial-platform rebuild of those archives. The
  Percona-repacked linux-arm64 archives of 17.11.0, 16.15.0 and 15.19.0 carry
  `uuid-ossp` because Percona configures it in (`CHANGELOG.md` 0.42.x Notes);
  they are not listed here because nothing offers those versions for new
  databases.
- **`pg_cron` is linux-x64 only, PostgreSQL 18+.** Scope and reasons (QEMU
  timing-based smoke gate on arm64, darwin needs its own link and re-sign
  recipe, win32 is the EDB binary) are in `builds/postgresql/README.md`
  ("Scope is linux-x64 only"). Single source of the scope:
  `builds/postgresql/pg-cron.sh` (`MIN_MAJOR`, `PLATFORMS`).
- **win32-x64 is the EDB binary**, never built here, so its contents follow
  EDB's packaging.

### Planned: PostGIS on PostgreSQL (linux-x64 first)

Plan: `~/dev/layerbase-cloud/plans/active/postgis-extension.md`. The recipe
landed in hostdb 0.44.3 (`builds/postgresql/postgis.sh`), but **no published
archive has changed yet**: the cells above stay `no` until the in-place
rebuild of each version has run and its published archive has been listed.
After the rebuild these rows change to:

| Version | linux-x64 | linux-arm64 | darwin-* | win32-x64 |
| --- | --- | --- | --- | --- |
| 18.6.0 | core `postgis` 3.6.4 (GEOS 3.14.1, PROJ 9.8.1 with bundled `share/proj/proj.db`, json-c, protobuf-c, SQLite); no raster, topology, tiger geocoder, address_standardizer or SFCGAL | no (Cloud runs x86_64 only) | no (later, Desktop/CLI) | no (later) |
| 19.0.0-beta.3 | core `postgis` 3.7.0rc2, same components and exclusions (libgmp only if the build links GMP code, which only topology uses) | no | no | not built |

The same rebuild adds `licenses/` and `SOURCES.txt` to those two linux-x64
archives, so their "License files in archive" cells flip to `yes` at the same
time. Update the per-version tables above, not this block, once the archives
are published and listed, and add a change-log row naming the hostdb version
that carries the rebuilt checksums.

## PostgreSQL + DocumentDB (`postgresql-documentdb`)

Verified 2026-10-19 by listing the published `17-0.107.0` archives. Windows
facts come from the release workflow and `databases.json`, since that platform
is retired.

### 17-0.107.0

| Extension / feature | linux-x64 | linux-arm64 | darwin-arm64 | darwin-x64 | win32-x64 |
| --- | --- | --- | --- | --- | --- |
| `documentdb`, `documentdb_core` | yes | yes | yes | yes | retired (never had it) |
| `pg_cron` | yes | yes | yes | yes | retired (never had it) |
| `rum` | yes | yes | yes | yes | retired (never had it) |
| pgvector (`vector`) | yes | yes | yes | yes | retired (had it) |
| `postgis` | yes (3.5.1) | yes (3.5.1) | yes (3.5.2) | yes (3.5.2) | retired (never had it) |
| `postgis_raster` (+ bundled `libgdal.so.32`) | **yes** | **yes** | no | no | retired |
| `postgis_topology`, `postgis_tiger_geocoder`, `address_standardizer`, `address_standardizer_data_us` | **yes** | **yes** | no | no | retired |
| Bundled GEOS | 3.11.1 (Debian 12 `geos` 3.11.1-1; the archive was built on `debian:bookworm`) | 3.11.1 (same) | 3.14.1 (Homebrew) | 3.14.1 | n/a |
| PROJ `proj.db` data file | **no** | **no** | **no** | **no** | n/a |
| `uuid-ossp` | no | no | no | no | n/a |
| License files in archive (PostGIS GPL, GEOS LGPL, ...) | **no** | **no** | **no** | **no** | n/a |

### Why the DocumentDB rows diverge

- **PostGIS versions and components differ by OS.** Linux pins
  `POSTGIS_VERSION="3.5.1"` and builds against Ubuntu 22.04 apt GEOS, PROJ and
  GDAL with every component enabled, best effort (`build-linux.sh`, the
  `|| true` apt install and the warn-only PostGIS build). macOS pins
  `POSTGIS_VERSION="3.5.2"` against unpinned Homebrew libraries with
  `--without-raster --without-topology --without-sfcgal` (`build-macos.sh`).
- **No archive ships `proj.db`.** PROJ needs it at runtime for any
  `ST_Transform` between coordinate systems, so that function is expected to
  fail on every platform. Not yet exercised by any test; record the result
  here once it is.
- **No license files.** The archives bundle GPL-2.0-or-later (PostGIS), LGPL
  (GEOS) and MIT (PROJ, GDAL) components but carry no license texts. Since
  hostdb 0.44.3 the engine's `license` in `databases.yml`, the release notes
  and `builds/postgresql-documentdb/README.md` state the combined expression
  instead of `Apache-2.0`; the source tarballs are to be published as
  `sources-documentdb-17-0.107.0`, and `licenses/` plus `SOURCES.txt` move
  inside the archives at the next DocumentDB/FerretDB paired rebuild.
- **Windows was a pgvector-only bundle.** The workflow writes
  `extensions_unavailable = @("documentdb", "pg_cron", "rum", "postgis")` into
  the Windows `.hostdb-metadata.json`
  (`.github/workflows/release-postgresql-documentdb.yml`, "Add metadata noting
  Windows limitations"), and the platform is retired
  (`databases.yml` `retiredPlatforms`, revival is Phase 3 of
  `builds/postgresql-documentdb/WINDOWS_PLAN.md`).

## Other engines

Not yet audited. Add a section per engine the first time a recipe change
scopes a feature to some platforms only, or when an audit lists its archives.
Known candidates: MySQL linux-x64 minimal binaries (`MINIMAL_BINARIES.md`),
MariaDB plugin exclusions (`builds/mariadb/plugin-exclusions.ts`).

## Change log

| Date | hostdb version | Change |
| --- | --- | --- |
| 2026-10-19 | 0.44.2 (no build change) | File created and seeded from archive listings of PostgreSQL 18.6.0, 19.0.0-beta.3 and postgresql-documentdb 17-0.107.0. |
| 2026-10-19 | 0.44.3 (recipe only, no archive change) | PostGIS recipe added for linux-x64 PostgreSQL 18 and 19; cells unchanged until the rebuilt archives are published and listed. postgresql-documentdb `license` corrected to the bundle's combined expression. |
