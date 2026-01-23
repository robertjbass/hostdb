#!/bin/bash
#
# Build PostgreSQL + DocumentDB from source on macOS
#
# Usage:
#   ./build-macos.sh <version> <platform> <output_dir>
#   ./build-macos.sh 17-0.107.0 darwin-arm64 ./dist
#
# Requirements:
#   - Homebrew
#   - Xcode Command Line Tools
#
# This script builds:
#   - DocumentDB extension
#   - pg_cron
#   - pgvector
#   - rum
#   - PostGIS (via Homebrew)
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

# Component versions (should match sources.json)
PG_CRON_VERSION="1.6.4"
PGVECTOR_VERSION="0.8.0"
RUM_VERSION="1.3.14"

log_info "PostgreSQL + DocumentDB Build Script (macOS)"
log_info "Version: ${VERSION}"
log_info "  PostgreSQL: ${PG_MAJOR}"
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

# Verify Homebrew is installed
if ! command -v brew &> /dev/null; then
    log_error "Homebrew is required. Install from https://brew.sh"
    exit 1
fi

# Set up build directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${OUTPUT_DIR}/build-${VERSION}-${PLATFORM}"
BUNDLE_DIR="${BUILD_DIR}/postgresql-documentdb"
SOURCES_DIR="${BUILD_DIR}/sources"

rm -rf "${BUILD_DIR}"
mkdir -p "${BUNDLE_DIR}" "${SOURCES_DIR}"

# Install base PostgreSQL via Homebrew
log_info "Installing PostgreSQL ${PG_MAJOR} via Homebrew..."
brew install "postgresql@${PG_MAJOR}" || log_warn "PostgreSQL may already be installed"

PG_PREFIX="$(brew --prefix postgresql@${PG_MAJOR})"
PG_CONFIG="${PG_PREFIX}/bin/pg_config"

if [[ ! -x "${PG_CONFIG}" ]]; then
    log_error "pg_config not found at ${PG_CONFIG}"
    exit 1
fi

log_success "PostgreSQL ${PG_MAJOR} installed at ${PG_PREFIX}"

# Copy base PostgreSQL to bundle
log_info "Copying base PostgreSQL..."
cp -R "${PG_PREFIX}/"* "${BUNDLE_DIR}/"

# Install build dependencies
log_info "Installing build dependencies..."
brew install cmake pkg-config pcre2 mongo-c-driver icu4c || true

# Build Intel Decimal Math Library from source
# (required for DocumentDB's decimal128 support, not available via Homebrew)
INTEL_MATH_DIR="${SOURCES_DIR}/intelrdfpmath"
INTEL_MATH_INSTALL="${BUILD_DIR}/intelmathlib"

if [[ ! -d "${INTEL_MATH_DIR}" ]]; then
    log_info "Building Intel Decimal Math Library..."
    # Clone the applied/ubuntu/jammy branch (Ubuntu 22.04 LTS version)
    git clone --depth 1 --branch applied/ubuntu/jammy https://git.launchpad.net/ubuntu/+source/intelrdfpmath "${INTEL_MATH_DIR}"
    pushd "${INTEL_MATH_DIR}/LIBRARY" > /dev/null
    # Build with position-independent code
    # Note: makefile only recognizes cc, gcc, icc, icl, cl - not clang directly
    # Note: Add -Wno-error flags for macOS clang compatibility (missing signal.h, etc.)
    make -j"$(sysctl -n hw.ncpu)" CC=cc _CFLAGS_OPT="-fPIC -Wno-error=implicit-function-declaration"
    popd > /dev/null

    # Install to local directory (must be after popd to use correct relative paths)
    mkdir -p "${INTEL_MATH_INSTALL}/lib" "${INTEL_MATH_INSTALL}/include"
    cp "${INTEL_MATH_DIR}/LIBRARY/libbid.a" "${INTEL_MATH_INSTALL}/lib/"
    cp "${INTEL_MATH_DIR}/LIBRARY/src/"*.h "${INTEL_MATH_INSTALL}/include/"

    log_success "Intel Decimal Math Library built"
fi

# Convert to absolute path (critical: make runs from documentdb/, relative paths break)
INTEL_MATH_INSTALL="$(cd "${INTEL_MATH_INSTALL}" && pwd)"

# Set up environment for dependencies
# mongo-c-driver provides libbson, icu4c provides unicode headers
MONGO_C_PREFIX="$(brew --prefix mongo-c-driver)"
ICU_PREFIX="$(brew --prefix icu4c)"

