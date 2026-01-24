#!/bin/bash
#
# Build PostgreSQL + DocumentDB from source on macOS
#
# This script builds PostgreSQL FROM SOURCE to ensure a standard directory layout
# that makes the binaries fully relocatable. Homebrew uses a non-standard layout
# where bin/, share/, and lib/ are in different prefix trees, which breaks
# PostgreSQL's built-in relative path computation.
#
# Usage:
#   ./build-macos.sh <version> <platform> <output_dir>
#   ./build-macos.sh 17-0.107.0 darwin-arm64 ./dist
#
# Requirements:
#   - Homebrew (for build dependencies only, NOT for PostgreSQL itself)
#   - Xcode Command Line Tools
#
# This script builds:
#   - PostgreSQL (from source)
#   - DocumentDB extension
#   - pg_cron
#   - pgvector
#   - rum
#   - PostGIS (from source, using Homebrew for dependencies)
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
VERSION="${1:-17-0.107.0}"
PLATFORM="${2:-darwin-arm64}"
OUTPUT_DIR="${3:-./dist}"

# Parse version components
PG_MAJOR="${VERSION%%-*}"        # "17" from "17-0.107.0"
DOCDB_VERSION="${VERSION#*-}"    # "0.107.0" from "17-0.107.0"

# Convert DocumentDB version to git tag format
# Version "0.107.0" -> Tag "v0.107-0" (major.minor-patch, not major.minor.patch)
DOCDB_MAJOR_MINOR="${DOCDB_VERSION%.*}"  # "0.107" from "0.107.0"
DOCDB_PATCH="${DOCDB_VERSION##*.}"       # "0" from "0.107.0"
DOCDB_GIT_TAG="v${DOCDB_MAJOR_MINOR}-${DOCDB_PATCH}"  # "v0.107-0"

# PostgreSQL source version (latest patch for the major version)
# This must match what's available at https://ftp.postgresql.org/pub/source/
case "${PG_MAJOR}" in
    17) PG_SOURCE_VERSION="17.4" ;;
    18) PG_SOURCE_VERSION="18.0" ;;
    *)  PG_SOURCE_VERSION="${PG_MAJOR}.0" ;;
esac

# Component versions (should match sources.json)
PG_CRON_VERSION="1.6.4"
PGVECTOR_VERSION="0.8.0"
RUM_VERSION="1.3.14"

log_info "PostgreSQL + DocumentDB Build Script (macOS - Source Build)"
log_info "Version: ${VERSION}"
log_info "  PostgreSQL: ${PG_MAJOR} (source: ${PG_SOURCE_VERSION})"
log_info "  DocumentDB: ${DOCDB_VERSION}"
log_info "Platform: ${PLATFORM}"
log_info "Output: ${OUTPUT_DIR}"
echo

# Verify we're on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    log_error "This script only runs on macOS"
    exit 1
fi

# Verify platform matches
CURRENT_ARCH=$(uname -m)
if [[ "${PLATFORM}" == "darwin-x64" && "${CURRENT_ARCH}" != "x86_64" ]]; then
    log_error "Building darwin-x64 requires x86_64 architecture (current: ${CURRENT_ARCH})"
    exit 1
fi
if [[ "${PLATFORM}" == "darwin-arm64" && "${CURRENT_ARCH}" != "arm64" ]]; then
    log_error "Building darwin-arm64 requires arm64 architecture (current: ${CURRENT_ARCH})"
    exit 1
fi

# Verify Homebrew is installed (for build dependencies only)
if ! command -v brew &> /dev/null; then
    log_error "Homebrew is required for build dependencies. Install from https://brew.sh"
    exit 1
fi

# Set up build directories (convert to absolute paths to avoid issues with cd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${OUTPUT_DIR}/build-${VERSION}-${PLATFORM}"
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"
BUILD_DIR="$(cd "${BUILD_DIR}" && pwd)"  # Convert to absolute path
BUNDLE_DIR="${BUILD_DIR}/postgresql-documentdb"
SOURCES_DIR="${BUILD_DIR}/sources"
PG_INSTALL_DIR="${BUILD_DIR}/pg_install"
mkdir -p "${BUNDLE_DIR}" "${SOURCES_DIR}" "${PG_INSTALL_DIR}"

# ============================================================================
# STEP 1: Install build dependencies via Homebrew
# ============================================================================
log_info "Installing build dependencies via Homebrew..."
# PostgreSQL + extension build dependencies
brew install openssl@3 readline libxml2 icu4c zlib lz4 zstd pkg-config cmake pcre2 mongo-c-driver || true
# PostGIS build dependencies (we build PostGIS from source against our PostgreSQL)
brew install geos proj gdal json-c protobuf-c sfcgal || true

