#!/bin/bash
#
# Build PostgreSQL + DocumentDB from source for Linux (via Docker)
#
# This script builds PostgreSQL FROM SOURCE inside a Docker container to ensure
# a standard directory layout that makes the binaries fully relocatable.
#
# Usage:
#   ./build-linux.sh <version> <platform> <output_dir>
#   ./build-linux.sh 17-0.107.0 linux-x64 ./dist
#
# Requirements:
#   - Docker
#
# This script builds:
#   - PostgreSQL (from source)
#   - DocumentDB extension
#   - pg_cron
#   - pgvector
#   - rum
#   - PostGIS
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
PLATFORM="${2:-linux-x64}"
OUTPUT_DIR="${3:-./dist}"

# Parse version components
PG_MAJOR="${VERSION%%-*}"        # "17" from "17-0.107.0"
DOCDB_VERSION="${VERSION#*-}"    # "0.107.0" from "17-0.107.0"

# Convert DocumentDB version to git tag format
DOCDB_MAJOR_MINOR="${DOCDB_VERSION%.*}"
DOCDB_PATCH="${DOCDB_VERSION##*.}"
DOCDB_GIT_TAG="v${DOCDB_MAJOR_MINOR}-${DOCDB_PATCH}"

# PostgreSQL source version
case "${PG_MAJOR}" in
    17) PG_SOURCE_VERSION="17.4" ;;
    18) PG_SOURCE_VERSION="18.0" ;;
    *)  PG_SOURCE_VERSION="${PG_MAJOR}.0" ;;
esac

# Component versions
PG_CRON_VERSION="1.6.4"
PGVECTOR_VERSION="0.8.0"
RUM_VERSION="1.3.14"
POSTGIS_VERSION="3.5.1"

log_info "PostgreSQL + DocumentDB Build Script (Linux - Source Build via Docker)"
log_info "Version: ${VERSION}"
log_info "  PostgreSQL: ${PG_MAJOR} (source: ${PG_SOURCE_VERSION})"
log_info "  DocumentDB: ${DOCDB_VERSION}"
log_info "Platform: ${PLATFORM}"
log_info "Output: ${OUTPUT_DIR}"
echo

# Verify Docker is available
if ! command -v docker &> /dev/null; then
    log_error "Docker is required for Linux builds"
    exit 1
fi

# Determine Docker platform
case "${PLATFORM}" in
    linux-x64)   DOCKER_PLATFORM="linux/amd64" ;;
    linux-arm64) DOCKER_PLATFORM="linux/arm64" ;;
    *)
        log_error "Unsupported Linux platform: ${PLATFORM}"
        exit 1
        ;;
esac

# Set up directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$(cd "${OUTPUT_DIR}" 2>/dev/null || mkdir -p "${OUTPUT_DIR}" && cd "${OUTPUT_DIR}" && pwd)"
TEMP_DIR="${OUTPUT_DIR}/temp-linux-build-$$"
mkdir -p "${TEMP_DIR}"

# Clean up temp dir on exit
cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

# Copy the postgresql.conf.sample to temp dir for Docker
if [[ -f "${SCRIPT_DIR}/postgresql.conf.sample" ]]; then
    cp "${SCRIPT_DIR}/postgresql.conf.sample" "${TEMP_DIR}/"
fi

# Create the build script that will run inside Docker
log_info "Creating Docker build script..."
cat > "${TEMP_DIR}/build-inside-docker.sh" <<'DOCKER_SCRIPT'
#!/bin/bash
set -euo pipefail

# Arguments passed from host
PG_SOURCE_VERSION="$1"
PG_MAJOR="$2"
DOCDB_VERSION="$3"
DOCDB_GIT_TAG="$4"
PG_CRON_VERSION="$5"
PGVECTOR_VERSION="$6"
RUM_VERSION="$7"
POSTGIS_VERSION="$8"

echo "[INFO] Building PostgreSQL ${PG_SOURCE_VERSION} from source..."

# Install build dependencies
apt-get update -qq
apt-get install -y -qq \
    build-essential \
    git \
    curl \
    pkg-config \
    libreadline-dev \
    zlib1g-dev \
    libssl-dev \
    libxml2-dev \
    libicu-dev \
    liblz4-dev \
    libzstd-dev \
    libpcre2-dev \
    libbson-dev \
    flex \
    bison \
    patchelf \
    > /dev/null 2>&1

