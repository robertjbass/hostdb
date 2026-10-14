# PostgreSQL Build Dockerfile
# Builds PostgreSQL from source for Linux platforms
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg SOURCE_VERSION=17.7 \
#     --build-arg FULL_VERSION=17.7.0 \
#     --output type=local,dest=./downloads \
#     -f builds/postgresql/Dockerfile .
#
# Build time: ~15-30 minutes depending on platform and resources

# SOURCE_VERSION is 2-part (e.g., 18.1) for downloading PostgreSQL source
# FULL_VERSION is 3-part (e.g., 18.1.0) for artifact naming and metadata
ARG SOURCE_VERSION=17.7
ARG FULL_VERSION=17.7.0

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM ubuntu:22.04 AS builder

ARG SOURCE_VERSION
ARG FULL_VERSION
ARG TARGETARCH

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
# PostgreSQL requires fewer dependencies than MariaDB
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    flex \
    bison \
    libreadline-dev \
    libssl-dev \
    zlib1g-dev \
    libxml2-dev \
    libxslt1-dev \
    libicu-dev \
    uuid-dev \
    pkg-config \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download PostgreSQL source
# Source tarballs use 2-part versions at ftp.postgresql.org/pub/source/v{SOURCE_VERSION}/
RUN curl -fsSL "https://ftp.postgresql.org/pub/source/v${SOURCE_VERSION}/postgresql-${SOURCE_VERSION}.tar.gz" \
    -o postgresql.tar.gz \
    && tar -xzf postgresql.tar.gz \
    && rm postgresql.tar.gz \
    && mv postgresql-${SOURCE_VERSION} postgresql-src

WORKDIR /build/postgresql-src

# Configure PostgreSQL build
# - Enable SSL for encrypted connections
# - Enable readline for psql history/editing
# - Enable XML support for XML functions
# - Enable ICU for internationalization
# - Enable UUID (e2fs/libuuid) so contrib builds the uuid-ossp extension
# - Use $ORIGIN-relative RPATH for relocatable binaries (not hardcoded /opt/postgresql/lib)
RUN ./configure \
    --prefix=/opt/postgresql \
    --with-openssl \
    --with-readline \
    --with-libxml \
    --with-libxslt \
    --with-icu \
    --with-uuid=e2fs \
    --without-systemd \
    LDFLAGS="-Wl,-rpath,'\$\$ORIGIN/../lib'"

# Build PostgreSQL
RUN make -j$(nproc)

# Install to /opt/postgresql
RUN make install

# Build and install contrib modules (pg_stat_statements, etc.)
RUN cd contrib && make -j$(nproc) && make install

# Managed new-database versions on Linux x64. Other platforms need qualification.
RUN if [ "$TARGETARCH" = "amd64" ] && { [ "$FULL_VERSION" = "18.6.0" ] || [ "$FULL_VERSION" = "19.0.0-beta.3" ]; }; then \
      curl -fsSL https://codeload.github.com/citusdata/pg_cron/tar.gz/refs/tags/v1.6.8 \
        -o /build/pg-cron.tar.gz \
      && echo 'c19ab9bb35406c60fb51ecda993737c083850abe424acb6c1030439d00a1f8e4  /build/pg-cron.tar.gz' | sha256sum -c - \
      && tar -xzf /build/pg-cron.tar.gz -C /build \
      && make -C /build/pg_cron-1.6.8 -j2 PG_CONFIG=/opt/postgresql/bin/pg_config \
      && make -C /build/pg_cron-1.6.8 install PG_CONFIG=/opt/postgresql/bin/pg_config; \
    fi

# =============================================================================
# Stage 2: Package
# =============================================================================
FROM ubuntu:22.04 AS packager

ARG FULL_VERSION
ARG TARGETARCH

# Install minimal runtime dependencies for verification + patchelf for RPATH fixing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    libreadline8 \
    libxml2 \
    libxslt1.1 \
    libicu70 \
    zlib1g \
    libuuid1 \
    patchelf \
    file \
    && rm -rf /var/lib/apt/lists/*

# Copy built PostgreSQL
COPY --from=builder /opt/postgresql /opt/postgresql

WORKDIR /opt/postgresql

# Fix RPATH on all ELF binaries to use $ORIGIN-relative paths
# This ensures binaries find their bundled libraries regardless of install location
RUN find /opt/postgresql/bin -type f -executable | while read bin; do \
        if file "$bin" | grep -q "ELF"; then \
            patchelf --set-rpath '$ORIGIN/../lib' "$bin" 2>/dev/null || true; \
        fi; \
    done && \
    find /opt/postgresql/lib -name "*.so*" -type f | while read lib; do \
        if file "$lib" | grep -q "ELF"; then \
            patchelf --set-rpath '$ORIGIN' "$lib" 2>/dev/null || true; \
        fi; \
    done

# Map Docker TARGETARCH to hostdb platform naming
# Use FULL_VERSION (3-part) for metadata
RUN PLATFORM="linux-x64"; \
    if [ "$TARGETARCH" = "arm64" ]; then PLATFORM="linux-arm64"; fi; \
    printf '{\n  "name": "postgresql",\n  "version": "%s",\n  "platform": "%s",\n  "source": "source-build",\n  "sourceUrl": "https://ftp.postgresql.org/",\n  "rehosted_by": "hostdb",\n  "rehosted_at": "%s"\n}\n' \
        "${FULL_VERSION}" "${PLATFORM}" "$(date -Iseconds)" \
        > /opt/postgresql/.hostdb-metadata.json

# Verify key binaries exist
RUN test -f /opt/postgresql/bin/postgres \
    && test -f /opt/postgresql/bin/psql \
    && test -f /opt/postgresql/bin/pg_dump \
    && test -f /opt/postgresql/bin/initdb \
    && echo "Build verification passed"

# Verify contrib modules are installed
RUN test -f /opt/postgresql/lib/pg_stat_statements.so \
    && echo "Contrib modules verification passed"

# Verify uuid-ossp is present (requires --with-uuid=e2fs at configure time)
# Without this the extension silently goes missing and CREATE EXTENSION "uuid-ossp" fails
RUN test -f /opt/postgresql/lib/uuid-ossp.so \
    && test -f /opt/postgresql/share/extension/uuid-ossp.control \
    && echo "uuid-ossp verification passed"

# Verify the Linux x64 scheduler files before exporting the artifact.
RUN if [ "$TARGETARCH" = "amd64" ] && { [ "$FULL_VERSION" = "18.6.0" ] || [ "$FULL_VERSION" = "19.0.0-beta.3" ]; }; then \
      test -s /opt/postgresql/lib/pg_cron.so \
      && test -s /opt/postgresql/share/extension/pg_cron.control \
      && test -s /opt/postgresql/share/extension/pg_cron--1.0.sql \
      && test -s /opt/postgresql/share/extension/pg_cron--1.5--1.6.sql; \
    fi

# =============================================================================
# Stage 3: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/postgresql /postgresql