# Get Homebrew prefixes for dependencies
OPENSSL_PREFIX="$(brew --prefix openssl@3)"
READLINE_PREFIX="$(brew --prefix readline)"
LIBXML2_PREFIX="$(brew --prefix libxml2)"
ICU_PREFIX="$(brew --prefix icu4c)"
ZLIB_PREFIX="$(brew --prefix zlib)"
LZ4_PREFIX="$(brew --prefix lz4)"
ZSTD_PREFIX="$(brew --prefix zstd)"
MONGO_C_PREFIX="$(brew --prefix mongo-c-driver)"

log_success "Build dependencies installed"

# ============================================================================
# STEP 2: Download and build PostgreSQL from source
# ============================================================================
log_info "Downloading PostgreSQL ${PG_SOURCE_VERSION} source..."
cd "${SOURCES_DIR}"
PG_TARBALL="postgresql-${PG_SOURCE_VERSION}.tar.gz"
PG_URL="https://ftp.postgresql.org/pub/source/v${PG_SOURCE_VERSION}/${PG_TARBALL}"

if [[ ! -f "${PG_TARBALL}" ]]; then
    curl -L -o "${PG_TARBALL}" "${PG_URL}"
fi
log_success "Downloaded PostgreSQL source"

log_info "Extracting PostgreSQL source..."
tar xzf "${PG_TARBALL}"
cd "postgresql-${PG_SOURCE_VERSION}"
log_success "Extracted PostgreSQL source"

# Configure PostgreSQL with a standard prefix layout
# The actual prefix doesn't matter because PostgreSQL computes paths relative
# to the binary location at runtime - we just need a STANDARD directory structure
log_info "Configuring PostgreSQL (standard --prefix layout)..."

# Set up environment for configure
export CPPFLAGS="-I${OPENSSL_PREFIX}/include -I${READLINE_PREFIX}/include -I${LIBXML2_PREFIX}/include -I${ICU_PREFIX}/include -I${ZLIB_PREFIX}/include -I${LZ4_PREFIX}/include -I${ZSTD_PREFIX}/include"
export LDFLAGS="-L${OPENSSL_PREFIX}/lib -L${READLINE_PREFIX}/lib -L${LIBXML2_PREFIX}/lib -L${ICU_PREFIX}/lib -L${ZLIB_PREFIX}/lib -L${LZ4_PREFIX}/lib -L${ZSTD_PREFIX}/lib"
export PKG_CONFIG_PATH="${OPENSSL_PREFIX}/lib/pkgconfig:${READLINE_PREFIX}/lib/pkgconfig:${LIBXML2_PREFIX}/lib/pkgconfig:${ICU_PREFIX}/lib/pkgconfig:${ZLIB_PREFIX}/lib/pkgconfig:${LZ4_PREFIX}/lib/pkgconfig:${ZSTD_PREFIX}/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

./configure \
    --prefix=/usr/local/pgsql \
    --with-openssl \
    --with-libxml \
    --with-icu \
    --with-lz4 \
    --with-zstd \
    --with-readline

log_success "PostgreSQL configured"

log_info "Building PostgreSQL..."
make -j"$(sysctl -n hw.ncpu)"
log_success "PostgreSQL built"

log_info "Installing PostgreSQL to staging directory..."
make install DESTDIR="${PG_INSTALL_DIR}"
log_success "PostgreSQL installed to staging"

# Also install contrib modules (pg_stat_statements, etc.)
log_info "Building and installing PostgreSQL contrib modules..."
make -C contrib -j"$(sysctl -n hw.ncpu)"
make -C contrib install DESTDIR="${PG_INSTALL_DIR}"
log_success "Contrib modules installed"

# Move to bundle directory with standard structure
log_info "Setting up bundle directory structure..."
mv "${PG_INSTALL_DIR}/usr/local/pgsql/"* "${BUNDLE_DIR}/"
log_success "Bundle directory structure ready"

# Set up pg_config for extension builds
PG_CONFIG="${BUNDLE_DIR}/bin/pg_config"
if [[ ! -x "${PG_CONFIG}" ]]; then
    log_error "pg_config not found at ${PG_CONFIG}"
    exit 1
fi

# Verify the directory structure is correct
log_info "Verifying PostgreSQL directory structure..."
log_info "  pg_config --bindir: $(${PG_CONFIG} --bindir)"
log_info "  pg_config --sharedir: $(${PG_CONFIG} --sharedir)"
log_info "  pg_config --pkglibdir: $(${PG_CONFIG} --pkglibdir)"
log_success "PostgreSQL from source installed at ${BUNDLE_DIR}"

# Get actual PGXS paths from the source-built PostgreSQL
PG_SHAREDIR="$(${PG_CONFIG} --sharedir)"
PG_PKGLIBDIR="$(${PG_CONFIG} --pkglibdir)"