# Find the actual bson include directory (varies by mongo-c-driver version)
# mongo-c-driver 2.x uses bson-X.Y.Z/, older versions use libbson-1.0/
BSON_INCLUDE=$(find "${MONGO_C_PREFIX}/include" -type d -name "bson*" | head -1)
if [[ -z "${BSON_INCLUDE}" ]]; then
    BSON_INCLUDE="${MONGO_C_PREFIX}/include/libbson-1.0"
fi

# DocumentDB's Makefile uses pkg-config to find libbson-static-1.0, but Homebrew
# only provides libbson-1.0 (dynamic). Create a fake pkgconfig file for the static version.
FAKE_PKGCONFIG_DIR="${BUILD_DIR}/pkgconfig"
mkdir -p "${FAKE_PKGCONFIG_DIR}"
# Convert to absolute path (critical: make runs from documentdb/, relative paths break)
FAKE_PKGCONFIG_DIR="$(cd "${FAKE_PKGCONFIG_DIR}" && pwd)"

# Detect the actual bson library name (mongo-c-driver 2.x may use libbson2, older uses libbson-1.0)
# Look for libbson*.dylib and extract the library name
BSON_LIB_NAME=""
for lib in "${MONGO_C_PREFIX}/lib/"libbson*.dylib; do
    if [[ -f "$lib" ]]; then
        # Extract name like "bson-1.0" from "libbson-1.0.dylib" or "libbson-1.0.123.dylib"
        libname=$(basename "$lib" | sed -E 's/^lib([^.]+)\..*$/\1/')
        # Skip versioned symlinks, prefer base name
        if [[ ! "$libname" =~ [0-9]+$ ]]; then
            BSON_LIB_NAME="$libname"
            break
        fi
    fi
done

# Fall back to bson-1.0 if detection fails
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

# Create pkgconfig file for Intel math library
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

log_info "PKG_CONFIG_PATH: ${PKG_CONFIG_PATH}"
log_info "BSON_INCLUDE: ${BSON_INCLUDE}"

# Debug: show what's actually in the mongo-c-driver include directory
log_info "Contents of mongo-c-driver include directory:"
find "${MONGO_C_PREFIX}/include" -name "*.h" 2>/dev/null | head -20 || log_warn "Could not list include directory"
log_info "Looking for bson.h:"
find "${MONGO_C_PREFIX}" -name "bson.h" 2>/dev/null || log_warn "bson.h not found in mongo-c-driver"

# Debug: show what library files exist in mongo-c-driver
log_info "Contents of mongo-c-driver lib directory:"
ls -la "${MONGO_C_PREFIX}/lib/"*.dylib 2>/dev/null || log_warn "No dylib files found"
ls -la "${MONGO_C_PREFIX}/lib/"*.a 2>/dev/null || log_warn "No .a files found"
log_info "Looking for bson library:"
find "${MONGO_C_PREFIX}/lib" -name "*bson*" 2>/dev/null || log_warn "No bson library found"

# Create compatibility symlinks for mongo-c-driver 2.x
# DocumentDB's Makefile hardcodes -lbson-1.0 but mongo-c-driver 2.x ships libbson2.dylib
# Create a local lib directory with symlinks to make the linker happy
COMPAT_LIB_DIR="${BUILD_DIR}/compat-lib"
mkdir -p "${COMPAT_LIB_DIR}"
if [[ -f "${MONGO_C_PREFIX}/lib/libbson2.dylib" ]]; then
    log_info "Creating compatibility symlinks for mongo-c-driver 2.x..."
    ln -sf "${MONGO_C_PREFIX}/lib/libbson2.dylib" "${COMPAT_LIB_DIR}/libbson-1.0.dylib"
    ln -sf "${MONGO_C_PREFIX}/lib/libbson2.a" "${COMPAT_LIB_DIR}/libbson-1.0.a" 2>/dev/null || true
    # Add compat lib dir to LDFLAGS (prepend so it's searched first)
    export LDFLAGS="-L${COMPAT_LIB_DIR} ${LDFLAGS}"
    log_success "Created libbson-1.0 -> libbson2 compatibility symlinks"
fi

