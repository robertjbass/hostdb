#!/usr/bin/env bash
# HELP_START
# The one PostGIS recipe for the standard PostgreSQL build.
#
# The Dockerfile, build-local.sh, smoke-postgis.sh and release-postgresql.yml
# all call this script, so the version scope, every pinned source tarball and
# its sha256, the configure flags and the expected files live in exactly one
# place.
#
# Usage:
#   postgis.sh applies <hostdb-version> <platform>
#       Prints "yes" when that build must include PostGIS, "no" otherwise.
#       Exits non-zero on bad input, and for a PostgreSQL major that is in
#       scope but has no PostGIS line yet, so a new major cannot silently
#       ship without PostGIS.
#   postgis.sh pins <hostdb-version>
#       Prints POSTGIS=, GEOS=, PROJ= and MIRROR_TAG= lines for that version.
#   postgis.sh fetch-sources <hostdb-version> <dir>
#       Downloads every pinned source tarball for that version into <dir> and
#       verifies each sha256. The release workflow mirrors exactly these files.
#   postgis.sh install <pg_config> <work-dir> <postgresql-source-dir>
#       Builds GEOS and PROJ from the pinned sources, builds PostGIS into the
#       PostgreSQL that <pg_config> describes, bundles the runtime libraries
#       and share/proj into it, and writes licenses/ and SOURCES.txt. Run as
#       root inside the builder image (it installs build packages with apt).
#   postgis.sh verify <postgresql-root>
#       Fails unless every capability file exists, the bundled libraries
#       resolve inside the archive, and raster, topology and GDAL are absent.
#   postgis.sh manifest <postgresql-root>
#       Prints every PostGIS-owned path in the archive, one per line, sorted.
#
# Scope: linux-x64 builds of PostgreSQL 18 (PostGIS 3.6) and 19 (PostGIS
# 3.7). Core postgis only: no raster/GDAL, topology, tiger geocoder,
# address_standardizer or SFCGAL. linux-arm64 and darwin are not qualified;
# win32-x64 is the EDB binary and never built here.
# HELP_END

set -euo pipefail

# ---------------------------------------------------------------------------
# Pins. Every source this recipe downloads is named here and nowhere else.
# download.osgeo.org publishes md5 files only, so each sha256 was computed once
# from the upstream file (and cross-checked against that md5, or for GEOS
# against the GitHub release digest) and recorded here.
# ---------------------------------------------------------------------------

GEOS_VERSION="3.14.1"
GEOS_FILE="geos-${GEOS_VERSION}.tar.bz2"
GEOS_URL="https://download.osgeo.org/geos/${GEOS_FILE}"
GEOS_SHA256="3c20919cda9a505db07b5216baa980bacdaa0702da715b43f176fb07eff7e716"

PROJ_VERSION="9.8.1"
PROJ_FILE="proj-${PROJ_VERSION}.tar.gz"
PROJ_URL="https://download.osgeo.org/proj/${PROJ_FILE}"
PROJ_SHA256="af5b731c145c1d13c4e3b4eeb7d167e94e845e440f71e3496b4ed8dae0291960"

# PostGIS 3.6 line, for PostgreSQL 18.
POSTGIS_36_VERSION="3.6.4"
POSTGIS_36_SHA256="ed8dc6679f1e06f7b113592b04cde2a7e00f1b1e681294c8ca2204058990cec6"

# PostGIS 3.7 line, for PostgreSQL 19. This branch is the recipe reused at
# PostgreSQL 19 GA: replace POSTGIS_37_VERSION and POSTGIS_37_SHA256 with the
# 3.7.0 final release and nothing else in the build changes.
POSTGIS_37_VERSION="3.7.0rc2"
POSTGIS_37_SHA256="67ef9e85fbf9ef8a99807c9ccd80bef839058b699d16764083d937b13e1259b3"

