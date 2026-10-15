#!/usr/bin/env bash
# HELP_START
# The one pg_cron recipe for the standard PostgreSQL build.
#
# The Dockerfile, build-local.sh and release-postgresql.yml all call this
# script, so the version scope, the pinned source and the expected files live
# in exactly one place.
#
# Usage:
#   pg-cron.sh applies <hostdb-version> <platform>
#       Prints "yes" when that build must include pg_cron, "no" otherwise.
#       Exits non-zero only on bad input, so callers can tell "no" from an error.
#   pg-cron.sh install <pg_config> <work-dir>
#       Downloads the pinned pg_cron source, verifies its sha256 and installs it
#       into the PostgreSQL that <pg_config> describes.
#   pg-cron.sh verify <postgresql-root>
#       Fails unless the library, control file and install/upgrade SQL exist.
#
# Scope: linux-x64 builds of PostgreSQL 18 and newer, which covers every major
# Cloud offers for new databases. linux-arm64 and darwin are not qualified (see
# builds/postgresql/README.md); win32-x64 is the EDB binary and never built here.
# HELP_END

set -euo pipefail

PG_CRON_VERSION="1.6.8"
PG_CRON_SHA256="c19ab9bb35406c60fb51ecda993737c083850abe424acb6c1030439d00a1f8e4"
PG_CRON_URL="https://codeload.github.com/citusdata/pg_cron/tar.gz/refs/tags/v${PG_CRON_VERSION}"
PG_CRON_MIN_MAJOR=18
PG_CRON_PLATFORMS=("linux-x64")
PG_CRON_FILES=(
    lib/pg_cron.so
    share/extension/pg_cron.control
    share/extension/pg_cron--1.0.sql
    share/extension/pg_cron--1.5--1.6.sql
)

usage() {
    sed -n '/^# HELP_START$/,/^# HELP_END$/p' "$0" | sed '1d;$d' | sed 's/^# \{0,1\}//' >&2
    exit 2
}

applies() {
    local version="$1" platform="$2" major supported=""
    major="${version%%.*}"
    if [[ ! "$major" =~ ^[0-9]+$ ]]; then
        echo "pg-cron.sh: cannot read a major version from '${version}'. Pass a hostdb version such as 18.6.0." >&2
        exit 2
    fi
    for candidate in "${PG_CRON_PLATFORMS[@]}"; do
        [[ "$candidate" == "$platform" ]] && supported="yes"
    done
    if [[ -n "$supported" && "$major" -ge "$PG_CRON_MIN_MAJOR" ]]; then
        echo "yes"
    else
        echo "no"
    fi
}

install_pg_cron() {
    local pg_config="$1" work_dir="$2"
    local archive="${work_dir}/pg_cron-${PG_CRON_VERSION}.tar.gz"
    mkdir -p "$work_dir"
    curl -fsSL "$PG_CRON_URL" -o "$archive"
    echo "${PG_CRON_SHA256}  ${archive}" | sha256sum -c -
    tar -xzf "$archive" -C "$work_dir"
    make -C "${work_dir}/pg_cron-${PG_CRON_VERSION}" -j2 PG_CONFIG="$pg_config"
    make -C "${work_dir}/pg_cron-${PG_CRON_VERSION}" install PG_CONFIG="$pg_config"
}

verify() {
    local root="$1" missing=0
    for file in "${PG_CRON_FILES[@]}"; do
        if [[ ! -s "${root}/${file}" ]]; then
            echo "pg_cron file missing: ${file}. Rebuild with builds/postgresql/pg-cron.sh install." >&2
            missing=1
        fi
    done
    if [[ "$missing" -ne 0 ]]; then
        exit 1
    fi
    echo "pg_cron ${PG_CRON_VERSION} verification passed"
}

case "${1:-}" in
    applies)
        [[ $# -eq 3 ]] || usage
        applies "$2" "$3"
        ;;
    install)
        [[ $# -eq 3 ]] || usage
        install_pg_cron "$2" "$3"
        ;;
    verify)
        [[ $# -eq 2 ]] || usage
        verify "$2"
        ;;
    *)
        usage
        ;;
esac