# ============================================================================
# STEP 3: Build Intel Decimal Math Library (required for DocumentDB)
# ============================================================================
log_info "Building Intel Decimal Math Library..."
INTEL_MATH_DIR="${SOURCES_DIR}/intelrdfpmath"
INTEL_MATH_INSTALL="${BUILD_DIR}/intelmathlib"

if [[ ! -d "${INTEL_MATH_DIR}" ]]; then
    # Clone the applied/ubuntu/jammy branch (Ubuntu 22.04 LTS version)
    git clone --depth 1 --branch applied/ubuntu/jammy https://git.launchpad.net/ubuntu/+source/intelrdfpmath "${INTEL_MATH_DIR}"
    pushd "${INTEL_MATH_DIR}/LIBRARY" > /dev/null
    # Build with position-independent code
    make -j"$(sysctl -n hw.ncpu)" CC=cc _CFLAGS_OPT="-fPIC -Wno-error=implicit-function-declaration"
    popd > /dev/null

    # Install to local directory
    mkdir -p "${INTEL_MATH_INSTALL}/lib" "${INTEL_MATH_INSTALL}/include"
    cp "${INTEL_MATH_DIR}/LIBRARY/libbid.a" "${INTEL_MATH_INSTALL}/lib/"
    cp "${INTEL_MATH_DIR}/LIBRARY/src/"*.h "${INTEL_MATH_INSTALL}/include/"

    log_success "Intel Decimal Math Library built"
fi

# Convert to absolute path
INTEL_MATH_INSTALL="$(cd "${INTEL_MATH_INSTALL}" && pwd)"

# ============================================================================
# STEP 4: Set up build environment for extensions
# ============================================================================

# Find the actual bson include directory
BSON_INCLUDE=$(find "${MONGO_C_PREFIX}/include" -type d -name "bson*" | head -1)
if [[ -z "${BSON_INCLUDE}" ]]; then
    BSON_INCLUDE="${MONGO_C_PREFIX}/include/libbson-1.0"
fi

# Create fake pkgconfig files for dependencies
FAKE_PKGCONFIG_DIR="${BUILD_DIR}/pkgconfig"
mkdir -p "${FAKE_PKGCONFIG_DIR}"
FAKE_PKGCONFIG_DIR="$(cd "${FAKE_PKGCONFIG_DIR}" && pwd)"

# Detect bson library name (mongo-c-driver 2.x uses libbson2, older uses libbson-1.0)
BSON_LIB_NAME=""
for lib in "${MONGO_C_PREFIX}/lib/"libbson*.dylib; do
    if [[ -f "$lib" ]]; then
        libname=$(basename "$lib" | sed -E 's/^lib([^.]+)\..*$/\1/')
        if [[ ! "$libname" =~ [0-9]+$ ]]; then
            BSON_LIB_NAME="$libname"
            break
        fi
    fi
done
if [[ -z "$BSON_LIB_NAME" ]]; then
    BSON_LIB_NAME="bson-1.0"
    log_warn "Could not detect bson library name, falling back to $BSON_LIB_NAME"
else
    log_info "Detected bson library: $BSON_LIB_NAME"
fi

cat > "${FAKE_PKGCONFIG_DIR}/libbson-static-1.0.pc" <<EOF
prefix=${MONGO_C_PREFIX}
includedir=${BSON_INCLUDE}
libdir=\${prefix}/lib

Name: libbson-static
Description: libbson static library (fake pkgconfig for Homebrew)
Version: 1.0
Cflags: -I\${includedir} -I\${includedir}/bson
Libs: -L\${libdir} -l${BSON_LIB_NAME}
EOF

cat > "${FAKE_PKGCONFIG_DIR}/intelmathlib.pc" <<EOF
prefix=${INTEL_MATH_INSTALL}
includedir=\${prefix}/include
libdir=\${prefix}/lib

Name: intelmathlib
Description: Intel Decimal Floating-Point Math Library
Version: 1.0.0
Cflags: -I\${includedir}
Libs: -L\${libdir} -lbid
EOF

export PKG_CONFIG_PATH="${FAKE_PKGCONFIG_DIR}:${MONGO_C_PREFIX}/lib/pkgconfig:${ICU_PREFIX}/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
export CPPFLAGS="-I${BSON_INCLUDE} -I${BSON_INCLUDE}/bson -I${ICU_PREFIX}/include -I${INTEL_MATH_INSTALL}/include ${CPPFLAGS:-}"
export CFLAGS="-I${BSON_INCLUDE} -I${BSON_INCLUDE}/bson -I${ICU_PREFIX}/include -I${INTEL_MATH_INSTALL}/include ${CFLAGS:-}"
export LDFLAGS="-L${MONGO_C_PREFIX}/lib -L${ICU_PREFIX}/lib -L${INTEL_MATH_INSTALL}/lib ${LDFLAGS:-}"

