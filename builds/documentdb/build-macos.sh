#!/usr/bin/env bash
# Native macOS qualification recipe. Never publishes or replaces release assets.
set -euo pipefail
[[ $(uname -s) = Darwin ]] || { echo 'Requires native macOS' >&2; exit 1; }
case $(uname -m) in
  arm64) architecture=arm64 ;;
  x86_64) architecture=x64 ;;
  *) echo 'Unsupported Mac architecture' >&2; exit 1 ;;
esac
output=${1:?output directory required}
mkdir -p "$output"
output=$(cd "$output" && pwd)
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
build=$(mktemp -d "$output/.documentdb-darwin.XXXXXX")
prefix="$build/documentdb"
mkdir -p "$prefix/share/licenses"
export BUILD_JOBS=${BUILD_JOBS:-3}
export MAKEFLAGS="-j$BUILD_JOBS"
export CARGO_BUILD_JOBS=$BUILD_JOBS
export MACOSX_DEPLOYMENT_TARGET=14.0
export SDKROOT=$(xcrun --show-sdk-path)
export HOMEBREW_NO_AUTO_UPDATE=1
brew install openssl@3 readline libxml2 icu4c zlib lz4 zstd pkg-config cmake pcre2 geos proj json-c protobuf-c flex bison bash
export PATH="$(brew --prefix bison)/bin:$(brew --prefix flex)/bin:$PATH"
export CPPFLAGS='' LDFLAGS='-Wl,-headerpad_max_install_names' PKG_CONFIG_PATH=''
for dependency in openssl@3 readline libxml2 icu4c zlib lz4 zstd pcre2 geos proj json-c protobuf-c; do
  dependency_prefix=$(brew --prefix "$dependency")
  CPPFLAGS="$CPPFLAGS -I$dependency_prefix/include"
  LDFLAGS="$LDFLAGS -L$dependency_prefix/lib"
  PKG_CONFIG_PATH="$dependency_prefix/lib/pkgconfig:$PKG_CONFIG_PATH"
