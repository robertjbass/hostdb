#!/usr/bin/env bash
# HELP_START
# Local Docker build script for PostgreSQL
#
# Usage:
#   ./builds/postgresql/build-local.sh [options]
#
# Options:
#   --version VERSION    PostgreSQL version to build (default: 17.7)
#   --platform PLATFORM  Target platform: linux-x64, linux-arm64 (default: linux-x64)
#   --output DIR         Output directory (default: ./dist)
#   --no-cache           Build without Docker cache
#   --cleanup            Remove extracted directory after creating tarball
#   --no-cleanup         Keep extracted directory (default in non-interactive/CI)
#   --help               Show this help message
#
# Environment:
#   CLEANUP=1            Same as --cleanup
#   CI=true              Implies --no-cleanup unless --cleanup is specified
#
# Examples:
#   ./builds/postgresql/build-local.sh
#   ./builds/postgresql/build-local.sh --version 18.1 --platform linux-arm64
#   ./builds/postgresql/build-local.sh --no-cache --cleanup
#
# Build time: ~15-30 minutes depending on platform and resources
# HELP_END

set -euo pipefail

# Default values
VERSION="17.7"
PLATFORM="linux-x64"
OUTPUT_DIR="./dist"
NO_CACHE=""
CLEANUP_MODE=""  # "", "yes", or "no"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
    # Extract help text between HELP_START and HELP_END markers
    sed -n '/^# HELP_START$/,/^# HELP_END$/p' "$0" | sed '1d;$d' | sed 's/^# \?//'
    exit "${1:-0}"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
                log_error "Missing value for --version"
                show_help 1
            fi
            VERSION="$2"
            shift 2
            ;;
        --platform)
            if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
                log_error "Missing value for --platform"
                show_help 1
            fi
            PLATFORM="$2"
            shift 2
            ;;
        --output)
            if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
                log_error "Missing value for --output"
                show_help 1
            fi
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --no-cache)
            NO_CACHE="--no-cache"
            shift
            ;;
        --cleanup)
            CLEANUP_MODE="yes"
            shift
            ;;
        --no-cleanup)
            CLEANUP_MODE="no"
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            log_error "Unknown option: $1"
            show_help 1
            ;;
    esac
done

# Map platform to Docker platform
case $PLATFORM in
    linux-x64)
        DOCKER_PLATFORM="linux/amd64"
        ;;
    linux-arm64)
        DOCKER_PLATFORM="linux/arm64"
        ;;
    *)
        log_error "Unsupported platform for source builds: $PLATFORM"
        log_error "Source builds only support: linux-x64, linux-arm64"
        log_error "For darwin platforms, build natively on macOS"
        exit 1
        ;;
esac

# Check Docker is available
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    exit 1
fi

# Check Docker buildx is available (needed for multi-platform builds)
if ! docker buildx version &> /dev/null; then
    log_error "Docker buildx is not available"
    log_error "Enable via Docker Desktop settings or see: https://docs.docker.com/build/install-buildx/"
    exit 1
fi

# Create output directory
OUTPUT_PATH="${OUTPUT_DIR}/postgresql-${VERSION}-${PLATFORM}"
mkdir -p "$OUTPUT_PATH"

log_info "Building PostgreSQL ${VERSION} for ${PLATFORM}"
log_info "Docker platform: ${DOCKER_PLATFORM}"
log_info "Output directory: ${OUTPUT_PATH}"
echo ""

# Build start time
START_TIME=$(date +%s)

# Run Docker build
log_info "Starting Docker build (this may take 15-30+ minutes)..."
echo ""

docker buildx build \
    --platform "${DOCKER_PLATFORM}" \
    --build-arg VERSION="${VERSION}" \
    --output "type=local,dest=${OUTPUT_PATH}" \
    --progress=plain \
    ${NO_CACHE} \
    -f "${SCRIPT_DIR}/Dockerfile" \
    "${PROJECT_ROOT}"

# Build end time
END_TIME=$(date +%s)
ELAPSED_SECS=$((END_TIME - START_TIME))
ELAPSED_MINS=$((ELAPSED_SECS / 60))
ELAPSED_REMAINDER=$((ELAPSED_SECS % 60))

echo ""
log_success "Build completed in ${ELAPSED_MINS}m ${ELAPSED_REMAINDER}s"

# Verify output
if [[ -f "${OUTPUT_PATH}/postgresql/bin/postgres" ]]; then
    log_success "postgres binary found"
else
    log_error "postgres binary NOT found - build may have failed"
    exit 1
fi

if [[ -f "${OUTPUT_PATH}/postgresql/bin/psql" ]]; then
    log_success "psql client binary found"
else
    log_warn "psql client binary not found"
fi

if [[ -f "${OUTPUT_PATH}/postgresql/lib/pg_stat_statements.so" ]]; then
    log_success "pg_stat_statements contrib module found"
else
    log_warn "pg_stat_statements contrib module not found"
fi

# Create tarball
TARBALL="${OUTPUT_DIR}/postgresql-${VERSION}-${PLATFORM}.tar.gz"
log_info "Creating tarball: ${TARBALL}"

tar -czvf "${TARBALL}" -C "${OUTPUT_PATH}" postgresql

# Show tarball info
TARBALL_SIZE=$(du -h "${TARBALL}" | cut -f1)
log_success "Created: ${TARBALL} (${TARBALL_SIZE})"

# Calculate SHA256 (cross-platform)
if command -v shasum &> /dev/null; then
    SHA256=$(shasum -a 256 "${TARBALL}" | cut -d' ' -f1)
elif command -v sha256sum &> /dev/null; then
    SHA256=$(sha256sum "${TARBALL}" | cut -d' ' -f1)
else
    SHA256=$(openssl dgst -sha256 "${TARBALL}" | awk '{print $NF}')
fi
log_info "SHA256: ${SHA256}"

# Determine cleanup behavior
# Priority: CLI flag > CLEANUP env var > interactive prompt (if tty) > no cleanup
if [[ -z "$CLEANUP_MODE" ]]; then
    # Check CLEANUP environment variable
    if [[ "${CLEANUP:-}" == "1" || "${CLEANUP:-}" == "true" ]]; then
        CLEANUP_MODE="yes"
    elif [[ -t 0 ]] && [[ -z "${CI:-}" ]]; then
        # Interactive terminal and not CI - prompt user
        read -p "Remove extracted directory ${OUTPUT_PATH}? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            CLEANUP_MODE="yes"
        else
            CLEANUP_MODE="no"
        fi
    else
        # Non-interactive or CI - default to no cleanup
        CLEANUP_MODE="no"
    fi
fi

if [[ "$CLEANUP_MODE" == "yes" ]]; then
    rm -rf "${OUTPUT_PATH}"
    log_info "Removed ${OUTPUT_PATH}"
fi

echo ""
log_success "PostgreSQL ${VERSION} for ${PLATFORM} built successfully!"
log_info "Tarball: ${TARBALL}"