# libgmp (PostGIS 3.7 only) is the Ubuntu 22.04 libgmp10 package, bundled into
# the archive. GMP is LGPL-3.0-or-later or GPL-2.0-or-later, so its exact
# Corresponding Source (the Ubuntu source package) is pinned and mirrored too.
# install refuses to bundle any other libgmp10 version.
GMP_DEB_VERSION="2:6.2.1+dfsg-3ubuntu1"
GMP_SOURCE_BASE_URL="https://launchpad.net/ubuntu/+archive/primary/+sourcefiles/gmp/${GMP_DEB_VERSION}"
GMP_SOURCE_FILES=(
    "gmp_6.2.1+dfsg.orig.tar.xz c6ba08e3f079260ab90ff44ab8801eae134cd62cd78f4aa56317c0e70daa40cb"
    "gmp_6.2.1+dfsg-3ubuntu1.debian.tar.xz 371f81cd30902da41fb4cd084fa2d4e5e353c1f812e79184158479cc96aedd76"
    "gmp_6.2.1+dfsg-3ubuntu1.dsc aad30e80591b3a3bea84ef1c3d1c46657dcdd639a10f093b6a4a231461e015e6"
)

POSTGIS_MIN_MAJOR=18
POSTGIS_PLATFORMS=("linux-x64")
MIRROR_BASE_URL="https://registry.layerbase.host"

# GEOS and PROJ install here, outside the PostgreSQL prefix, so their headers,
# tools and CMake files never reach the archive and PROJ's compiled-in data
# directory does not exist at runtime (the archive must find share/proj/proj.db
# relative to its own lib/libproj.so, which smoke-postgis.sh proves).
DEPS_PREFIX="/opt/postgis-deps"

# Sonames copied into the archive's lib/. Anything else postgis-3.so needs is a
# system library the plain PostgreSQL archive already depends on.
BUNDLE_SONAME_PATTERN='^lib(geos|geos_c|proj|json-c|protobuf-c|sqlite3|gmp)\.so(\.|$)'

# Components that must never be built or shipped.
FORBIDDEN_FILES=(
    share/extension/postgis_raster.control
    share/extension/postgis_topology.control
    share/extension/postgis_tiger_geocoder.control
    share/extension/address_standardizer.control
    share/extension/address_standardizer_data_us.control
    share/extension/postgis_sfcgal.control
    lib/postgis_raster-3.so
    lib/postgis_topology-3.so
    lib/postgis_sfcgal-3.so
    lib/address_standardizer-3.so
)

# Set by select_line.
POSTGIS_VERSION=""
POSTGIS_SHA256=""
POSTGIS_NEEDS_GMP=""
POSTGIS_CONFIGURE_FLAGS=()

die() {
    echo "postgis.sh: $*" >&2
    exit 1
}

usage() {
    sed -n '/^# HELP_START$/,/^# HELP_END$/p' "$0" | sed '1d;$d' | sed 's/^# \{0,1\}//' >&2
    exit 2
}

major_of() {
    local version="$1" major
    major="${version%%.*}"
    if [[ ! "$major" =~ ^[0-9]+$ ]]; then
        echo "postgis.sh: cannot read a major version from '${version}'. Pass a hostdb version such as 18.6.0." >&2
        exit 2
    fi
    echo "$major"
}

# One branch per PostGIS line. The flags differ because PostGIS 3.7 moved the
# tiger geocoder and address_standardizer to separate repositories, so their
# --without flags no longer exist.
select_line() {
    local major="$1"
    case "$major" in
        18)
            POSTGIS_VERSION="$POSTGIS_36_VERSION"
            POSTGIS_SHA256="$POSTGIS_36_SHA256"
            POSTGIS_NEEDS_GMP="no"
            POSTGIS_CONFIGURE_FLAGS=(
                --without-raster
                --without-topology
                --without-address-standardizer
                --without-tiger
            )
            ;;
        19)
            POSTGIS_VERSION="$POSTGIS_37_VERSION"
            POSTGIS_SHA256="$POSTGIS_37_SHA256"
            POSTGIS_NEEDS_GMP="yes"
            POSTGIS_CONFIGURE_FLAGS=(
                --without-raster
                --without-topology
            )
            ;;
        *)
            echo "postgis.sh: PostgreSQL ${major} is in PostGIS scope but has no PostGIS line. Add a branch to select_line in builds/postgresql/postgis.sh before building it." >&2
            exit 2
            ;;
    esac
    POSTGIS_CONFIGURE_FLAGS+=(
        --without-sfcgal
        --without-gui
        --disable-extension-upgrades-install
    )
}

mirror_tag() {
    echo "sources-postgis-${POSTGIS_VERSION}"
}

postgis_file() {
    echo "postgis-${POSTGIS_VERSION}.tar.gz"
}

# GitHub renames release assets that contain characters such as "+", so a
# source is mirrored under its upstream name with "+" replaced by "-".
mirror_name() {
    echo "${1//+/-}"
}

