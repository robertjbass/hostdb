#!/usr/bin/env bash
# build-macos-deps.sh - Build the third-party libraries hostdb bundles on macOS
#
# Usage: ./builds/common/build-macos-deps.sh --prefix <dir> <dep>...
#   <dep>  openssl | icu
#
# Homebrew bottles are built for the runner's own macOS (macos-15 runners get
# Sequoia bottles with a 15.0 minimum), and Homebrew strips
# MACOSX_DEPLOYMENT_TARGET when it builds from source. Any Homebrew dylib we
# bundle would therefore raise the minimum macOS of the whole package. This
# script builds the bundled libraries from pinned, checksummed sources with the
# hostdb deployment target (builds/common/macos-deployment-target.env) instead.
#
# After it runs, point the build at <dir> (include/, lib/, lib/pkgconfig/) and
# export HOSTDB_MACOS_DEPS_PREFIX=<dir> so fix-macos-dylibs.sh bundles from it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=macos-deployment-target.env
source "$SCRIPT_DIR/macos-deployment-target.env"

OPENSSL_VERSION="3.5.9"
OPENSSL_SHA256="603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a"
ICU_VERSION="78.3"
ICU_SHA256="3a2e7a47604ba702f345878308e6fefeca612ee895cf4a5f222e7955fabfe0c0"

PREFIX=""
DEPS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prefix) PREFIX="$2"; shift 2 ;;
        -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
        *) DEPS+=("$1"); shift ;;
    esac
done

if [[ -z "$PREFIX" || ${#DEPS[@]} -eq 0 ]]; then
    echo "Usage: $0 --prefix <dir> <openssl|icu>..." >&2
    exit 1
fi

mkdir -p "$PREFIX"
PREFIX="$(cd "$PREFIX" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
JOBS="$(sysctl -n hw.ncpu)"

case "$(uname -m)" in
    arm64) OPENSSL_TARGET="darwin64-arm64-cc" ;;
    x86_64) OPENSSL_TARGET="darwin64-x86_64-cc" ;;
    *) echo "ERROR: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

fetch() {
    local url="$1" sha="$2" out="$3"
    curl -fsSL --retry 3 "$url" -o "$out"
    echo "$sha  $out" | shasum -a 256 -c -
}

build_openssl() {
    echo "=== OpenSSL $OPENSSL_VERSION (MACOSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET) ==="
    fetch "https://github.com/openssl/openssl/releases/download/openssl-${OPENSSL_VERSION}/openssl-${OPENSSL_VERSION}.tar.gz" \
        "$OPENSSL_SHA256" "$WORK_DIR/openssl.tar.gz"
    tar -xzf "$WORK_DIR/openssl.tar.gz" -C "$WORK_DIR"
    (
        cd "$WORK_DIR/openssl-${OPENSSL_VERSION}"
        # Keep the certificate directory Homebrew's openssl@3 used, so TLS
        # defaults on machines with Homebrew behave as they did before.
        local openssldir
        if command -v brew >/dev/null 2>&1; then
            openssldir="$(brew --prefix)/etc/openssl@3"
        else
            openssldir="$PREFIX/ssl"
        fi
        ./Configure "$OPENSSL_TARGET" shared no-tests no-docs \
            --prefix="$PREFIX" --libdir=lib --openssldir="$openssldir"
        make -j"$JOBS"
        make install_sw
    )
}

build_icu() {
    echo "=== ICU $ICU_VERSION (MACOSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET) ==="
    fetch "https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION}/icu4c-${ICU_VERSION}-sources.tgz" \
        "$ICU_SHA256" "$WORK_DIR/icu.tgz"
    tar -xzf "$WORK_DIR/icu.tgz" -C "$WORK_DIR"
    (
        cd "$WORK_DIR/icu/source"
        # Header padding lets the install names be made absolute below.
        LDFLAGS="-Wl,-headerpad_max_install_names" \
            ./runConfigureICU MacOSX --prefix="$PREFIX" \
                --enable-shared --disable-static \
                --disable-samples --disable-tests --disable-extras
        make -j"$JOBS"
        make install
    )
    # ICU installs its dylibs with bare install names (libicuuc.78.dylib), which
    # the bundling steps cannot resolve. Give them absolute ones, as Homebrew does.
    local lib ref id
    for lib in "$PREFIX"/lib/libicu*.dylib; do
        [[ -L "$lib" ]] && continue
        id="$(otool -D "$lib" | tail -1)"
        [[ "$id" == /* ]] || install_name_tool -id "$PREFIX/lib/$id" "$lib"
        for ref in $(otool -L "$lib" | tail -n +2 | awk '{print $1}' | grep -E '^libicu'); do
            install_name_tool -change "$ref" "$PREFIX/lib/$ref" "$lib"
        done
        codesign --force --sign - "$lib"
    done
}

for dep in "${DEPS[@]}"; do
    case "$dep" in
        openssl) build_openssl ;;
        icu) build_icu ;;
        *) echo "ERROR: unknown dependency '$dep' (supported: openssl, icu)" >&2; exit 1 ;;
    esac
done

"$SCRIPT_DIR/check-macos-minos.sh" "$PREFIX/lib"
echo "Dependencies installed in $PREFIX"