# Create compatibility symlinks for mongo-c-driver 2.x
COMPAT_LIB_DIR="${BUILD_DIR}/compat-lib"
mkdir -p "${COMPAT_LIB_DIR}"
COMPAT_LIB_DIR="$(cd "${COMPAT_LIB_DIR}" && pwd)"
if [[ -f "${MONGO_C_PREFIX}/lib/libbson2.dylib" ]]; then
    log_info "Creating compatibility symlinks for mongo-c-driver 2.x..."
    ln -sf "${MONGO_C_PREFIX}/lib/libbson2.dylib" "${COMPAT_LIB_DIR}/libbson-1.0.dylib"
    ln -sf "${MONGO_C_PREFIX}/lib/libbson2.a" "${COMPAT_LIB_DIR}/libbson-1.0.a" 2>/dev/null || true
    log_success "Created libbson-1.0 -> libbson2 compatibility symlinks"
fi

# Create a clang wrapper to fix macOS rpath syntax
CLANG_WRAPPER="${BUILD_DIR}/clang-wrapper.sh"
cat > "${CLANG_WRAPPER}" <<'WRAPPER_EOF'
#!/bin/bash
# Clang wrapper to translate Linux-style rpath flags to macOS style and handle other compatibility issues
args=()
for arg in "$@"; do
    case "$arg" in
        -Wl,-rpath=*)
            path="${arg#-Wl,-rpath=}"
            args+=("-Wl,-rpath,${path}")
            ;;
        -fexcess-precision=*)
            # GCC-specific flag, skip on clang
            ;;
        -Werror)
            args+=("-Wno-error")
            ;;
        -l:pg_documentdb_core.so)
            # macOS doesn't support -l:filename syntax, use -undefined dynamic_lookup
            args+=("-undefined" "dynamic_lookup")
            ;;
        *)
            args+=("$arg")
            ;;
    esac
done
exec /usr/bin/clang "${args[@]}"
WRAPPER_EOF
chmod +x "${CLANG_WRAPPER}"
CLANG_WRAPPER="$(cd "$(dirname "${CLANG_WRAPPER}")" && pwd)/$(basename "${CLANG_WRAPPER}")"

# ============================================================================
# STEP 5: Build DocumentDB extension
# ============================================================================
log_info "Building DocumentDB extension v${DOCDB_VERSION} (tag: ${DOCDB_GIT_TAG})..."
cd "${SOURCES_DIR}"
if [[ ! -d "documentdb" ]]; then
    git clone --depth 1 --branch "${DOCDB_GIT_TAG}" https://github.com/FerretDB/documentdb.git
fi
cd documentdb

# Fix bash compatibility for macOS
if [[ -f /opt/homebrew/bin/bash ]]; then
    MODERN_BASH="/opt/homebrew/bin/bash"
elif [[ -f /usr/local/bin/bash ]]; then
    MODERN_BASH="/usr/local/bin/bash"
else
    log_info "Installing modern bash via Homebrew..."
    brew install bash
    MODERN_BASH="$(brew --prefix)/bin/bash"
fi
log_info "Using modern bash: ${MODERN_BASH}"
find . -name "*.sh" -type f -exec sed -i '' "1s|#!/bin/bash|#!${MODERN_BASH}|" {} \;
find . -name "*.sh" -type f -exec sed -i '' "1s|#!/usr/bin/env bash|#!${MODERN_BASH}|" {} \;

# Fix type mismatch
log_info "Patching type mismatches for macOS compatibility..."
find . -name "*.c" -type f -exec sed -i '' 's/int64_t \*shardKeyValue/int64 *shardKeyValue/g' {} \;

export LIBRARY_PATH="${COMPAT_LIB_DIR}:${ICU_PREFIX}/lib:${LIBRARY_PATH:-}"
EXTRA_CFLAGS="-Wno-error -I${BSON_INCLUDE} -I${BSON_INCLUDE}/bson -I${ICU_PREFIX}/include -I${INTEL_MATH_INSTALL}/include"
ICU_LINK="-L${ICU_PREFIX}/lib -licuuc -licui18n -licudata"

# Build pg_documentdb_core first
log_info "Building pg_documentdb_core..."
make -C pg_documentdb_core PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" CC="${CLANG_WRAPPER}" LDFLAGS="${ICU_LINK}" WERROR= -j"$(sysctl -n hw.ncpu)"

# Create .so -> .dylib symlink
if [[ -f pg_documentdb_core/pg_documentdb_core.dylib ]]; then
    ln -sf pg_documentdb_core.dylib pg_documentdb_core/pg_documentdb_core.so
