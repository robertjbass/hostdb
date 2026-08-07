# CouchDB Extraction Dockerfile
# Packages CouchDB for Linux from the official Apache CouchDB apt repository.
#
# WHY NOT THE OFFICIAL DOCKER IMAGE (the 3.5.2 regression):
#   Until 3.5.1 this file copied /opt/couchdb out of `couchdb:<version>`. That
#   image tracks Debian stable, and the 3.5.2 image moved from Debian 12
#   (bookworm, glibc 2.36 / OpenSSL 3.0) to Debian 13 (trixie, glibc 2.41 /
#   OpenSSL 3.5). The bundled Erlang runtime is linked against the image's
#   system libraries, which we do NOT copy, so the extracted tree stopped
#   running on our supported Linux baselines:
#     - Ubuntu 22.04 (glibc 2.35): beam.smp needs GLIBC_2.38, exec fails
#     - Ubuntu 24.04 (OpenSSL 3.0): crypto.so needs OPENSSL_3.4.0, the crypto
#       NIF fails to load and CouchDB dies with `{undef,{crypto,info_fips,[]}}`
#
#   Apache publishes per-distro CouchDB packages, so we build against `jammy`
#   (Ubuntu 22.04) - exactly our oldest supported target - which yields a tree
#   that runs on 22.04 and every newer glibc/OpenSSL 3.0 distro.
#
# The .deb is unpacked with `dpkg-deb -x` (no postinst): the maintainer scripts
# inject a debconf admin password, a node name and an Erlang cookie into the
# config, which must never ship inside a redistributable tarball.
#
# Usage:
#   docker buildx build --platform linux/amd64 \
#     --build-arg VERSION=3.5.2 \
#     --output type=local,dest=./downloads \
#     -f builds/couchdb/Dockerfile .
#
# Extraction time: ~2-3 minutes (package download + unpack)

ARG VERSION=3.5.2

# =============================================================================
# Stage 1: Fetch + unpack the Apache CouchDB package
# =============================================================================
FROM ubuntu:22.04 AS packager

ARG VERSION
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Official Apache CouchDB apt repository (jammy = Ubuntu 22.04 baseline)
RUN curl -fsSL https://couchdb.apache.org/repo/keys.asc \
      | gpg --dearmor -o /usr/share/keyrings/couchdb-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/couchdb-archive-keyring.gpg] https://apache.jfrog.io/artifactory/couchdb-deb jammy main" \
      > /etc/apt/sources.list.d/couchdb.list

# Download and unpack WITHOUT running maintainer scripts
RUN apt-get update \
    && mkdir -p /tmp/deb /tmp/unpacked \
    && cd /tmp/deb \
    && apt-get download "couchdb=${VERSION}~jammy" \
    && dpkg-deb -x /tmp/deb/couchdb_*.deb /tmp/unpacked \
    && rm -rf /tmp/deb /var/lib/apt/lists/* \
    && mv /tmp/unpacked/opt/couchdb /opt/couchdb

WORKDIR /opt/couchdb

# Normalize the tree to the portable layout hostdb has always shipped:
#  - replace the FHS symlinks (data -> /var/lib/couchdb, var/log ->
#    /var/log/couchdb) with real in-tree directories. `database_dir` defaults to
#    ./data, so a dangling symlink makes mem3 fail to create `_nodes` and the
#    node dies with `{case_clause,{not_found,no_db_file}}`
#  - drop the package default that pins logging to /var/log/couchdb (absent in a
#    relocatable install); spindb supplies its own [log] settings
#  - restore the permissive default bind address the previous tarballs carried
#  - drop the packaged `-name` so the node name comes from the caller's vm.args
RUN rm -f /opt/couchdb/data /opt/couchdb/var/log \
    && mkdir -p /opt/couchdb/data /opt/couchdb/var/log \
    && rm -f /opt/couchdb/etc/default.d/10-filelog.ini \
    && printf '; CouchDB Configuration Settings\n\n; Custom settings should be made in this file. They will override settings\n; in default.ini, but unlike changes made to default.ini, this file won'"'"'t be\n; overwritten on server upgrade.\n\n[chttpd]\nbind_address = any\n' \
      > /opt/couchdb/etc/default.d/10-docker-default.ini \
    && sed -i '/^-name /d' /opt/couchdb/etc/vm.args \
    && chmod 644 /opt/couchdb/etc/vm.args \
    && chown -R root:root /opt/couchdb

# Map Docker TARGETARCH to hostdb platform naming
RUN PLATFORM="linux-x64"; \
    if [ "$TARGETARCH" = "arm64" ]; then PLATFORM="linux-arm64"; fi; \
    printf '{\n  "name": "couchdb",\n  "version": "%s",\n  "platform": "%s",\n  "source": "docker-extract",\n  "sourceUrl": "https://couchdb.apache.org/repo",\n  "debPackage": "couchdb=%s~jammy",\n  "rehosted_by": "hostdb",\n  "rehosted_at": "%s"\n}\n' \
        "${VERSION}" "${PLATFORM}" "${VERSION}" "$(date -Iseconds)" \
        > /opt/couchdb/.hostdb-metadata.json

# Verify key files exist
RUN test -f /opt/couchdb/bin/couchdb \
    && test -d /opt/couchdb/etc \
    && test -f /opt/couchdb/etc/vm.args \
    && test -d /opt/couchdb/data && test ! -L /opt/couchdb/data \
    && test -d /opt/couchdb/var/log && test ! -L /opt/couchdb/var/log \
    && ls -d /opt/couchdb/erts-* > /dev/null \
    && echo "Extraction verification passed"

# List contents for debugging
RUN echo "=== CouchDB bin directory ===" && ls -la /opt/couchdb/bin/ | head -20
RUN echo "=== CouchDB structure ===" && find /opt/couchdb -maxdepth 2 -type d

# =============================================================================
# Stage 2: Export (scratch image for minimal output)
# =============================================================================
FROM scratch AS export

COPY --from=packager /opt/couchdb /couchdb
