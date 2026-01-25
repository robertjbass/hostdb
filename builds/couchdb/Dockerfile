# CouchDB Extraction Dockerfile
# Extracts CouchDB from official Docker image for Linux platforms
#
# The official CouchDB Docker image contains a complete, pre-built installation
# with all dependencies (Erlang, ICU, OpenSSL, etc.) statically linked.
# This Dockerfile extracts that installation for portable use.
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg VERSION=3.5.1 \
#     --output type=local,dest=./downloads \
#     -f builds/couchdb/Dockerfile .
#
# Extraction time: ~1-2 minutes (pulling image + copying files)

ARG VERSION=3.5.1

# =============================================================================
# Stage 1: Extract from official image
# =============================================================================
FROM couchdb:${VERSION} AS source

# Nothing to do here - we just need the base image

# =============================================================================
# Stage 2: Package
# =============================================================================
FROM ubuntu:22.04 AS packager

ARG VERSION
ARG TARGETARCH

# Install minimal tools for packaging
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy CouchDB installation from official image
# CouchDB is installed at /opt/couchdb in the official image
COPY --from=source /opt/couchdb /opt/couchdb

WORKDIR /opt/couchdb

# Map Docker TARGETARCH to hostdb platform naming
RUN PLATFORM="linux-x64"; \
    if [ "$TARGETARCH" = "arm64" ]; then PLATFORM="linux-arm64"; fi; \
    printf '{\n  "name": "couchdb",\n  "version": "%s",\n  "platform": "%s",\n  "source": "docker-extract",\n  "sourceUrl": "https://hub.docker.com/_/couchdb",\n  "dockerImage": "couchdb:%s",\n  "rehosted_by": "hostdb",\n  "rehosted_at": "%s"\n}\n' \
        "${VERSION}" "${PLATFORM}" "${VERSION}" "$(date -Iseconds)" \
        > /opt/couchdb/.hostdb-metadata.json

# Verify key files exist
RUN test -f /opt/couchdb/bin/couchdb \
    && test -d /opt/couchdb/etc \
    && echo "Extraction verification passed"

# List contents for debugging
RUN echo "=== CouchDB bin directory ===" && ls -la /opt/couchdb/bin/ | head -20
RUN echo "=== CouchDB structure ===" && find /opt/couchdb -maxdepth 2 -type d

# =============================================================================
# Stage 3: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/couchdb /couchdb