# For PostGIS
apt-get install -y -qq \
    libgeos-dev \
    libproj-dev \
    libgdal-dev \
    libjson-c-dev \
    libprotobuf-c-dev \
    protobuf-c-compiler \
    > /dev/null 2>&1 || true

echo "[OK] Build dependencies installed"

# Set up directories
SOURCES_DIR="/build/sources"
BUNDLE_DIR="/output/postgresql-documentdb"
mkdir -p "${SOURCES_DIR}" "${BUNDLE_DIR}"

# ============================================================================
# Build PostgreSQL from source
# ============================================================================
cd "${SOURCES_DIR}"
echo "[INFO] Downloading PostgreSQL ${PG_SOURCE_VERSION}..."
curl -sL "https://ftp.postgresql.org/pub/source/v${PG_SOURCE_VERSION}/postgresql-${PG_SOURCE_VERSION}.tar.gz" | tar xz
cd "postgresql-${PG_SOURCE_VERSION}"

echo "[INFO] Configuring PostgreSQL..."
./configure \
    --prefix=/usr/local/pgsql \
    --with-openssl \
    --with-libxml \
    --with-icu \
    --with-lz4 \
    --with-zstd \
    --with-readline \
    > /dev/null 2>&1

echo "[INFO] Building PostgreSQL..."
make -j"$(nproc)" > /dev/null 2>&1

echo "[INFO] Installing PostgreSQL..."
make install DESTDIR=/build/pg_install > /dev/null 2>&1

echo "[INFO] Building contrib modules..."
make -C contrib -j"$(nproc)" > /dev/null 2>&1
make -C contrib install DESTDIR=/build/pg_install > /dev/null 2>&1

