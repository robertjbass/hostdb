#!/bin/bash
#
# Local build helper for PostgreSQL + DocumentDB
#
# Usage:
#   ./build-local.sh --version 17-0.107.0 --platform linux-x64
#   ./build-local.sh --version 17-0.107.0 --platform linux-arm64
#   ./build-local.sh --version 17-0.107.0 --platform darwin-arm64
#
# For Linux platforms, uses Docker extraction.
# For macOS platforms, uses native build (build-macos.sh).
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Default values
VERSION="17-0.107.0"
PLATFORM=""
OUTPUT_DIR="./dist"
CLEANUP=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            VERSION="$2"
            shift 2
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --cleanup)
            CLEANUP=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --version VERSION    Version (default: 17-0.107.0)"
            echo "  --platform PLATFORM  Target platform (required)"
            echo "  --output DIR         Output directory (default: ./dist)"
            echo "  --cleanup            Remove intermediate files after build"
            echo "  --help               Show this help"
            echo ""
            echo "Platforms:"
            echo "  linux-x64     - Linux x86_64 (Docker extraction)"
            echo "  linux-arm64   - Linux ARM64 (Docker extraction)"
            echo "  darwin-x64    - macOS Intel (native build)"
            echo "  darwin-arm64  - macOS Apple Silicon (native build)"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [[ -z "${PLATFORM}" ]]; then
    log_error "Platform is required. Use --platform <platform>"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log_info "PostgreSQL + DocumentDB Local Build"
log_info "Version: ${VERSION}"
log_info "Platform: ${PLATFORM}"
log_info "Output: ${OUTPUT_DIR}"
echo

mkdir -p "${OUTPUT_DIR}"

case "${PLATFORM}" in
    linux-x64|linux-arm64)
        # Docker extraction
        if ! command -v docker &> /dev/null; then
            log_error "Docker is required for Linux builds"
            exit 1
        fi

        log_info "Using Docker extraction for ${PLATFORM}..."
        cd "${REPO_ROOT}"
        pnpm tsx builds/postgresql-documentdb/download.ts \
            --version "${VERSION}" \
            --platform "${PLATFORM}" \
            --output "${OUTPUT_DIR}"
        ;;

    darwin-x64|darwin-arm64)
        # Native macOS build
        if [[ "$(uname)" != "Darwin" ]]; then
            log_error "macOS builds require running on macOS"
            exit 1
        fi

        log_info "Using native build for ${PLATFORM}..."
        "${SCRIPT_DIR}/build-macos.sh" "${VERSION}" "${PLATFORM}" "${OUTPUT_DIR}"
        ;;

    win32-x64)
        log_error "Windows builds are not yet supported"
        exit 1
        ;;

    *)
        log_error "Unknown platform: ${PLATFORM}"
        exit 1
        ;;
esac

OUTPUT_FILE="${OUTPUT_DIR}/postgresql-documentdb-${VERSION}-${PLATFORM}.tar.gz"

if [[ -f "${OUTPUT_FILE}" ]]; then
    log_success "Build complete: ${OUTPUT_FILE}"
    ls -lh "${OUTPUT_FILE}"
else
    log_error "Expected output file not found: ${OUTPUT_FILE}"
    exit 1
fi
