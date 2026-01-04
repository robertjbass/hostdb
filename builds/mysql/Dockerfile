# MySQL Build Dockerfile
# Builds MySQL from source for Linux platforms
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg VERSION=8.4.3 \
#     --output type=local,dest=./dist \
#     -f builds/mysql/Dockerfile .

ARG VERSION=8.4.3
ARG BOOST_VERSION=1_77_0

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM ubuntu:22.04 AS builder

ARG VERSION
ARG BOOST_VERSION

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    curl \
    git \
    bison \
    libssl-dev \
    libncurses-dev \
    libudev-dev \
    libldap2-dev \
    libsasl2-dev \
    libcurl4-openssl-dev \
    pkg-config \
    perl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download MySQL source
RUN curl -fsSL "https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-${VERSION}.tar.gz" \
    -o mysql.tar.gz \
    && tar -xzf mysql.tar.gz \
    && rm mysql.tar.gz \
    && mv mysql-${VERSION} mysql-src

# Download Boost (required for MySQL build)
# MySQL 8.4 includes boost in the source, but we may need to download separately
# Check if boost is bundled, otherwise download
RUN if [ ! -d /build/mysql-src/boost ]; then \
      curl -fsSL "https://archives.boost.io/release/1.77.0/source/boost_${BOOST_VERSION}.tar.gz" \
        -o boost.tar.gz \
      && tar -xzf boost.tar.gz \
      && rm boost.tar.gz \
      && mkdir -p /build/boost \
      && mv boost_${BOOST_VERSION} /build/boost/boost_${BOOST_VERSION}; \
    fi

WORKDIR /build/mysql-src

# Configure MySQL build
# - STANDALONE layout for relocatable binaries
# - Release build for optimized binaries
# - Disable features not needed for embedded use
RUN cmake . \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/opt/mysql \
    -DINSTALL_LAYOUT=STANDALONE \
    -DWITH_BOOST=/build/boost \
    -DDOWNLOAD_BOOST=1 \
    -DWITH_SSL=system \
    -DWITH_ZLIB=bundled \
    -DWITH_EDITLINE=bundled \
    -DWITH_LIBEVENT=bundled \
    -DWITH_LZ4=bundled \
    -DWITH_ZSTD=bundled \
    -DWITH_PROTOBUF=bundled \
    -DWITH_ICU=bundled \
    -DWITH_RAPIDJSON=bundled \
    -DWITH_FIDO=bundled \
    -DWITH_UNIT_TESTS=OFF \
    -DCOMPILATION_COMMENT="hostdb build" \
    -DCOMPILATION_COMMENT_SERVER="Built by hostdb for spindb"

# Build MySQL (this takes a while - 30-60+ minutes)
RUN make -j$(nproc)

# Install to /opt/mysql
RUN make install

# =============================================================================
# Stage 2: Package
# =============================================================================
FROM ubuntu:22.04 AS packager

ARG VERSION

# Copy built MySQL
COPY --from=builder /opt/mysql /opt/mysql

WORKDIR /opt/mysql

# Create metadata file
RUN echo "{\n\
  \"name\": \"mysql\",\n\
  \"version\": \"${VERSION}\",\n\
  \"platform\": \"linux-x64\",\n\
  \"built_by\": \"hostdb\",\n\
  \"built_at\": \"$(date -Iseconds)\"\n\
}" > /opt/mysql/.hostdb-metadata.json

# Verify key binaries exist
RUN test -f /opt/mysql/bin/mysqld \
    && test -f /opt/mysql/bin/mysql \
    && test -f /opt/mysql/bin/mysqldump \
    && echo "Build verification passed"

# =============================================================================
# Stage 3: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/mysql /mysql