# Move to bundle
mv /build/pg_install/usr/local/pgsql/* "${BUNDLE_DIR}/"
echo "[OK] PostgreSQL installed"

# Set up pg_config
PG_CONFIG="${BUNDLE_DIR}/bin/pg_config"

# ============================================================================
# Build Intel Decimal Math Library
# ============================================================================
cd "${SOURCES_DIR}"
echo "[INFO] Building Intel Decimal Math Library..."
git clone --depth 1 --branch applied/ubuntu/jammy https://git.launchpad.net/ubuntu/+source/intelrdfpmath > /dev/null 2>&1
cd intelrdfpmath/LIBRARY
make -j"$(nproc)" CC=gcc _CFLAGS_OPT="-fPIC" > /dev/null 2>&1
mkdir -p /build/intelmathlib/{lib,include}
cp libbid.a /build/intelmathlib/lib/
cp src/*.h /build/intelmathlib/include/
echo "[OK] Intel Math Library built"

# Create pkgconfig for Intel math lib
mkdir -p /build/pkgconfig
cat > /build/pkgconfig/intelmathlib.pc <<EOF
prefix=/build/intelmathlib
includedir=\${prefix}/include
libdir=\${prefix}/lib

Name: intelmathlib
Description: Intel Decimal Floating-Point Math Library
Version: 1.0.0
Cflags: -I\${includedir}
Libs: -L\${libdir} -lbid
EOF

export PKG_CONFIG_PATH="/build/pkgconfig:${PKG_CONFIG_PATH:-}"
export CPPFLAGS="-I/build/intelmathlib/include"
export LDFLAGS="-L/build/intelmathlib/lib"

# ============================================================================
# Build DocumentDB extension
# ============================================================================
cd "${SOURCES_DIR}"
echo "[INFO] Building DocumentDB ${DOCDB_VERSION}..."
git clone --depth 1 --branch "${DOCDB_GIT_TAG}" https://github.com/FerretDB/documentdb.git > /dev/null 2>&1
cd documentdb

# Fix type mismatch for strict compilers
find . -name "*.c" -type f -exec sed -i 's/int64_t \*shardKeyValue/int64 *shardKeyValue/g' {} \;

EXTRA_CFLAGS="-Wno-error -I/build/intelmathlib/include"
ICU_LINK="-licuuc -licui18n -licudata"

echo "[INFO]   Building pg_documentdb_core..."
make -C pg_documentdb_core PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" LDFLAGS="${ICU_LINK}" WERROR= -j"$(nproc)" > /dev/null 2>&1
make -C pg_documentdb_core PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" LDFLAGS="${ICU_LINK}" WERROR= install > /dev/null 2>&1

echo "[INFO]   Building pg_documentdb..."
make -C pg_documentdb PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" LDFLAGS="${ICU_LINK}" WERROR= -j"$(nproc)" > /dev/null 2>&1
make -C pg_documentdb PG_CONFIG="${PG_CONFIG}" COPT="${EXTRA_CFLAGS}" LDFLAGS="${ICU_LINK}" WERROR= install > /dev/null 2>&1
echo "[OK] DocumentDB built and installed"

# Patch DocumentDB SQL files: ## in identifiers is invalid PostgreSQL syntax
echo "[INFO] Patching DocumentDB SQL files (fixing ## token concatenation)..."
find "${BUNDLE_DIR}/share/extension" -name "documentdb*.sql" -exec \
    sed -i -e 's/## //g' -e 's/##_/_/g' -e 's/_##/_/g' -e 's/##//g' {} \;
echo "[OK] DocumentDB SQL files patched"

# Patch DocumentDB SQL files: core functions point to wrong library
echo "[INFO] Patching DocumentDB SQL files (fixing core function library references)..."
for sqlfile in "${BUNDLE_DIR}/share/extension/documentdb--0.101-0--0.102-0.sql" \
               "${BUNDLE_DIR}/share/extension/documentdb--0.102-0--0.102-1.sql"; do
    if [[ -f "$sqlfile" ]]; then
        sed -i -E "s/AS 'MODULE_PATHNAME', \\\$function\\\$(bson_in|bson_out|bson_send|bson_recv|bsonquery_equal|bsonquery_lt|bsonquery_lte|bsonquery_gt|bsonquery_gte)\\\$function\\\$/AS '\$libdir\/pg_documentdb_core', \$function\$\1\$function\$/g" "$sqlfile"
    fi
done
echo "[OK] DocumentDB core function references patched"

# ============================================================================
# Build pg_cron
# ============================================================================
cd "${SOURCES_DIR}"
echo "[INFO] Building pg_cron ${PG_CRON_VERSION}..."
git clone --depth 1 --branch "v${PG_CRON_VERSION}" https://github.com/citusdata/pg_cron.git > /dev/null 2>&1
cd pg_cron
make PG_CONFIG="${PG_CONFIG}" -j"$(nproc)" > /dev/null 2>&1
make PG_CONFIG="${PG_CONFIG}" install > /dev/null 2>&1
echo "[OK] pg_cron built and installed"

# ============================================================================
# Build pgvector
# ============================================================================
cd "${SOURCES_DIR}"
echo "[INFO] Building pgvector ${PGVECTOR_VERSION}..."
git clone --depth 1 --branch "v${PGVECTOR_VERSION}" https://github.com/pgvector/pgvector.git > /dev/null 2>&1
cd pgvector
make PG_CONFIG="${PG_CONFIG}" -j"$(nproc)" > /dev/null 2>&1
make PG_CONFIG="${PG_CONFIG}" install > /dev/null 2>&1
echo "[OK] pgvector built and installed"

# ============================================================================
# Build rum
# ============================================================================
cd "${SOURCES_DIR}"
echo "[INFO] Building rum ${RUM_VERSION}..."
git clone --depth 1 --branch "${RUM_VERSION}" https://github.com/postgrespro/rum.git > /dev/null 2>&1
cd rum
make USE_PGXS=1 PG_CONFIG="${PG_CONFIG}" -j"$(nproc)" > /dev/null 2>&1
make USE_PGXS=1 PG_CONFIG="${PG_CONFIG}" install > /dev/null 2>&1
echo "[OK] rum built and installed"

# ============================================================================
# Build PostGIS (if dependencies available)
# ============================================================================
if command -v geos-config &> /dev/null; then
    cd "${SOURCES_DIR}"
    echo "[INFO] Building PostGIS ${POSTGIS_VERSION}..."
    curl -sL "https://download.osgeo.org/postgis/source/postgis-${POSTGIS_VERSION}.tar.gz" | tar xz
    cd "postgis-${POSTGIS_VERSION}"
    ./configure --with-pgconfig="${PG_CONFIG}" > /dev/null 2>&1 || echo "[WARN] PostGIS configure warnings"
    make -j"$(nproc)" > /dev/null 2>&1 || echo "[WARN] PostGIS build had issues"
    make install > /dev/null 2>&1 || echo "[WARN] PostGIS install had issues"
    echo "[OK] PostGIS built and installed"
else
    echo "[WARN] PostGIS dependencies not available, skipping"
fi

# ============================================================================
# Fix RPATH for relocatable binaries
# ============================================================================
echo "[INFO] Fixing RPATH for relocatable binaries..."

# Fix binaries
for f in "${BUNDLE_DIR}/bin/"*; do
    if file "$f" | grep -q "ELF"; then
        patchelf --set-rpath '$ORIGIN/../lib' "$f" 2>/dev/null || true
    fi
done

# Fix shared libraries
find "${BUNDLE_DIR}/lib" -name "*.so*" -type f 2>/dev/null | while read f; do
    if file "$f" | grep -q "ELF"; then
        patchelf --set-rpath '$ORIGIN' "$f" 2>/dev/null || true
    fi
done

echo "[OK] RPATH fixed"

# Copy postgresql.conf.sample if provided
if [[ -f /input/postgresql.conf.sample ]]; then
    cp /input/postgresql.conf.sample "${BUNDLE_DIR}/share/postgresql.conf.sample"
    echo "[OK] Added postgresql.conf.sample"
fi

# List what we built
echo "[INFO] Built files:"
echo "  bin/: $(ls "${BUNDLE_DIR}/bin" | head -10 | tr '\n' ' ')..."
if [[ -d "${BUNDLE_DIR}/lib/postgresql" ]]; then
    SO_FILES=$(ls "${BUNDLE_DIR}/lib/postgresql" 2>/dev/null | grep -E '\.so$' | head -10 | tr '\n' ' ' || true)
    echo "  lib/postgresql/ (*.so): ${SO_FILES}..."
fi
if [[ -d "${BUNDLE_DIR}/share/extension" ]]; then
    CTRL_FILES=$(ls "${BUNDLE_DIR}/share/extension" 2>/dev/null | grep '\.control$' | tr '\n' ' ' || true)
    echo "  extensions (*.control): ${CTRL_FILES}"
    if ls "${BUNDLE_DIR}/share/extension" 2>/dev/null | grep -q 'documentdb'; then
        echo "[OK] DocumentDB extension files present"
    else
        echo "[ERROR] DocumentDB extension files MISSING!"
        exit 1
    fi
fi

echo "[OK] Build complete inside container"
DOCKER_SCRIPT

chmod +x "${TEMP_DIR}/build-inside-docker.sh"

# Run the build inside Docker
log_info "Starting Docker build for ${PLATFORM}..."

CONTAINER_NAME="hostdb-pg-build-$$"
docker run --rm \
    --name "${CONTAINER_NAME}" \
    --platform "${DOCKER_PLATFORM}" \
    -v "${TEMP_DIR}:/input:ro" \
    -v "${OUTPUT_DIR}:/host-output" \
    debian:bookworm \
    /bin/bash -c "
        mkdir -p /build /output
        cp /input/build-inside-docker.sh /build/
        chmod +x /build/build-inside-docker.sh
        /build/build-inside-docker.sh \
            '${PG_SOURCE_VERSION}' \
            '${PG_MAJOR}' \
            '${DOCDB_VERSION}' \
            '${DOCDB_GIT_TAG}' \
            '${PG_CRON_VERSION}' \
            '${PGVECTOR_VERSION}' \
            '${RUM_VERSION}' \
            '${POSTGIS_VERSION}'

        # Add metadata
        cat > /output/postgresql-documentdb/.hostdb-metadata.json <<EOF
{
  \"name\": \"postgresql-documentdb\",
  \"version\": \"${VERSION}\",
  \"platform\": \"${PLATFORM}\",
  \"source\": \"source-build\",
  \"components\": {
    \"postgresql\": \"${PG_SOURCE_VERSION}\",
    \"documentdb\": \"${DOCDB_VERSION}\",
    \"pg_cron\": \"${PG_CRON_VERSION}\",
    \"pgvector\": \"${PGVECTOR_VERSION}\",
    \"rum\": \"${RUM_VERSION}\"
  },
  \"rehosted_by\": \"hostdb\",
  \"rehosted_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}
EOF

        # Create tarball
        tar -czf /host-output/postgresql-documentdb-${VERSION}-${PLATFORM}.tar.gz -C /output postgresql-documentdb
    "

OUTPUT_FILE="${OUTPUT_DIR}/postgresql-documentdb-${VERSION}-${PLATFORM}.tar.gz"

if [[ ! -f "${OUTPUT_FILE}" ]]; then
    log_error "Expected output not found: ${OUTPUT_FILE}"
    exit 1
fi

# Calculate checksum
SHA256=$(shasum -a 256 "${OUTPUT_FILE}" | cut -d' ' -f1)
log_info "SHA256: ${SHA256}"

log_success "Build complete: ${OUTPUT_FILE}"
