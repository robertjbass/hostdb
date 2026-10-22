#!/usr/bin/env bash
# Run inside the Ubuntu 22.04 builder, never directly on a user's machine.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export BUILD_JOBS="${BUILD_JOBS:-2}"
export MAKEFLAGS="-j${BUILD_JOBS}"
export CARGO_BUILD_JOBS="$BUILD_JOBS"
DOCDB_COMMIT=b0cb0dae85e8746f4e0b79c847894179b2f80d64
PG_VERSION=17.11
PREFIX=/output/documentdb
mkdir -p /build "$PREFIX/share/licenses"
apt-get update -qq
apt-get install -y -qq --no-install-recommends build-essential ca-certificates curl git \
  pkg-config libreadline-dev zlib1g-dev libssl-dev libxml2-dev libicu-dev liblz4-dev \
  libzstd-dev libpcre2-dev cmake flex bison patchelf file libgeos-dev libproj-dev \
  libjson-c-dev libprotobuf-c-dev protobuf-c-compiler clang
cd /build
fetch_tar() { curl --fail --location --retry 3 "$1" | tar xz; }
clone_tag() { git clone --depth 1 --branch "$2" "$1" "$3"; }
fetch_tar "https://ftp.postgresql.org/pub/source/v${PG_VERSION}/postgresql-${PG_VERSION}.tar.gz"
cd "postgresql-${PG_VERSION}"
./configure --prefix=/usr/local/pgsql --with-openssl --with-libxml --with-icu --with-lz4 --with-zstd
make
make install DESTDIR=/build/pg-install
make -C contrib
make -C contrib install DESTDIR=/build/pg-install
cp -a /build/pg-install/usr/local/pgsql/. "$PREFIX/"
cp COPYRIGHT "$PREFIX/share/licenses/PostgreSQL"
export PG_CONFIG="$PREFIX/bin/pg_config"
export PATH="$PREFIX/bin:$PATH"
cd /build
clone_tag https://git.launchpad.net/ubuntu/+source/intelrdfpmath applied/2.0u3-1 intelmath
make -C intelmath/LIBRARY _CFLAGS_OPT=-fPIC CC=gcc CALL_BY_REF=0 GLOBAL_RND=0 GLOBAL_FLAGS=0 UNCHANGED_BINARY_FLAGS=0
mkdir -p /build/pkgconfig
cat > /build/pkgconfig/intelmathlib.pc <<'PC'
prefix=/build/intelmath/LIBRARY
libdir=${prefix}
includedir=${prefix}/src
Name: intelmathlib
Description: Intel Decimal Floating Point Math Library
Version: 2.0u3
Cflags: -I${includedir}
Libs: -L${libdir} -lbid
PC
export PKG_CONFIG_PATH=/build/pkgconfig:/build/bson/lib/pkgconfig
fetch_tar https://github.com/mongodb/mongo-c-driver/releases/download/1.28.0/mongo-c-driver-1.28.0.tar.gz
cmake -S mongo-c-driver-1.28.0 -B bson-build -DCMAKE_INSTALL_PREFIX=/build/bson \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS=-fPIC -DENABLE_MONGOC=OFF \
  -DENABLE_STATIC=ON -DENABLE_TESTS=OFF -DENABLE_EXAMPLES=OFF
cmake --build bson-build --parallel "$BUILD_JOBS"
cmake --install bson-build
clone_tag https://github.com/documentdb/documentdb.git v1.0-0 documentdb-source
test "$(git -C documentdb-source rev-parse HEAD)" = "$DOCDB_COMMIT"
for module in pg_documentdb_core pg_documentdb pg_documentdb_extended_rum; do
  make -C "documentdb-source/$module" PG_CONFIG="$PG_CONFIG"
  make -C "documentdb-source/$module" PG_CONFIG="$PG_CONFIG" install
done
clone_tag https://github.com/citusdata/pg_cron.git v1.6.7 pg_cron
make -C pg_cron PG_CONFIG="$PG_CONFIG"
make -C pg_cron PG_CONFIG="$PG_CONFIG" install
clone_tag https://github.com/pgvector/pgvector.git v0.8.1 pgvector
make -C pgvector PG_CONFIG="$PG_CONFIG" OPTFLAGS=
make -C pgvector PG_CONFIG="$PG_CONFIG" install
fetch_tar https://download.osgeo.org/postgis/source/postgis-3.6.0.tar.gz
cd postgis-3.6.0
./configure --with-pgconfig="$PG_CONFIG" --without-raster --without-topology
make
make install
cd /build/documentdb-source
mkdir -p "$PREFIX/share/licenses/documentdb"
cp -a LICENSE NOTICE licenses "$PREFIX/share/licenses/documentdb/"
cp pg_documentdb_gw/NOTICE "$PREFIX/share/licenses/gateway-NOTICE"
mkdir -p "$PREFIX/share/documentdb"
cp documentdb-local/scripts/documentdb_install_getparameter_stub.sh "$PREFIX/share/documentdb/"
# Match the official package's version injection, so the gateway identifies as 1.0.0.
sed -i 's/^version = "0.1.0"$/version = "1.0.0"/' pg_documentdb_gw/Cargo.toml
curl --fail --location --retry 3 https://sh.rustup.rs -o /build/rustup.sh
bash /build/rustup.sh -y --profile minimal --default-toolchain 1.95
export PATH="/root/.cargo/bin:$PATH"
cd pg_documentdb_gw
# Version injection changes local workspace records in Cargo.lock only.
cargo build --release -p documentdb_gateway
cp target/release/documentdb_gateway "$PREFIX/bin/"
/bin/bash /input/bundle-libraries.sh "$PREFIX"
cat > "$PREFIX/.hostdb-metadata.json" <<META
{"name":"documentdb","version":"1.0.0","platform":"${TARGET_PLATFORM}","source":"source-build","sourceCommit":"${DOCDB_COMMIT}","components":{"postgresql":"${PG_VERSION}","documentdb":"1.0.0","gateway":"1.0.0","pg_cron":"1.6.7","pgvector":"0.8.1","postgis":"3.6.0"}}
META
