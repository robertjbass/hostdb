#!/usr/bin/env bash
# HELP_START
# The one pgvector recipe for the standard PostgreSQL build.
#
# The Dockerfile, build-local.sh and release-postgresql.yml all call this
# script, so the version scope, the pinned source and the expected files live
# in exactly one place.
#
# Usage:
#   pgvector.sh applies <hostdb-version> <platform>
#       Prints "yes" when that build must include pgvector, "no" otherwise.
#       Exits non-zero only on bad input, so callers can tell "no" from an error.
#   pgvector.sh install <pg_config> <work-dir>
#       Downloads the pinned pgvector source, verifies its sha256 and installs it
#       into the PostgreSQL that <pg_config> describes.
#   pgvector.sh verify <postgresql-root>
#       Fails unless the library, control file and install/upgrade SQL exist.
#
# Scope: linux-x64 builds of PostgreSQL 18 and 19, which covers every major
# Cloud offers for new databases. linux-arm64 and darwin are not qualified (see
# builds/postgresql/README.md); win32-x64 is the EDB binary and never built here.
# HELP_END

set -euo pipefail

PGVECTOR_VERSION="0.8.7"
PGVECTOR_SHA256="cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85"
PGVECTOR_URL="https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v${PGVECTOR_VERSION}"
PGVECTOR_MIN_MAJOR=18
PGVECTOR_PLATFORMS=("linux-x64")
PGVECTOR_FILES=(
    lib/vector.so
    share/extension/vector.control
    share/extension/vector--0.8.7.sql
    share/extension/vector--0.8.6--0.8.7.sql
)

usage() {
    sed -n '/^# HELP_START$/,/^# HELP_END$/p' "$0" | sed '1d;$d' | sed 's/^# \{0,1\}//' >&2
    exit 2
}

applies() {
    local version="$1" platform="$2" major supported=""
    major="${version%%.*}"
    if [[ ! "$major" =~ ^[0-9]+$ ]]; then
        echo "pgvector.sh: cannot read a major version from '${version}'. Pass a hostdb version such as 18.6.0." >&2
        exit 2
    fi
    for candidate in "${PGVECTOR_PLATFORMS[@]}"; do
        [[ "$candidate" == "$platform" ]] && supported="yes"
    done
    if [[ -n "$supported" && "$major" -ge "$PGVECTOR_MIN_MAJOR" && "$major" -le 19 ]]; then
        echo "yes"
    else
        echo "no"
    fi
}

install_pgvector() {
    local pg_config="$1" work_dir="$2"
    local archive="${work_dir}/pgvector-${PGVECTOR_VERSION}.tar.gz"
    mkdir -p "$work_dir"
    curl -fsSL "$PGVECTOR_URL" -o "$archive"
    echo "${PGVECTOR_SHA256}  ${archive}" | sha256sum -c -
    tar -xzf "$archive" -C "$work_dir"
    make -C "${work_dir}/pgvector-${PGVECTOR_VERSION}" -j2 PG_CONFIG="$pg_config" OPTFLAGS=
    make -C "${work_dir}/pgvector-${PGVECTOR_VERSION}" install PG_CONFIG="$pg_config" OPTFLAGS=
    local source_dir="${work_dir}/pgvector-${PGVECTOR_VERSION}"
    local prefix
    prefix=$(dirname "$("$pg_config" --bindir)")
    mkdir -p "$prefix/share/licenses/pgvector"
    cp "$source_dir/LICENSE" "$prefix/share/licenses/pgvector/LICENSE"
    # The build image is root; PostgreSQL's regression cluster must not be.
    chown -R nobody:nogroup "$source_dir"
    if ! runuser -u nobody -- make -C "$source_dir" installcheck PG_CONFIG="$pg_config" OPTFLAGS= \
        REGRESS_OPTS="--inputdir=test --load-extension=vector --temp-instance=$source_dir/tmp-check"; then
        cat "$source_dir/regression.diffs" >&2 || true
        return 1
    fi
}

verify() {
    local root="$1" missing=0
    for file in "${PGVECTOR_FILES[@]}"; do
        if [[ ! -s "${root}/${file}" ]]; then
            echo "pgvector file missing: ${file}. Rebuild with builds/postgresql/pgvector.sh install." >&2
            missing=1
        fi
    done
    if [[ "$missing" -ne 0 ]]; then
        exit 1
    fi
    echo "pgvector ${PGVECTOR_VERSION} verification passed"
}

case "${1:-}" in
    applies)
        [[ $# -eq 3 ]] || usage
        applies "$2" "$3"
        ;;
    install)
        [[ $# -eq 3 ]] || usage
        install_pgvector "$2" "$3"
        ;;
    verify)
        [[ $# -eq 2 ]] || usage
        verify "$2"
        ;;
    *)
        usage
        ;;
esac
