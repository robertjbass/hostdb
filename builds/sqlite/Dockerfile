# Build SQLite tools from source for Linux ARM64
#
# SQLite doesn't provide official ARM64 binaries, so we build from the amalgamation.
# The amalgamation is a single sqlite3.c file that compiles everything.
#
# Usage:
#   docker build --build-arg VERSION=3.51.2 -t sqlite-builder .
#   docker run --rm -v $(pwd)/dist:/dist sqlite-builder
#
# Output: /dist/sqlite-3.51.2-linux-arm64.tar.gz

ARG UBUNTU_VERSION=22.04
FROM ubuntu:${UBUNTU_VERSION}

ARG VERSION=3.51.2

# Convert version to SQLite's filename format: 3.51.2 -> 3510200
# Formula: MAJOR*1000000 + MINOR*10000 + PATCH*100
# Format: MAJOR + 2-digit MINOR + 2-digit PATCH + "00"
RUN VERSION_NUM=$(echo "${VERSION}" | awk -F. '{printf "%d%02d%02d00", $1, $2, $3}') && \
    echo "VERSION_NUM=${VERSION_NUM}" > /tmp/version_env

ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    ca-certificates \
    libreadline-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download and extract amalgamation
RUN . /tmp/version_env && \
    wget -q "https://sqlite.org/2026/sqlite-autoconf-${VERSION_NUM}.tar.gz" -O sqlite.tar.gz && \
    tar -xzf sqlite.tar.gz && \
    rm sqlite.tar.gz && \
    mv sqlite-autoconf-* sqlite-src

WORKDIR /build/sqlite-src

# Configure and build with recommended options
# See: https://sqlite.org/compile.html
RUN ./configure \
    --prefix=/build/output \
    --disable-static \
    --enable-readline \
    CFLAGS="-O2 -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_JSON1 -DSQLITE_ENABLE_RTREE"

RUN make -j$(nproc)
RUN make install

# Create the final package structure
WORKDIR /build/package
ARG VERSION
ENV VERSION=${VERSION}
RUN mkdir -p sqlite/bin && \
    cp /build/output/bin/sqlite3 sqlite/bin/ && \
    chmod 755 sqlite/bin/sqlite3 && \
    # Add metadata \
    echo "{\n  \"name\": \"sqlite\",\n  \"version\": \"${VERSION}\",\n  \"platform\": \"linux-arm64\",\n  \"source\": \"source-build\",\n  \"tools\": [\"sqlite3\"],\n  \"rehosted_by\": \"hostdb\",\n  \"rehosted_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"\n}" > sqlite/.hostdb-metadata.json

# Create tarball
RUN tar -czf /build/sqlite-${VERSION}-linux-arm64.tar.gz sqlite

# Copy to output on container run
CMD cp /build/sqlite-${VERSION}-linux-arm64.tar.gz /dist/
