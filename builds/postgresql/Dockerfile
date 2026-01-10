# PostgreSQL Build Dockerfile
# Builds PostgreSQL from source for Linux platforms
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg VERSION=17.7 \
#     --output type=local,dest=./dist \
#     -f builds/postgresql/Dockerfile .
#
# Build time: ~15-30 minutes depending on platform and resources

ARG VERSION=17.7

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM ubuntu:22.04 AS builder

ARG VERSION
ARG TARGETARCH

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
# PostgreSQL requires fewer dependencies than MariaDB
RUN apt-get update && apt-get install -y \
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
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download PostgreSQL source
# Source tarballs are at ftp.postgresql.org/pub/source/v{VERSION}/
RUN curl -fsSL "https://ftp.postgresql.org/pub/source/v${VERSION}/postgresql-${VERSION}.tar.gz" \
    -o postgresql.tar.gz \
    && tar -xzf postgresql.tar.gz \
    && rm postgresql.tar.gz \
    && mv postgresql-${VERSION} postgresql-src

WORKDIR /build/postgresql-src

# Configure PostgreSQL build
# - Enable SSL for encrypted connections
# - Enable readline for psql history/editing
# - Enable XML support for XML functions
# - Enable ICU for internationalization
RUN ./configure \
    --prefix=/opt/postgresql \
    --with-openssl \
    --with-readline \
    --with-libxml \
    --with-libxslt \
    --with-icu \
    --without-systemd

# Build PostgreSQL
RUN make -j$(nproc)

# Install to /opt/postgresql
RUN make install

# Build and install contrib modules (pg_stat_statements, etc.)
RUN cd contrib && make -j$(nproc) && make install

# =============================================================================
# Stage 2: Package
# =============================================================================
FROM ubuntu:22.04 AS packager

ARG VERSION
ARG TARGETARCH

# Install minimal runtime dependencies for verification
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    libreadline8 \
    libxml2 \
    libxslt1.1 \
    libicu70 \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Copy built PostgreSQL
COPY --from=builder /opt/postgresql /opt/postgresql

WORKDIR /opt/postgresql

# Map Docker TARGETARCH to hostdb platform naming
RUN PLATFORM="linux-x64"; \
    if [ "$TARGETARCH" = "arm64" ]; then PLATFORM="linux-arm64"; fi; \
    printf '{\n  "name": "postgresql",\n  "version": "%s",\n  "platform": "%s",\n  "source": "source-build",\n  "sourceUrl": "https://ftp.postgresql.org/",\n  "rehosted_by": "hostdb",\n  "rehosted_at": "%s"\n}\n' \
        "${VERSION}" "${PLATFORM}" "$(date -Iseconds)" \
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

# =============================================================================
# Stage 3: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/postgresql /postgresql