# Create a clang wrapper to fix macOS rpath syntax in -Wl flags
# PostgreSQL's PGXS generates Linux-style "-Wl,-rpath=/path" but macOS ld needs "-Wl,-rpath,/path"
# The difference is: equals (Linux) vs comma (macOS) to separate -rpath from path
CLANG_WRAPPER="${BUILD_DIR}/clang-wrapper.sh"
cat > "${CLANG_WRAPPER}" <<'WRAPPER_EOF'
#!/bin/bash
# Clang wrapper to translate Linux-style rpath flags to macOS style
# Linux: -Wl,-rpath=/path (single -Wl arg with =)
# macOS: -Wl,-rpath,/path (comma separates -rpath from path)
args=()
for arg in "$@"; do
    if [[ "$arg" == -Wl,-rpath=* ]]; then
        # Convert -Wl,-rpath=/path to -Wl,-rpath,/path
        path="${arg#-Wl,-rpath=}"
        args+=("-Wl,-rpath,${path}")
    else
        args+=("$arg")
    fi
done
exec /usr/bin/clang "${args[@]}"
WRAPPER_EOF
chmod +x "${CLANG_WRAPPER}"
# Convert to absolute path (critical: make runs from documentdb/, relative paths break)
CLANG_WRAPPER="$(cd "$(dirname "${CLANG_WRAPPER}")" && pwd)/$(basename "${CLANG_WRAPPER}")"
log_success "Created clang wrapper for macOS rpath compatibility: ${CLANG_WRAPPER}"

# Build DocumentDB extension
log_info "Building DocumentDB extension v${DOCDB_VERSION} (tag: ${DOCDB_GIT_TAG})..."
cd "${SOURCES_DIR}"
if [[ ! -d "documentdb" ]]; then
    git clone --depth 1 --branch "${DOCDB_GIT_TAG}" https://github.com/FerretDB/documentdb.git
fi
cd documentdb

# DocumentDB uses PostgreSQL PGXS build system (Makefiles, not CMake)
# Build only the non-distributed components (pg_documentdb_core and pg_documentdb)
# Note: PostgreSQL's PGXS passes flags that Apple clang doesn't support:
#   - -fexcess-precision=standard (GCC-specific)
#   - -Wno-cast-function-type-strict (unknown to older clang)
#   - typedef redefinition is a C11 feature (-Wtypedef-redefinition)
# We suppress these errors to allow the build to proceed.
# Note: We use a custom clang wrapper (CC) to fix rpath syntax for macOS
#   PGXS generates -Wl,-rpath=/path but macOS needs -Wl,-rpath,/path
EXTRA_CFLAGS="-Wno-error=ignored-optimization-argument -Wno-error=unknown-warning-option -Wno-error=typedef-redefinition -I${BSON_INCLUDE} -I${BSON_INCLUDE}/bson -I${ICU_PREFIX}/include -I${INTEL_MATH_INSTALL}/include"
make PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" CC="${CLANG_WRAPPER}" -j"$(sysctl -n hw.ncpu)"
make PG_CONFIG="${PG_CONFIG}" install DESTDIR="${BUILD_DIR}/documentdb_install"

# Copy DocumentDB files to bundle
if [[ -d "${BUILD_DIR}/documentdb_install${PG_PREFIX}" ]]; then
    cp -R "${BUILD_DIR}/documentdb_install${PG_PREFIX}/"* "${BUNDLE_DIR}/"
fi

log_success "DocumentDB extension built"

# Build pg_cron
log_info "Building pg_cron v${PG_CRON_VERSION}..."
cd "${SOURCES_DIR}"
if [[ ! -d "pg_cron" ]]; then
    git clone --depth 1 --branch "v${PG_CRON_VERSION}" https://github.com/citusdata/pg_cron.git
fi
cd pg_cron
make PG_CONFIG="${PG_CONFIG}" -j"$(sysctl -n hw.ncpu)"
make PG_CONFIG="${PG_CONFIG}" install DESTDIR="${BUILD_DIR}/pg_cron_install"

# Copy pg_cron files to bundle
if [[ -d "${BUILD_DIR}/pg_cron_install${PG_PREFIX}" ]]; then
    cp -R "${BUILD_DIR}/pg_cron_install${PG_PREFIX}/"* "${BUNDLE_DIR}/"
fi

log_success "pg_cron built"

# Build pgvector
log_info "Building pgvector v${PGVECTOR_VERSION}..."
cd "${SOURCES_DIR}"
if [[ ! -d "pgvector" ]]; then
    git clone --depth 1 --branch "v${PGVECTOR_VERSION}" https://github.com/pgvector/pgvector.git
fi
cd pgvector
make PG_CONFIG="${PG_CONFIG}" -j"$(sysctl -n hw.ncpu)"
make PG_CONFIG="${PG_CONFIG}" install DESTDIR="${BUILD_DIR}/pgvector_install"