# Prints "<mirror-file> <upstream-url> <sha256>" for every source the selected
# line needs.
source_list() {
    echo "$(postgis_file) https://download.osgeo.org/postgis/source/$(postgis_file) ${POSTGIS_SHA256}"
    echo "${GEOS_FILE} ${GEOS_URL} ${GEOS_SHA256}"
    echo "${PROJ_FILE} ${PROJ_URL} ${PROJ_SHA256}"
    if [[ "$POSTGIS_NEEDS_GMP" == "yes" ]]; then
        local entry file sha
        for entry in "${GMP_SOURCE_FILES[@]}"; do
            read -r file sha <<<"$entry"
            echo "$(mirror_name "$file") ${GMP_SOURCE_BASE_URL}/${file} ${sha}"
        done
    fi
}

applies() {
    local version="$1" platform="$2" major supported=""
    major=$(major_of "$version")
    for candidate in "${POSTGIS_PLATFORMS[@]}"; do
        [[ "$candidate" == "$platform" ]] && supported="yes"
    done
    if [[ -z "$supported" || "$major" -lt "$POSTGIS_MIN_MAJOR" ]]; then
        echo "no"
        return
    fi
    select_line "$major"
    echo "yes"
}

pins() {
    local major
    major=$(major_of "$1")
    if [[ "$major" -lt "$POSTGIS_MIN_MAJOR" ]]; then
        die "PostgreSQL ${major} does not carry PostGIS."
    fi
    select_line "$major"
    echo "POSTGIS=${POSTGIS_VERSION}"
    echo "GEOS=${GEOS_VERSION}"
    echo "PROJ=${PROJ_VERSION}"
    echo "MIRROR_TAG=$(mirror_tag)"
}

fetch_sources() {
    local version="$1" dir="$2" major file url sha
    major=$(major_of "$version")
    if [[ "$major" -lt "$POSTGIS_MIN_MAJOR" ]]; then
        die "PostgreSQL ${major} does not carry PostGIS."
    fi
    select_line "$major"
    mkdir -p "$dir"
    while read -r file url sha; do
        curl -fsSL --retry 3 --retry-delay 5 "$url" -o "${dir}/${file}"
        if ! echo "${sha}  ${dir}/${file}" | sha256sum -c -; then
            die "sha256 mismatch for ${file} from ${url}. Do not update the pin without re-verifying the upstream release."
        fi
    done < <(source_list)
}