done
cd "$build"
fetch_tar() { curl --fail --location --retry 3 "$1" | tar xz; }
fetch_tar https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.gz
cd postgresql-17.11
./configure --prefix=/usr/local/pgsql --with-openssl --with-libxml --with-icu --with-lz4 --with-zstd --disable-nls
make
make install DESTDIR="$build/pg-install"
make -C contrib
make -C contrib install DESTDIR="$build/pg-install"
cp -a "$build/pg-install/usr/local/pgsql/." "$prefix/"
cp COPYRIGHT "$prefix/share/licenses/PostgreSQL"
export PG_CONFIG="$prefix/bin/pg_config"
export PATH="$prefix/bin:$PATH"
cd "$build"
# Same Debian-patched 2.0u3-1 source as Launchpad's applied branch, without
# the Git endpoint's hour-long 504 stalls. SHA-256 pins come from its .dsc.
intel_source=https://archive.ubuntu.com/ubuntu/pool/universe/i/intelrdfpmath
curl --fail --location --retry 3 --connect-timeout 20 --max-time 180 "$intel_source/intelrdfpmath_2.0u3.orig.tar.gz" -o intelmath.tar.gz
curl --fail --location --retry 3 --connect-timeout 20 --max-time 180 "$intel_source/intelrdfpmath_2.0u3-1.debian.tar.xz" -o intelmath-debian.tar.xz
printf '%s\n' '13f6924b2ed71df9b137a7df98706a0dcc3b43c283a0e32f8b6eadca4305136a  intelmath.tar.gz' '289a777dd489ffd933a813c1053677f06ffeea2418d862c11e20b638e07ae9c3  intelmath-debian.tar.xz' | shasum -a 256 -c -
mkdir intelmath
tar -xzf intelmath.tar.gz -C intelmath
tar -xJf intelmath-debian.tar.xz -C intelmath
while IFS= read -r source_patch; do
  [[ -z "$source_patch" || "$source_patch" = \#* ]] && continue
  patch -d intelmath -p1 < "intelmath/debian/patches/$source_patch"
done < intelmath/debian/patches/series
make -C intelmath/LIBRARY CC=cc _CFLAGS_OPT='-fPIC -Wno-error=implicit-function-declaration' CALL_BY_REF=0 GLOBAL_RND=0 GLOBAL_FLAGS=0 UNCHANGED_BINARY_FLAGS=0
mkdir pkgconfig
cat > pkgconfig/intelmathlib.pc <<PC
prefix=$build/intelmath/LIBRARY
libdir=\${prefix}
includedir=\${prefix}/src
Name: intelmathlib
Description: Intel Decimal Floating Point Math Library
Version: 2.0u3
Cflags: -I\${includedir}
Libs: -L\${libdir} -lbid
PC
export PKG_CONFIG_PATH="$build/pkgconfig:$build/bson/lib/pkgconfig:$PKG_CONFIG_PATH"
fetch_tar https://github.com/mongodb/mongo-c-driver/releases/download/1.28.0/mongo-c-driver-1.28.0.tar.gz
# CMake 4 removed CMP0042 OLD; use modern install-name behavior for libbson.
python3 - <<'PATCH'
from pathlib import Path
p = Path('mongo-c-driver-1.28.0/src/libbson/CMakeLists.txt')
s = p.read_text()
assert 'SET CMP0042 OLD' in s
p.write_text(s.replace('SET CMP0042 OLD', 'SET CMP0042 NEW'))
PATCH
cmake -S mongo-c-driver-1.28.0 -B bson-build -DCMAKE_INSTALL_PREFIX="$build/bson" -DCMAKE_BUILD_TYPE=Release -DENABLE_MONGOC=OFF -DENABLE_STATIC=ON -DENABLE_TESTS=OFF -DENABLE_EXAMPLES=OFF
cmake --build bson-build --parallel "$BUILD_JOBS"
cmake --install bson-build
git clone --depth 1 --branch v1.0-0 https://github.com/documentdb/documentdb.git documentdb-source
test "$(git -C documentdb-source rev-parse HEAD)" = b0cb0dae85e8746f4e0b79c847894179b2f80d64
export DOCDB_SOURCE="$build/documentdb-source"
# Adapt the upstream ELF linker spelling and extension suffix to Darwin.
# Darwin bundles resolve core symbols from PostgreSQL preload order, as in
# the existing postgresql-documentdb Mac recipe. Native smoke tests verify loading.
python3 - "$DOCDB_SOURCE" "$(brew --prefix bash)/bin/bash" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
for p in root.rglob('Makefile*'):
    if p.is_file():
        s=p.read_text(); p.write_text(s.replace('.so', '.dylib'))
for p in root.rglob('*.sh'):
    s=p.read_text(); p.write_text(s.replace('#!/bin/bash', '#!'+sys.argv[2], 1))
# Match the existing header's PostgreSQL int64 typedef on Darwin.
p=root/'pg_documentdb/src/commands/commands_common.c'
s=p.read_text()
assert s.count('int64_t *shardKeyValue') == 1
p.write_text(s.replace('int64_t *shardKeyValue', 'int64 *shardKeyValue'))
p=root/'pg_documentdb_gw/Cargo.toml';p.write_text(p.read_text().replace('version = "0.1.0"','version = "1.0.0"'))
p=root/'pg_documentdb_gw/Cargo.lock';s=p.read_text()
import re
s=re.sub(r'(name = "documentdb_[^"]+"\nversion = )"0.1.0"',r'\1"1.0.0"',s);p.write_text(s)
PY
cat > "$build/clang-adapter" <<'ADAPTER'
#!/usr/bin/env bash
set -euo pipefail
args=()
for arg in "$@"; do
  case "$arg" in
    -Wl,-rpath=*) args+=("-Wl,-rpath,${arg#-Wl,-rpath=}") ;;
    -fexcess-precision=*) ;;
    -Werror) args+=(-Wno-error) ;;
    -l:*)
      library=$(find "$DOCDB_SOURCE" -name "${arg#-l:}" -type f | head -1)
      [[ -n "$library" ]] || { echo "Missing built module: $arg" >&2; exit 1; }
      # Mach-O bundles cannot link another bundle as a dylib. Core is loaded
      # first by shared_preload_libraries; resolve its symbols at load time.
      args+=(-undefined dynamic_lookup) ;;
    *) args+=("$arg") ;;
  esac