fi

# Build pg_documentdb
log_info "Building pg_documentdb..."
make -C pg_documentdb PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" CC="${CLANG_WRAPPER}" LDFLAGS="${ICU_LINK}" WERROR= -j"$(sysctl -n hw.ncpu)"

# Install extensions directly to bundle directory (since we're using source-built PostgreSQL with standard layout)
log_info "Installing DocumentDB extensions..."
make -C pg_documentdb_core PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" CC="${CLANG_WRAPPER}" LDFLAGS="${ICU_LINK}" WERROR= install
make -C pg_documentdb PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" CC="${CLANG_WRAPPER}" LDFLAGS="${ICU_LINK}" WERROR= install

log_success "DocumentDB extension built and installed"

# ============================================================================
# STEP 6: Build pg_cron
# ============================================================================
log_info "Building pg_cron v${PG_CRON_VERSION}..."
cd "${SOURCES_DIR}"
if [[ ! -d "pg_cron" ]]; then
    git clone --depth 1 --branch "v${PG_CRON_VERSION}" https://github.com/citusdata/pg_cron.git
fi
cd pg_cron
make PG_CONFIG="${PG_CONFIG}" CC="${CLANG_WRAPPER}" PG_LDFLAGS="-undefined dynamic_lookup" -j"$(sysctl -n hw.ncpu)"
make PG_CONFIG="${PG_CONFIG}" CC="${CLANG_WRAPPER}" PG_LDFLAGS="-undefined dynamic_lookup" install
log_success "pg_cron built and installed"

# ============================================================================
# STEP 7: Build pgvector
# ============================================================================
log_info "Building pgvector v${PGVECTOR_VERSION}..."
cd "${SOURCES_DIR}"
if [[ ! -d "pgvector" ]]; then
    git clone --depth 1 --branch "v${PGVECTOR_VERSION}" https://github.com/pgvector/pgvector.git
fi
cd pgvector
make PG_CONFIG="${PG_CONFIG}" CC="${CLANG_WRAPPER}" -j"$(sysctl -n hw.ncpu)"
make PG_CONFIG="${PG_CONFIG}" CC="${CLANG_WRAPPER}" install
log_success "pgvector built and installed"

# ============================================================================
# STEP 8: Build rum
# ============================================================================
log_info "Building rum v${RUM_VERSION}..."
cd "${SOURCES_DIR}"
if [[ ! -d "rum" ]]; then
    git clone --depth 1 --branch "${RUM_VERSION}" https://github.com/postgrespro/rum.git
fi
cd rum
make USE_PGXS=1 PG_CONFIG="${PG_CONFIG}" CC="${CLANG_WRAPPER}" -j"$(sysctl -n hw.ncpu)"
make USE_PGXS=1 PG_CONFIG="${PG_CONFIG}" CC="${CLANG_WRAPPER}" install
log_success "rum built and installed"

# ============================================================================
# STEP 9: Build PostGIS from source
# ============================================================================
POSTGIS_VERSION="3.5.2"
POSTGIS_URL="https://download.osgeo.org/postgis/source/postgis-${POSTGIS_VERSION}.tar.gz"
POSTGIS_DIR="${SOURCES_DIR}/postgis-${POSTGIS_VERSION}"

log_info "Building PostGIS ${POSTGIS_VERSION} from source..."
log_info "Downloading PostGIS source..."
curl -fsSL "${POSTGIS_URL}" | tar xz -C "${SOURCES_DIR}"

cd "${POSTGIS_DIR}"

# Get Homebrew prefix for dependencies
GEOS_PREFIX="$(brew --prefix geos)"
PROJ_PREFIX="$(brew --prefix proj)"
GDAL_PREFIX="$(brew --prefix gdal)"
JSONC_PREFIX="$(brew --prefix json-c)"
PROTOBUFC_PREFIX="$(brew --prefix protobuf-c)"

# Configure PostGIS against our source-built PostgreSQL
# We disable raster/topology/sfcgal since DocumentDB only needs core PostGIS
log_info "Configuring PostGIS..."
./configure \
    --with-pgconfig="${PG_CONFIG}" \
    --with-geosconfig="${GEOS_PREFIX}/bin/geos-config" \
    --with-projdir="${PROJ_PREFIX}" \
    --with-jsondir="${JSONC_PREFIX}" \
    --with-protobufdir="${PROTOBUFC_PREFIX}" \
    --without-raster \
    --without-topology \
    --without-sfcgal \
    --without-gui \
    --without-phony-revision \
    --without-interrupt-tests

