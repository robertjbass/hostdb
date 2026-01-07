# Valkey Build Dockerfile
# Builds Valkey from source for Linux platforms
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg VERSION=9.0.1 \
#     --output type=local,dest=./dist \
#     -f builds/valkey/Dockerfile .
#
# Build time: ~5-15 minutes depending on platform and resources

ARG VERSION=9.0.1

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM ubuntu:22.04 AS builder

ARG VERSION
ARG TARGETARCH

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
# Valkey has minimal dependencies - just needs make, gcc, and libc
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

# Download Valkey source from GitHub releases
# GitHub archive extracts to valkey-{version}/
RUN curl -fsSL "https://github.com/valkey-io/valkey/archive/refs/tags/${VERSION}.tar.gz" \
    -o valkey.tar.gz \
    && tar -xzf valkey.tar.gz \
    && rm valkey.tar.gz \
    && mv valkey-${VERSION} valkey-src

WORKDIR /build/valkey-src

# Build Valkey
# Valkey uses a simple Makefile - no cmake/autoconf needed
# BUILD_TLS=yes enables TLS support
RUN make -j$(nproc) BUILD_TLS=yes

# Install to /opt/valkey
RUN make PREFIX=/opt/valkey install

# Copy additional useful files
RUN cp valkey.conf /opt/valkey/ \
    && cp sentinel.conf /opt/valkey/

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

# Copy built Valkey
COPY --from=builder /opt/valkey /opt/valkey

WORKDIR /opt/valkey

# Map Docker TARGETARCH to hostdb platform naming
RUN PLATFORM="linux-x64"; \
    if [ "$TARGETARCH" = "arm64" ]; then PLATFORM="linux-arm64"; fi; \
    printf '{\n  "name": "valkey",\n  "version": "%s",\n  "platform": "%s",\n  "source": "source-build",\n  "sourceUrl": "https://github.com/valkey-io/valkey/releases",\n  "rehosted_by": "hostdb",\n  "rehosted_at": "%s"\n}\n' \
        "${VERSION}" "${PLATFORM}" "$(date -Iseconds)" \
        > /opt/valkey/.hostdb-metadata.json

# Verify key binaries exist
RUN test -f /opt/valkey/bin/valkey-server \
    && test -f /opt/valkey/bin/valkey-cli \
    && echo "Build verification passed"

# =============================================================================
# Stage 3: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/valkey /valkey