done
# Linux can resolve ICU through postgres; Darwin modules must link it explicitly.
if [[ " $* " = *" -dynamiclib "* || " $* " = *" -bundle "* ]]; then
  read -r -a icu_libs <<< "$(pkg-config --libs icu-uc icu-i18n)"
  args+=("${icu_libs[@]}")
  # RUM's split bundles also reference symbols supplied by the parent/core
  # at load time (ELF shared objects permit these references by default).
  args+=(-undefined dynamic_lookup)
fi
exec /usr/bin/clang "${args[@]}"
ADAPTER
chmod +x "$build/clang-adapter"
for module in pg_documentdb_core pg_documentdb pg_documentdb_extended_rum; do
  make -C "documentdb-source/$module" PG_CONFIG="$PG_CONFIG" CC="$build/clang-adapter" WERROR=
  make -C "documentdb-source/$module" PG_CONFIG="$PG_CONFIG" CC="$build/clang-adapter" WERROR= install
done
git clone --depth 1 --branch v1.6.7 https://github.com/citusdata/pg_cron.git pg_cron
make -C pg_cron PG_CONFIG="$PG_CONFIG"
make -C pg_cron PG_CONFIG="$PG_CONFIG" install
git clone --depth 1 --branch v0.8.1 https://github.com/pgvector/pgvector.git pgvector
make -C pgvector PG_CONFIG="$PG_CONFIG" OPTFLAGS=
make -C pgvector PG_CONFIG="$PG_CONFIG" install
fetch_tar https://download.osgeo.org/postgis/source/postgis-3.6.0.tar.gz
cd postgis-3.6.0
./configure --with-pgconfig="$PG_CONFIG" --without-raster --without-topology
make -j1
make -j1 install
cd "$DOCDB_SOURCE/pg_documentdb_gw"
rustup toolchain install 1.95 --profile minimal
cargo +1.95 build --locked --release -p documentdb_gateway
cp target/release/documentdb_gateway "$prefix/bin/"
mkdir -p "$prefix/share/documentdb" "$prefix/share/licenses/documentdb"
cp ../documentdb-local/scripts/documentdb_install_getparameter_stub.sh "$prefix/share/documentdb/"
cp -a ../LICENSE ../NOTICE ../licenses "$prefix/share/licenses/documentdb/"
cp NOTICE "$prefix/share/licenses/gateway-NOTICE"
for component in intelmath mongo-c-driver-1.28.0 pg_cron pgvector postgis-3.6.0; do
  mkdir -p "$prefix/share/licenses/$component"
  find "$build/$component" -maxdepth 2 -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'copyright*' -o -iname 'notice*' \) -exec cp {} "$prefix/share/licenses/$component/" \;
done
# Preserve dependency license notices and exact installed formula provenance.
# Include transitive Homebrew packages, since the dylib bundler follows them.
brew info --json=v2 --installed > "$prefix/share/licenses/homebrew-formulae.json"
while IFS= read -r formula; do
  formula_prefix=$(brew --prefix "$formula")
  destination="$prefix/share/licenses/homebrew/$formula"
  mkdir -p "$destination"
  find "$formula_prefix/" -maxdepth 4 -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'copyright*' -o -iname 'notice*' \) -exec cp {} "$destination/" \;
done < <(brew list --formula)
bash "$script_dir/../common/fix-macos-dylibs.sh" "$prefix"
cat > "$prefix/.hostdb-metadata.json" <<META
{"name":"documentdb","version":"1.0.0","platform":"darwin-$architecture","source":"source-build","sourceCommit":"b0cb0dae85e8746f4e0b79c847894179b2f80d64","components":{"postgresql":"17.11","documentdb":"1.0.0","gateway":"1.0.0","pg_cron":"1.6.7","pgvector":"0.8.1","postgis":"3.6.0"}}
META
archive=documentdb-1.0.0-darwin-$architecture.tar.gz
tar -C "$build" -czf "$output/$archive" documentdb
(cd "$output" && shasum -a 256 "$archive" > "$archive.sha256")