# Build only the core PostGIS library and extension (not raster/topology which have build issues)
log_info "Building PostGIS core library..."
make -C liblwgeom -j"$(sysctl -n hw.ncpu)"
make -C libpgcommon -j"$(sysctl -n hw.ncpu)"
make -C deps/flatgeobuf -j"$(sysctl -n hw.ncpu)" 2>/dev/null || true
make -C deps/wagyu -j"$(sysctl -n hw.ncpu)" 2>/dev/null || true

log_info "Building PostGIS extension..."
make -C postgis -j"$(sysctl -n hw.ncpu)"

# Install core PostGIS to our bundle
log_info "Installing PostGIS..."
make -C liblwgeom install
make -C postgis install

# Generate and install extension SQL files
log_info "Installing PostGIS extension files..."
make -C extensions/postgis 2>/dev/null || true
make -C extensions/postgis install 2>/dev/null || true

# If make install failed, manually copy the essential extension files
POSTGIS_EXT_DIR="${BUNDLE_DIR}/share/extension"
if [[ ! -f "${POSTGIS_EXT_DIR}/postgis.control" ]]; then
    log_warn "PostGIS extension install failed, copying files manually..."

    # Copy control file
    if [[ -f "${POSTGIS_DIR}/extensions/postgis/postgis.control" ]]; then
        cp "${POSTGIS_DIR}/extensions/postgis/postgis.control" "${POSTGIS_EXT_DIR}/"
    fi

    # Copy SQL files - find and copy all postgis*.sql files
    find "${POSTGIS_DIR}/extensions/postgis/sql" -name "postgis*.sql" -exec cp {} "${POSTGIS_EXT_DIR}/" \; 2>/dev/null || true

    # If that didn't work, try the generated file directly
    if [[ ! -f "${POSTGIS_EXT_DIR}/postgis--${POSTGIS_VERSION}.sql" ]]; then
        if [[ -f "${POSTGIS_DIR}/extensions/postgis/sql/postgis--${POSTGIS_VERSION}.sql" ]]; then
            cp "${POSTGIS_DIR}/extensions/postgis/sql/postgis--${POSTGIS_VERSION}.sql" "${POSTGIS_EXT_DIR}/"
        fi
    fi
fi

# Verify PostGIS extension files
if [[ -f "${POSTGIS_EXT_DIR}/postgis.control" ]]; then
    log_success "PostGIS ${POSTGIS_VERSION} built and installed"
else
    log_error "PostGIS extension files missing - check build logs"
fi

# ============================================================================
# STEP 10: Fix library paths to make binaries fully relocatable
# ============================================================================
log_info "Making binaries relocatable..."

BUNDLE_LIB_DIR="${BUNDLE_DIR}/lib"
mkdir -p "${BUNDLE_LIB_DIR}"

# Track processed libraries
PROCESSED_LIBS_FILE="${BUILD_DIR}/.processed_libs"
: > "${PROCESSED_LIBS_FILE}"

is_lib_processed() { grep -qxF "$1" "${PROCESSED_LIBS_FILE}" 2>/dev/null; }
mark_lib_processed() { echo "$1" >> "${PROCESSED_LIBS_FILE}"; }

