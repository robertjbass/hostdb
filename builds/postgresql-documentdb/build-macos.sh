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
brew install cmake pkg-config || true

# Build DocumentDB extension
log_info "Building DocumentDB extension v${DOCDB_VERSION} (tag: ${DOCDB_GIT_TAG})..."
cd "${SOURCES_DIR}"
if [[ ! -d "documentdb" ]]; then
    git clone --depth 1 --branch "${DOCDB_GIT_TAG}" https://github.com/FerretDB/documentdb.git
fi
cd documentdb

# DocumentDB uses CMake
mkdir -p build && cd build
cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DPostgreSQL_CONFIG="${PG_CONFIG}" \
    -DCMAKE_INSTALL_PREFIX="${BUNDLE_DIR}"
make -j"$(sysctl -n hw.ncpu)"
make install

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