# Matches every path PostGIS adds to the PostgreSQL prefix. install refuses to
# finish if the build adds a path this function does not name, so the manifest
# can never under-report what the archive gained.
is_manifest_path() {
    case "$1" in
        lib/postgis-3.so) return 0 ;;
        lib/libgeos.so.* | lib/libgeos_c.so.* | lib/libproj.so.*) return 0 ;;
        lib/libjson-c.so.* | lib/libprotobuf-c.so.* | lib/libsqlite3.so.* | lib/libgmp.so.*) return 0 ;;
        share/extension/postgis.control | share/extension/postgis--*.sql) return 0 ;;
        share/contrib/postgis-*/*) return 0 ;;
        share/proj/*) return 0 ;;
        bin/shp2pgsql | bin/pgsql2shp | bin/postgis | bin/postgis_restore) return 0 ;;
        licenses/* | SOURCES.txt) return 0 ;;
    esac
    return 1
}

list_prefix_files() {
    local prefix="$1"
    (cd "$prefix" && find . \( -type f -o -type l \) | sed 's|^\./||' | LC_ALL=C sort)
}

checksum_prefix_files() {
    local prefix="$1"
    (cd "$prefix" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
}

install_build_packages() {
    local packages=(
        bzip2
        cmake
        g++
        libjson-c-dev
        libprotobuf-c-dev
        libsqlite3-dev
        libxml2-dev
        pkg-config
        protobuf-c-compiler
        sqlite3
    )
    if [[ "$POSTGIS_NEEDS_GMP" == "yes" ]]; then
        packages+=(libgmp-dev)
    fi
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
    rm -rf /var/lib/apt/lists/*
}

build_geos() {
    local src="$1" build="$2"
    cmake -S "$src" -B "$build" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX="$DEPS_PREFIX" \
        -DCMAKE_INSTALL_LIBDIR=lib \
        -DBUILD_SHARED_LIBS=ON \
        -DBUILD_TESTING=OFF \
        -DBUILD_BENCHMARKS=OFF \
        -DBUILD_GEOSOP=OFF
    cmake --build "$build" -j "$(nproc)"
    cmake --install "$build"
}

build_proj() {
    local src="$1" build="$2" config_header
    cmake -S "$src" -B "$build" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX="$DEPS_PREFIX" \
        -DCMAKE_INSTALL_LIBDIR=lib \
        -DBUILD_SHARED_LIBS=ON \
        -DENABLE_CURL=OFF \
        -DENABLE_TIFF=OFF \
        -DBUILD_TESTING=OFF \
        -DBUILD_APPS=OFF \
        -DBUILD_EXAMPLES=OFF
    # PROJ finds share/proj relative to libproj.so through dladdr, which is
    # compiled in only when HAVE_LIBDL is set. Without it the relocated archive
    # cannot find proj.db unless PROJ_DATA is exported, so refuse early.
    config_header=$(find "$build" -name proj_config.h -print -quit)
    if [[ -z "$config_header" ]] || ! grep -q '^#define HAVE_LIBDL 1' "$config_header"; then
        die "PROJ was configured without HAVE_LIBDL, so it cannot locate share/proj relative to libproj.so. Check that the dl library is available in the builder."
    fi
    cmake --build "$build" -j "$(nproc)"
    cmake --install "$build"
    if [[ ! -s "${DEPS_PREFIX}/share/proj/proj.db" ]]; then
        die "PROJ did not install share/proj/proj.db. Check that the sqlite3 tool was available when PROJ was built."
    fi
}

assert_postgis_config() {
    local header="$1/postgis_config.h" define
    local required=(HAVE_LIBPROTOBUF HAVE_LIBJSON)
    for define in "${required[@]}"; do
        if ! grep -Eq "^#define ${define} 1" "$header"; then
            die "PostGIS configure did not enable ${define}; check its configure output for the missing library."
        fi
    done
    if grep -Eq '^#define HAVE_SFCGAL 1' "$header"; then
        die "PostGIS configure enabled SFCGAL, which this recipe excludes."
    fi
    # PostGIS 3.7 configure stops with "Could not find required libgmp" when
    # pkg-config cannot find gmp, but its HAVE_LIBGMP define has no slot in
    # postgis_config.h.in, so the proof is GMP_LIBS reaching the link line.
    if [[ "$POSTGIS_NEEDS_GMP" == "yes" ]] && ! grep -Eq '^SHLIB_LINK_F = .*-lgmp' "$1/postgis/Makefile"; then
        die "PostGIS configure did not put -lgmp on the postgis-3.so link line; check the gmp pkg-config result in its configure output."
    fi
}

build_postgis() {
    local pg_config="$1" src="$2"
    (
        cd "$src"
        export LD_LIBRARY_PATH="${DEPS_PREFIX}/lib"
        ./configure \
            --with-pgconfig="$pg_config" \
            --with-geosconfig="${DEPS_PREFIX}/bin/geos-config" \
            --with-projdir="$DEPS_PREFIX" \
            "${POSTGIS_CONFIGURE_FLAGS[@]}"
        assert_postgis_config "$src"
        # Compile the C libraries in parallel, then run the top-level make
        # serially. With -j, utils/ and extensions/ start concurrent sub-makes
        # in raster/rt_pg that both write rtpostgis.sql, and create_upgrade.pl
        # then reads a truncated file ("Unable to locate target new version
        # number"). Upstream orders those directories for this reason
        # (GNUmakefile.in, tickets 5779 and 5780) but the sub-makes still race.
        local dir
        for dir in liblwgeom deps libpgcommon; do
            if [[ -f "${dir}/Makefile" ]]; then
                make -j "$(nproc)" -C "$dir"
            fi
        done
        make
        make install
    )
}

# Copies every bundled dependency of postgis-3.so, transitively, into lib/
# under its soname. The packager stage then rewrites each library's RPATH to
# $ORIGIN, so the archive resolves them wherever it is extracted.
bundle_runtime_libs() {
    local prefix="$1" target deps soname arrow path rest dest
    local queue=("${prefix}/lib/postgis-3.so")
    while [[ ${#queue[@]} -gt 0 ]]; do
        target="${queue[0]}"
        queue=("${queue[@]:1}")
        if ! deps=$(LD_LIBRARY_PATH="${DEPS_PREFIX}/lib" ldd "$target"); then
            die "ldd failed on ${target}."
        fi
        while read -r soname arrow path rest; do
            [[ "$arrow" == "=>" ]] || continue
            if [[ "$path" == "not" ]]; then
                die "${target} needs ${soname}, which is not installed in the builder."
            fi
            if [[ ! "$soname" =~ $BUNDLE_SONAME_PATTERN ]]; then
                if [[ "$path" == "${DEPS_PREFIX}/"* ]]; then
                    die "${target} needs ${soname} from ${DEPS_PREFIX}, which is not on the bundle list. Add it to BUNDLE_SONAME_PATTERN and the manifest."
                fi
                continue
            fi
            dest="${prefix}/lib/${soname}"
            if [[ ! -e "$dest" ]]; then
                cp -L "$path" "$dest"
                chmod 0755 "$dest"
                queue+=("$dest")
            fi
        done <<<"$deps"
    done
}

# True when the ELF object has undefined GMP symbols, i.e. needs libgmp at
# load time. In PostGIS 3.7 only liblwgeom/topo/lwgeom_topo.c uses GMP, and
# liblwgeom is linked statically, so postgis-3.so carries GMP code only when it
# pulls in that member. Built --without-topology against PostgreSQL 19, whose
# LDFLAGS add -Wl,--as-needed, it does not, and libgmp is then not NEEDED.
uses_gmp() {
    local out
    if ! out=$(nm -D --undefined-only "$1"); then
        die "nm failed on ${1}; binutils is required to verify the GMP dependency."
    fi
    grep -Eq '[[:space:]]U[[:space:]]+__gmp' <<<"$out"
}

gmp_bundled() {
    compgen -G "${1}/lib/libgmp.so.*" >/dev/null
}

copy_license() {
    local src="$1" dest="$2"
    if [[ ! -s "$src" ]]; then
        die "license file missing: ${src}. The archive must not ship without it."
    fi
    install -D -m 0644 "$src" "$dest"
}

license_dir_of() {
    case "$1" in
        libjson-c5) echo json-c ;;
        libprotobuf-c1) echo protobuf-c ;;
        libsqlite3-0) echo sqlite ;;
        *) die "no license directory for ${1}." ;;
    esac
}

deb_field() {
    dpkg-query -W -f="\${$2}" "$1"
}

write_licenses_and_sources() {
    local prefix="$1" pg_source="$2" src="$3" pg_version
    local licenses="${prefix}/licenses" tag
    tag=$(mirror_tag)
    pg_version=$("${prefix}/bin/pg_config" --version)

    copy_license "${pg_source}/COPYRIGHT" "${licenses}/postgresql/COPYRIGHT"
    copy_license "${src}/postgis-${POSTGIS_VERSION}/LICENSE.TXT" "${licenses}/postgis/LICENSE.TXT"
    copy_license "${src}/postgis-${POSTGIS_VERSION}/COPYING" "${licenses}/postgis/COPYING"
    copy_license "${src}/geos-${GEOS_VERSION}/COPYING" "${licenses}/geos/COPYING"
    copy_license "${src}/proj-${PROJ_VERSION}/COPYING" "${licenses}/proj/COPYING"
    copy_license /usr/share/doc/libjson-c5/copyright "${licenses}/json-c/copyright"
    copy_license /usr/share/doc/libprotobuf-c1/copyright "${licenses}/protobuf-c/copyright"
    copy_license /usr/share/doc/libsqlite3-0/copyright "${licenses}/sqlite/copyright"
    if gmp_bundled "$prefix"; then
        copy_license /usr/share/doc/libgmp10/copyright "${licenses}/gmp/copyright"
        copy_license /usr/share/common-licenses/LGPL-3 "${licenses}/gmp/COPYING.LESSERv3"
        copy_license /usr/share/common-licenses/GPL-3 "${licenses}/gmp/COPYINGv3"
        copy_license /usr/share/common-licenses/GPL-2 "${licenses}/gmp/COPYINGv2"
    fi

    local file url sha
    {
        echo "Sources of the components bundled in this archive"
        echo
        echo "This PostgreSQL archive carries PostGIS and the libraries it needs."
        echo "License texts are in licenses/. The exact source of every component"
        echo "that was built or bundled is listed below. Each Mirror URL is a copy,"
        echo "byte-identical to the upstream file (verify with the SHA256), kept"
        echo "for as long as this archive is distributed."
        echo
        echo "PostgreSQL (${pg_version})"
        echo "  License:  PostgreSQL (licenses/postgresql/COPYRIGHT)"
        echo "  Upstream: https://ftp.postgresql.org/pub/source/"
        echo
        while read -r file url sha; do
            if [[ "$file" == gmp_* ]] && ! gmp_bundled "$prefix"; then
                continue
            fi
            case "$file" in
                postgis-*) echo "PostGIS ${POSTGIS_VERSION}"; echo "  License:  GPL-2.0-or-later (licenses/postgis/)" ;;
                geos-*) echo "GEOS ${GEOS_VERSION}"; echo "  License:  LGPL-2.1 (licenses/geos/COPYING)" ;;
                proj-*) echo "PROJ ${PROJ_VERSION}"; echo "  License:  MIT (licenses/proj/COPYING)" ;;
                gmp_*) echo "GMP source package ${GMP_DEB_VERSION} (Ubuntu 22.04), file ${file}"; echo "  License:  LGPL-3.0-or-later OR GPL-2.0-or-later (licenses/gmp/)" ;;
            esac
            echo "  Upstream: ${url}"
            echo "  Mirror:   ${MIRROR_BASE_URL}/${tag}/${file}"
            echo "  SHA256:   ${sha}"
            echo
        done < <(source_list)
        local pkg
        for pkg in libjson-c5 libprotobuf-c1 libsqlite3-0; do
            echo "${pkg} $(deb_field "$pkg" Version) (Ubuntu 22.04 binary package, bundled as-is)"
            echo "  Source:   https://launchpad.net/ubuntu/+source/$(deb_field "$pkg" source:Package)/$(deb_field "$pkg" source:Version)"
            echo "  License:  see licenses/$(license_dir_of "$pkg")/copyright"
            echo
        done
        if gmp_bundled "$prefix"; then
            echo "libgmp10 ${GMP_DEB_VERSION} (Ubuntu 22.04 binary package, bundled as-is; source package mirrored above)"
            echo
        fi
    } >"${prefix}/SOURCES.txt"
    chmod 0644 "${prefix}/SOURCES.txt"
}

install_postgis() {
    local pg_config="$1" work_dir="$2" pg_source="$3"
    local prefix major pkglibdir src before after before_sums after_sums added path

    major=$("$pg_config" --version | sed -E 's/^PostgreSQL ([0-9]+).*/\1/')
    if [[ ! "$major" =~ ^[0-9]+$ ]]; then
        die "cannot read the PostgreSQL major from '$("$pg_config" --version)'."
    fi
    select_line "$major"

    prefix=$(cd "$("$pg_config" --bindir)/.." && pwd -P)
    pkglibdir=$(cd "$("$pg_config" --pkglibdir)" && pwd -P)
    if [[ "$pkglibdir" != "${prefix}/lib" ]]; then
        die "expected pkglibdir ${prefix}/lib, got ${pkglibdir}. The capability layout (lib/postgis-3.so beside lib/libproj.so, share/proj beside lib) depends on it."
    fi

    install_build_packages
    if [[ "$POSTGIS_NEEDS_GMP" == "yes" ]]; then
        local gmp_installed
        gmp_installed=$(deb_field libgmp10 Version)
        if [[ "$gmp_installed" != "$GMP_DEB_VERSION" ]]; then
            die "the builder has libgmp10 ${gmp_installed}, but the mirrored GMP source is ${GMP_DEB_VERSION}. Update GMP_DEB_VERSION and GMP_SOURCE_FILES together."
        fi
    fi

    src="${work_dir}/postgis-src"
    mkdir -p "$src"
    fetch_sources "${major}.0.0" "$src"
    tar -xjf "${src}/${GEOS_FILE}" -C "$src"
    tar -xzf "${src}/${PROJ_FILE}" -C "$src"
    tar -xzf "${src}/$(postgis_file)" -C "$src"

    build_geos "${src}/geos-${GEOS_VERSION}" "${work_dir}/geos-build"
    build_proj "${src}/proj-${PROJ_VERSION}" "${work_dir}/proj-build"

    before="${work_dir}/prefix-before.txt"
    after="${work_dir}/prefix-after.txt"
    before_sums="${work_dir}/prefix-before.sha256"
    after_sums="${work_dir}/prefix-after.sha256"
    list_prefix_files "$prefix" >"$before"
    checksum_prefix_files "$prefix" >"$before_sums"

    build_postgis "$pg_config" "${src}/postgis-${POSTGIS_VERSION}"
    bundle_runtime_libs "$prefix"
    # The invariant is load-time, not version-based: if any shipped object has
    # undefined GMP symbols, libgmp must be bundled (bundle_runtime_libs copies
    # it only when it is NEEDED). An object that uses GMP without NEEDing it
    # would fail to load, so that is refused too.
    local gmp_target
    for gmp_target in "${prefix}/lib/postgis-3.so" "${prefix}"/lib/lib*.so.*; do
        [[ -f "$gmp_target" ]] || continue
        if uses_gmp "$gmp_target" && ! gmp_bundled "$prefix"; then
            die "${gmp_target#"${prefix}/"} uses GMP symbols but libgmp is not NEEDED or not bundled."
        fi
    done
    if gmp_bundled "$prefix"; then
        echo "libgmp is bundled: postgis-3.so or a bundled library needs it."
    else
        echo "No shipped object references GMP, so libgmp is not bundled."
    fi
    mkdir -p "${prefix}/share/proj"
    cp -R "${DEPS_PREFIX}/share/proj/." "${prefix}/share/proj/"
    write_licenses_and_sources "$prefix" "$pg_source" "$src"

    # The PostGIS install may only ADD files, and only manifest paths.
    list_prefix_files "$prefix" >"$after"
    added=$(LC_ALL=C comm -13 "$before" "$after")
    if [[ -n "$(LC_ALL=C comm -23 "$before" "$after")" ]]; then
        LC_ALL=C comm -23 "$before" "$after" >&2
        die "the PostGIS install removed the files above from the PostgreSQL prefix."
    fi
    while IFS= read -r path; do
        [[ -z "$path" ]] && continue
        if ! is_manifest_path "$path"; then
            die "the PostGIS install added ${path}, which is_manifest_path does not cover. Add it to the manifest (and the store-swap whitelist) or stop the build from installing it."
        fi
    done <<<"$added"
    checksum_prefix_files "$prefix" >"$after_sums"
    if ! LC_ALL=C join -j 2 -o 1.1,2.1,0 <(LC_ALL=C sort -k2 "$before_sums") <(LC_ALL=C sort -k2 "$after_sums") | awk '$1 != $2 { print $3; bad = 1 } END { exit bad }'; then
        die "the PostGIS install modified the pre-existing PostgreSQL files listed above."
    fi
    echo "PostGIS ${POSTGIS_VERSION} installed into ${prefix} (GEOS ${GEOS_VERSION}, PROJ ${PROJ_VERSION}); $(echo "$added" | grep -c .) files added"
}