# Function to copy a library and all its dependencies recursively
copy_lib_recursive() {
    local lib_path="$1"
    local lib_name
    lib_name=$(basename "$lib_path")

    if is_lib_processed "$lib_name"; then return 0; fi
    mark_lib_processed "$lib_name"

    # Skip system libraries
    if [[ "$lib_path" == /usr/lib/* ]] || [[ "$lib_path" == /System/* ]] || [[ "$lib_path" == "@"* ]]; then
        return 0
    fi

    if [[ ! -f "$lib_path" ]]; then return 0; fi

    # Copy Homebrew libraries to bundle
    if [[ "$lib_path" == *"/opt/homebrew/"* ]] || [[ "$lib_path" == *"/usr/local/"* ]] || [[ "$lib_path" == *"/Cellar/"* ]]; then
        if [[ ! -f "${BUNDLE_LIB_DIR}/${lib_name}" ]]; then
            log_info "  Bundling: ${lib_name}"
            cp -L "$lib_path" "${BUNDLE_LIB_DIR}/${lib_name}" 2>/dev/null || true
        fi
    fi

    # Recursively process dependencies
    local deps lib_dir
    lib_dir=$(dirname "$lib_path")
    deps=$(otool -L "$lib_path" 2>/dev/null | tail -n +2 | awk '{print $1}') || return 0

    for dep in $deps; do
        if [[ "$dep" == /usr/lib/* ]] || [[ "$dep" == /System/* ]]; then continue; fi
        if [[ "$dep" == @loader_path/* ]]; then
            local resolved_path="${lib_dir}/${dep#@loader_path/}"
            if [[ -f "$resolved_path" ]]; then copy_lib_recursive "$resolved_path"; fi
            continue
        fi
        if [[ "$dep" == "@"* ]]; then continue; fi
        if [[ -f "$dep" ]]; then copy_lib_recursive "$dep"; fi
    done
}

# Bundle Homebrew dependencies
log_info "Step 1: Bundling Homebrew dependencies..."

if [[ -d "${BUNDLE_DIR}/bin" ]]; then
    for binary in "${BUNDLE_DIR}/bin/"*; do
        [[ -f "$binary" ]] || continue
        file "$binary" | grep -q "Mach-O" || continue
        deps=$(otool -L "$binary" 2>/dev/null | tail -n +2 | awk '{print $1}') || continue
        for dep in $deps; do copy_lib_recursive "$dep"; done
    done
fi

# Process dylibs until no new ones are added
if [[ -d "${BUNDLE_LIB_DIR}" ]]; then
    prev_count=0
    curr_count=1
    while [[ $prev_count -ne $curr_count ]]; do
        prev_count=$curr_count
        for dylib in "${BUNDLE_LIB_DIR}/"*.dylib; do
            [[ -f "$dylib" ]] || continue
            deps=$(otool -L "$dylib" 2>/dev/null | tail -n +2 | awk '{print $1}') || continue
            for dep in $deps; do copy_lib_recursive "$dep"; done
        done
        curr_count=$(ls -1 "${BUNDLE_LIB_DIR}/"*.dylib 2>/dev/null | wc -l)
    done
fi

BUNDLED_COUNT=$(wc -l < "${PROCESSED_LIBS_FILE}" | tr -d ' ')
log_success "Bundled ${BUNDLED_COUNT} libraries"

# Fix install names
log_info "Step 2: Fixing dylib install names..."
shopt -s nullglob
for dylib in "${BUNDLE_LIB_DIR}/"*.dylib "${BUNDLE_LIB_DIR}/postgresql/"*.dylib; do
    [[ -f "$dylib" ]] || continue
    lib_name=$(basename "$dylib")
    current_id=$(otool -D "$dylib" 2>/dev/null | tail -1) || continue
    if [[ "$current_id" == "@"* ]]; then continue; fi

    if [[ "$dylib" == *"/lib/postgresql/"* ]]; then
        new_id="@rpath/postgresql/${lib_name}"
    else
        new_id="@rpath/${lib_name}"
    fi
    install_name_tool -id "$new_id" "$dylib" 2>/dev/null || true
done
shopt -u nullglob

# Fix library references
log_info "Step 3: Fixing library references..."

fix_references() {
    local file="$1"
    local is_dylib="$2"

    file "$file" | grep -q "Mach-O" || return 0

    local deps
    deps=$(otool -L "$file" 2>/dev/null | tail -n +2 | awk '{print $1}') || return 0

    for dep in $deps; do
        if [[ "$dep" == /usr/lib/* ]] || [[ "$dep" == /System/* ]] || [[ "$dep" == "@"* ]]; then continue; fi

        local lib_name new_path=""
        lib_name=$(basename "$dep")

        if [[ -f "${BUNDLE_LIB_DIR}/${lib_name}" ]]; then
            if [[ "$is_dylib" == "dylib" ]]; then
                new_path="@loader_path/${lib_name}"
            else
                new_path="@loader_path/../lib/${lib_name}"
            fi
        elif [[ -f "${BUNDLE_LIB_DIR}/postgresql/${lib_name}" ]]; then
            if [[ "$is_dylib" == "dylib" ]]; then
                new_path="@loader_path/postgresql/${lib_name}"
            else
                new_path="@loader_path/../lib/postgresql/${lib_name}"
            fi
        fi

        if [[ -n "$new_path" ]]; then
            install_name_tool -change "$dep" "$new_path" "$file" 2>/dev/null || true
        fi
    done

    if [[ "$is_dylib" != "dylib" ]]; then
        if ! otool -l "$file" 2>/dev/null | grep -A2 "LC_RPATH" | grep -q "@loader_path/../lib"; then
            install_name_tool -add_rpath "@loader_path/../lib" "$file" 2>/dev/null || true
        fi
    fi
}

if [[ -d "${BUNDLE_DIR}/bin" ]]; then
    for binary in "${BUNDLE_DIR}/bin/"*; do
        [[ -f "$binary" ]] && fix_references "$binary" "binary"
    done
fi

shopt -s nullglob
for dylib in "${BUNDLE_LIB_DIR}/"*.dylib "${BUNDLE_LIB_DIR}/postgresql/"*.dylib; do
    [[ -f "$dylib" ]] && fix_references "$dylib" "dylib"
done
shopt -u nullglob

# Verify
log_info "Step 4: Verifying relocatable binaries..."
VERIFY_FAILED=0

for binary in pg_ctl initdb psql postgres; do
    BINARY_PATH="${BUNDLE_DIR}/bin/${binary}"
    if [[ -f "$BINARY_PATH" ]]; then
        REMAINING=$(otool -L "$BINARY_PATH" 2>/dev/null | grep -E "(Cellar|opt/homebrew|usr/local)" | grep -v "^$" || true)
        if [[ -n "$REMAINING" ]]; then
            log_warn "Non-relocatable paths in ${binary}:"
            echo "$REMAINING" | while read -r line; do log_warn "    $line"; done
            VERIFY_FAILED=1
        fi
    fi
done

if [[ $VERIFY_FAILED -eq 0 ]]; then
    log_success "All binaries are now relocatable"
else
    log_warn "Some binaries still have non-relocatable paths"
fi

log_success "Library path fixing complete"

# ============================================================================
# STEP 11: Copy pre-configured postgresql.conf.sample
# ============================================================================
CONF_SAMPLE="${SCRIPT_DIR}/postgresql.conf.sample"
if [[ -f "${CONF_SAMPLE}" ]]; then
    cp "${CONF_SAMPLE}" "${BUNDLE_DIR}/share/postgresql.conf.sample"
    log_success "Added pre-configured postgresql.conf.sample"
fi

# ============================================================================
# STEP 12: Add metadata file and create tarball
# ============================================================================
cat > "${BUNDLE_DIR}/.hostdb-metadata.json" <<EOF
{
  "name": "postgresql-documentdb",
  "version": "${VERSION}",
  "platform": "${PLATFORM}",
  "source": "source-build",
  "components": {
    "postgresql": "${PG_SOURCE_VERSION}",
    "documentdb": "${DOCDB_VERSION}",
    "pg_cron": "${PG_CRON_VERSION}",
    "pgvector": "${PGVECTOR_VERSION}",
    "rum": "${RUM_VERSION}"
  },
  "rehosted_by": "hostdb",
  "rehosted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# List what we built
log_info "Built files:"
if [[ -d "${BUNDLE_DIR}/bin" ]]; then
    log_info "  bin/: $(ls "${BUNDLE_DIR}/bin" | head -10 | tr '\n' ' ')..."
fi
if [[ -d "${BUNDLE_DIR}/lib/postgresql" ]]; then
    SO_FILES=$(ls "${BUNDLE_DIR}/lib/postgresql" 2>/dev/null | grep -E '\.(so|dylib)$' | head -10 | tr '\n' ' ' || true)
    log_info "  lib/postgresql/ (*.so/*.dylib): ${SO_FILES}..."
fi
EXTENSION_DIR="${BUNDLE_DIR}/share/extension"
if [[ -d "$EXTENSION_DIR" ]]; then
    CTRL_FILES=$(ls "$EXTENSION_DIR" 2>/dev/null | grep '\.control$' | tr '\n' ' ' || true)
    log_info "  extensions (*.control): ${CTRL_FILES}"
    # Use the already-captured CTRL_FILES to check for DocumentDB (avoids shell quirks with repeated ls)
    if [[ "${CTRL_FILES}" == *"documentdb"* ]]; then
        log_success "DocumentDB extension files present"
    else
        log_error "DocumentDB extension files MISSING - this is a build error!"
    fi
fi

# ============================================================================
# STEP 12: Sign binaries for macOS Gatekeeper
# ============================================================================
log_info "Signing binaries for macOS Gatekeeper..."

SIGNED_COUNT=0
for f in "${BUNDLE_DIR}/bin/"*; do
    if [[ -f "$f" ]] && file "$f" | grep -q "Mach-O"; then
        codesign -s - --force "$f" 2>/dev/null && ((SIGNED_COUNT++)) || true
    fi
done
for f in "${BUNDLE_DIR}/lib/"*.dylib; do
    if [[ -f "$f" ]]; then
        codesign -s - --force "$f" 2>/dev/null && ((SIGNED_COUNT++)) || true
    fi
done

log_success "Signed ${SIGNED_COUNT} binaries"

# Create tarball
OUTPUT_FILE="${OUTPUT_DIR}/postgresql-documentdb-${VERSION}-${PLATFORM}.tar.gz"
mkdir -p "${OUTPUT_DIR}"

log_info "Creating ${OUTPUT_FILE}..."
tar -czf "${OUTPUT_FILE}" -C "${BUILD_DIR}" "postgresql-documentdb"

# Calculate checksum
SHA256=$(shasum -a 256 "${OUTPUT_FILE}" | cut -d' ' -f1)
log_info "SHA256: ${SHA256}"

# Cleanup build directory
rm -rf "${BUILD_DIR}"

log_success "Build complete: ${OUTPUT_FILE}"
