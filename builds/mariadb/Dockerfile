# MariaDB Build Dockerfile
# Builds MariaDB from source for Linux platforms
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg VERSION=11.4.5 \
#     --output type=local,dest=./dist \
#     -f builds/mariadb/Dockerfile .
#
# Build time: ~45-90 minutes depending on platform and resources

ARG VERSION=11.4.5

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM ubuntu:22.04 AS builder

ARG VERSION
ARG TARGETARCH

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
# MariaDB requires more dependencies than MySQL for full feature support
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    curl \
    git \
    bison \
    libssl-dev \
    libncurses-dev \
    libudev-dev \
    libsystemd-dev \
    libpam0g-dev \
    libxml2-dev \
    libevent-dev \
    libcurl4-openssl-dev \
    libpcre2-dev \
    liblz4-dev \
    liblzma-dev \
    libzstd-dev \
    libsnappy-dev \
    libjemalloc-dev \
    libfmt-dev \
    zlib1g-dev \
    gnutls-dev \
    pkg-config \
    perl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download MariaDB source
# Source tarballs are at archive.mariadb.org/mariadb-VERSION/source/
RUN curl -fsSL "https://archive.mariadb.org/mariadb-${VERSION}/source/mariadb-${VERSION}.tar.gz" \
    -o mariadb.tar.gz \
    && tar -xzf mariadb.tar.gz \
    && rm mariadb.tar.gz \
    && mv mariadb-${VERSION} mariadb-src

WORKDIR /build/mariadb-src

# Configure MariaDB build
# - Release build for optimized binaries
# - STANDALONE layout for relocatable installation
# - Bundle most dependencies for portability
# - Disable features not needed for embedded/dev use
# - CMAKE_POLICY_VERSION_MINIMUM fixes compatibility with older wsrep-lib CMakeLists.txt
#   that specify cmake_minimum_required < 3.5 (CMake 4.0+ removed support for < 3.5)
RUN cmake . \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/opt/mariadb \
    -DINSTALL_LAYOUT=STANDALONE \
    -DWITH_SSL=system \
    -DWITH_ZLIB=system \
    -DWITH_PCRE=system \
    -DWITH_JEMALLOC=system \
    -DWITH_SYSTEMD=no \
    -DWITH_UNIT_TESTS=OFF \
    -DPLUGIN_TOKUDB=NO \
    -DPLUGIN_ROCKSDB=NO \
    -DPLUGIN_MROONGA=NO \
    -DPLUGIN_SPIDER=NO \
    -DPLUGIN_SPHINX=NO \
    -DPLUGIN_CONNECT=NO \
    -DPLUGIN_OQGRAPH=NO \
    -DPLUGIN_CASSANDRA=NO \
    -DPLUGIN_S3=NO \
    -DCOMPILATION_COMMENT="hostdb build" \
    -DCOMPILATION_COMMENT_SERVER="Built by hostdb for spindb"

# Build MariaDB (this takes a while - 45-90+ minutes)
RUN make -j$(nproc)

# Install to /opt/mariadb
RUN make install

# =============================================================================
# Stage 2: Package
# =============================================================================
FROM ubuntu:22.04 AS packager

ARG VERSION
ARG TARGETARCH

# Install runtime dependencies needed for verification
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    libncurses6 \
    libjemalloc2 \
    && rm -rf /var/lib/apt/lists/*

# Copy built MariaDB
COPY --from=builder /opt/mariadb /opt/mariadb

WORKDIR /opt/mariadb

# Map Docker TARGETARCH to hostdb platform naming
# TARGETARCH is set by docker buildx: amd64, arm64, etc.
RUN PLATFORM="linux-x64"; \
    if [ "$TARGETARCH" = "arm64" ]; then PLATFORM="linux-arm64"; fi; \
    printf '{\n  "name": "mariadb",\n  "version": "%s",\n  "platform": "%s",\n  "source": "source-build",\n  "sourceUrl": "https://archive.mariadb.org/",\n  "rehosted_by": "hostdb",\n  "rehosted_at": "%s"\n}\n' \
        "${VERSION}" "${PLATFORM}" "$(date -Iseconds)" \
        > /opt/mariadb/.hostdb-metadata.json

# Verify key binaries exist
RUN test -f /opt/mariadb/bin/mariadbd \
    && test -f /opt/mariadb/bin/mariadb \
    && test -f /opt/mariadb/bin/mariadb-dump \
    && echo "Build verification passed"

# =============================================================================
# Stage 3: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/mariadb /mariadb
