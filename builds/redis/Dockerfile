# Redis Build Dockerfile
# Builds Redis from source for Linux platforms
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg VERSION=8.4.0 \
#     --output type=local,dest=./dist \
#     -f builds/redis/Dockerfile .
#
# Build time: ~5-15 minutes depending on platform and resources

ARG VERSION=8.4.0

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM ubuntu:22.04 AS builder

ARG VERSION
ARG TARGETARCH

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
# Redis has minimal dependencies - just needs make, gcc, and libc
# Retry apt-get update to handle transient mirror sync issues
RUN for i in 1 2 3; do \
        apt-get update && break || \
        { [ $i -eq 3 ] && { echo "apt-get update failed after 3 attempts"; exit 1; }; \
          echo "apt-get update failed (attempt $i), retrying..."; sleep 5; }; \
    done && apt-get install -y \
    build-essential \
    curl \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download Redis source
RUN curl -fsSL "https://download.redis.io/releases/redis-${VERSION}.tar.gz" \
    -o redis.tar.gz \
    && tar -xzf redis.tar.gz \
    && rm redis.tar.gz \
    && mv redis-${VERSION} redis-src

WORKDIR /build/redis-src

# Build Redis
# Redis uses a simple Makefile - no cmake/autoconf needed
# BUILD_TLS=yes enables TLS support
RUN make -j$(nproc) BUILD_TLS=yes

# Install to /opt/redis
RUN make PREFIX=/opt/redis install

# Copy additional useful files
RUN cp redis.conf /opt/redis/ \
    && cp sentinel.conf /opt/redis/

# =============================================================================
# Stage 2: Package
# =============================================================================
FROM ubuntu:22.04 AS packager

ARG VERSION
ARG TARGETARCH

# Install runtime dependencies for verification
# Retry apt-get update to handle transient mirror sync issues
RUN for i in 1 2 3; do \
        apt-get update && break || \
        { [ $i -eq 3 ] && { echo "apt-get update failed after 3 attempts"; exit 1; }; \
          echo "apt-get update failed (attempt $i), retrying..."; sleep 5; }; \
    done && apt-get install -y --no-install-recommends \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy built Redis
COPY --from=builder /opt/redis /opt/redis

WORKDIR /opt/redis

# Map Docker TARGETARCH to hostdb platform naming
RUN PLATFORM="linux-x64"; \
    if [ "$TARGETARCH" = "arm64" ]; then PLATFORM="linux-arm64"; fi; \
    printf '{\n  "name": "redis",\n  "version": "%s",\n  "platform": "%s",\n  "source": "source-build",\n  "sourceUrl": "https://download.redis.io/releases/",\n  "rehosted_by": "hostdb",\n  "rehosted_at": "%s"\n}\n' \
        "${VERSION}" "${PLATFORM}" "$(date -Iseconds)" \
        > /opt/redis/.hostdb-metadata.json

# Verify key binaries exist
RUN test -f /opt/redis/bin/redis-server \
    && test -f /opt/redis/bin/redis-cli \
    && echo "Build verification passed"

# =============================================================================
# Stage 3: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/redis /redis