hostdb_version_of() {
    local root="$1" metadata="$1/.hostdb-metadata.json" version
    if [[ ! -s "$metadata" ]]; then
        die "${metadata} is missing, so the PostgreSQL version of ${root} is unknown."
    fi
    version=$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' "$metadata" | head -n 1)
    if [[ -z "$version" ]]; then
        die "cannot read \"version\" from ${metadata}."
    fi
    echo "$version"
}

verify() {
    local root version major failed=0 file control_version
    root=$(cd "$1" && pwd -P)
    version=$(hostdb_version_of "$root")
    major=$(major_of "$version")
    if [[ "$major" -lt "$POSTGIS_MIN_MAJOR" ]]; then
        die "PostgreSQL ${version} does not carry PostGIS; nothing to verify."
    fi
    select_line "$major"

    local required=(
        lib/postgis-3.so
        share/extension/postgis.control
        "share/extension/postgis--${POSTGIS_VERSION}.sql"
        share/proj/proj.db
        SOURCES.txt
        licenses/postgresql/COPYRIGHT
        licenses/postgis/LICENSE.TXT
        licenses/postgis/COPYING
        licenses/geos/COPYING
        licenses/proj/COPYING
        licenses/json-c/copyright
        licenses/protobuf-c/copyright
        licenses/sqlite/copyright
    )
    local bundled=(libgeos_c.so libgeos.so libproj.so libjson-c.so libprotobuf-c.so libsqlite3.so)
    if gmp_bundled "$root"; then
        required+=(licenses/gmp/copyright licenses/gmp/COPYING.LESSERv3 licenses/gmp/COPYINGv2)
    fi

    for file in "${required[@]}"; do
        if [[ ! -s "${root}/${file}" ]]; then
            echo "PostGIS file missing: ${file}. Rebuild with builds/postgresql/postgis.sh install." >&2
            failed=1
        fi
    done
    if [[ -s "${root}/share/extension/postgis.control" ]]; then
        control_version=$(sed -nE "s/^default_version[[:space:]]*=[[:space:]]*'([^']+)'.*/\1/p" "${root}/share/extension/postgis.control")
        if [[ "$control_version" != "$POSTGIS_VERSION" ]]; then
            echo "postgis.control default_version is '${control_version}', expected '${POSTGIS_VERSION}'." >&2
            failed=1
        fi
    fi
    for file in "${FORBIDDEN_FILES[@]}"; do
        if [[ -e "${root}/${file}" ]]; then
            echo "Excluded PostGIS component present: ${file}. Only core postgis may ship." >&2
            failed=1
        fi
    done
    if [[ -n "$(find "$root" -name 'libgdal*' -print -quit)" ]]; then
        echo "A GDAL library is present in the archive; raster support must not ship." >&2
        failed=1
    fi

    local name matches
    for name in "${bundled[@]}"; do
        matches=$(find "${root}/lib" -maxdepth 1 -type f -name "${name}.*" -print -quit)
        if [[ -z "$matches" ]]; then
            echo "Bundled library missing from lib/: ${name}.*" >&2
            failed=1
        fi
    done
    if [[ "$failed" -ne 0 ]]; then
        exit 1
    fi

    # Every bundled soname must resolve inside the archive, from postgis-3.so
    # and from each bundled library, with nothing left unresolved.
    local target out soname arrow path rest
    local targets=("${root}/lib/postgis-3.so")
    while IFS= read -r target; do
        targets+=("$target")
    done < <(find "${root}/lib" -maxdepth 1 -type f -regextype posix-extended -regex '.*/lib(geos|geos_c|proj|json-c|protobuf-c|sqlite3|gmp)\.so\..*' | LC_ALL=C sort)
    for target in "${targets[@]}"; do
        if uses_gmp "$target"; then
            if ! gmp_bundled "$root"; then
                echo "${target#"${root}/"} uses GMP symbols but no libgmp is bundled in lib/." >&2
                failed=1
            elif ! grep -Eq '\(NEEDED\).*libgmp\.so' <<<"$(readelf -d "$target")"; then
                echo "${target#"${root}/"} uses GMP symbols but does not list libgmp as NEEDED." >&2
                failed=1
            fi
        fi
        if ! out=$(env -u LD_LIBRARY_PATH ldd "$target" 2>&1); then
            echo "ldd failed on ${target}: ${out}" >&2
            exit 1
        fi
        while read -r soname arrow path rest; do
            [[ "$arrow" == "=>" ]] || continue
            if [[ "$path" == "not" ]]; then
                echo "${target#"${root}/"} cannot resolve ${soname}." >&2
                failed=1
                continue
            fi
            if [[ "$soname" =~ $BUNDLE_SONAME_PATTERN && "$path" != "${root}/lib/"* ]]; then
                echo "${target#"${root}/"} resolves ${soname} to ${path}, outside the archive. Check the \$ORIGIN RPATH rewrite." >&2
                failed=1
            fi
        done <<<"$out"
    done
    if [[ "$failed" -ne 0 ]]; then
        exit 1
    fi
    echo "PostGIS ${POSTGIS_VERSION} verification passed (GEOS ${GEOS_VERSION}, PROJ ${PROJ_VERSION}, ${#targets[@]} libraries resolve inside the archive)"
}

manifest() {
    local root path
    root=$(cd "$1" && pwd -P)
    while IFS= read -r path; do
        if is_manifest_path "$path"; then
            echo "$path"
        fi
    done < <(list_prefix_files "$root")
}

case "${1:-}" in
    applies)
        [[ $# -eq 3 ]] || usage
        applies "$2" "$3"
        ;;
    pins)
        [[ $# -eq 2 ]] || usage
        pins "$2"
        ;;
    fetch-sources)
        [[ $# -eq 3 ]] || usage
        fetch_sources "$2" "$3"
        ;;
    install)
        [[ $# -eq 4 ]] || usage
        install_postgis "$2" "$3" "$4"
        ;;
    verify)
        [[ $# -eq 2 ]] || usage
        verify "$2"
        ;;
    manifest)
        [[ $# -eq 2 ]] || usage
        manifest "$2"
        ;;
    *)
        usage
        ;;
esac