# Copy pgvector files to bundle
if [[ -d "${BUILD_DIR}/pgvector_install${PG_PREFIX}" ]]; then
    cp -R "${BUILD_DIR}/pgvector_install${PG_PREFIX}/"* "${BUNDLE_DIR}/"
fi

log_success "pgvector built"

# Build rum
log_info "Building rum v${RUM_VERSION}..."
cd "${SOURCES_DIR}"
if [[ ! -d "rum" ]]; then
    git clone --depth 1 --branch "${RUM_VERSION}" https://github.com/postgrespro/rum.git
fi
cd rum
make USE_PGXS=1 PG_CONFIG="${PG_CONFIG}" -j"$(sysctl -n hw.ncpu)"
make USE_PGXS=1 PG_CONFIG="${PG_CONFIG}" install DESTDIR="${BUILD_DIR}/rum_install"

# Copy rum files to bundle
if [[ -d "${BUILD_DIR}/rum_install${PG_PREFIX}" ]]; then
    cp -R "${BUILD_DIR}/rum_install${PG_PREFIX}/"* "${BUNDLE_DIR}/"
fi

log_success "rum built"

# Install PostGIS via Homebrew (complex dependencies: GEOS, PROJ, GDAL)
log_info "Installing PostGIS via Homebrew..."
brew install postgis || log_warn "PostGIS may already be installed"

# Copy PostGIS extension files
POSTGIS_LIB_DIR="$(brew --prefix postgis)/lib"
POSTGIS_SHARE_DIR="$(brew --prefix postgis)/share/postgresql@${PG_MAJOR}"

if [[ -d "${POSTGIS_LIB_DIR}" ]]; then
    log_info "Copying PostGIS libraries..."
    mkdir -p "${BUNDLE_DIR}/lib"
    cp -R "${POSTGIS_LIB_DIR}/"*.dylib "${BUNDLE_DIR}/lib/" 2>/dev/null || true
fi

if [[ -d "${POSTGIS_SHARE_DIR}/extension" ]]; then
    log_info "Copying PostGIS extension files..."
    mkdir -p "${BUNDLE_DIR}/share/extension"
    cp "${POSTGIS_SHARE_DIR}/extension/"postgis* "${BUNDLE_DIR}/share/extension/" 2>/dev/null || true
fi

log_success "PostGIS installed"

# Copy pre-configured postgresql.conf.sample
CONF_SAMPLE="${SCRIPT_DIR}/postgresql.conf.sample"
if [[ -f "${CONF_SAMPLE}" ]]; then
    cp "${CONF_SAMPLE}" "${BUNDLE_DIR}/share/postgresql.conf.sample"
    log_success "Added pre-configured postgresql.conf.sample"
fi

# Add metadata file
cat > "${BUNDLE_DIR}/.hostdb-metadata.json" <<EOF
{
  "name": "postgresql-documentdb",
  "version": "${VERSION}",
  "platform": "${PLATFORM}",
  "source": "source-build",
  "components": {
    "postgresql": "${PG_MAJOR}",
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
if [[ -d "${BUNDLE_DIR}/lib" ]]; then
    SO_FILES=$(ls "${BUNDLE_DIR}/lib" 2>/dev/null | grep -E '\.(so|dylib)$' | head -10 | tr '\n' ' ')
    log_info "  lib/ (*.so/*.dylib): ${SO_FILES}..."
fi
if [[ -d "${BUNDLE_DIR}/share/extension" ]]; then
    CTRL_FILES=$(ls "${BUNDLE_DIR}/share/extension" 2>/dev/null | grep '\.control$' | tr '\n' ' ')
    log_info "  share/extension/ (*.control): ${CTRL_FILES}"
fi

# Create tarball
OUTPUT_FILE="${OUTPUT_DIR}/postgresql-documentdb-${VERSION}-${PLATFORM}.tar.gz"
mkdir -p "${OUTPUT_DIR}"

log_info "Creating ${OUTPUT_FILE}..."
tar -czf "${OUTPUT_FILE}" -C "${BUILD_DIR}" "postgresql-documentdb"

# Calculate checksum
SHA256=$(shasum -a 256 "${OUTPUT_FILE}" | cut -d' ' -f1)
log_info "SHA256: ${SHA256}"

# Cleanup build directory (keep output)
rm -rf "${BUILD_DIR}"

log_success "Build complete: ${OUTPUT_FILE}"
