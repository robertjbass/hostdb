#!/bin/bash
#
# Build SQLite from source locally using Docker
#
# Usage:
#   ./builds/sqlite/build-local.sh
#   ./builds/sqlite/build-local.sh --version 3.51.2
#   ./builds/sqlite/build-local.sh --version 3.51.2 --platform linux-arm64
#
# This script builds SQLite for linux-arm64 (the only platform requiring source build).
# Other platforms have official binaries available via download.ts.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="3.51.2"
PLATFORM="linux-arm64"

show_help() {
    cat << EOF
Usage: $0 [options]

Build SQLite from source using Docker.

Options:
    --version VERSION    SQLite version (default: $VERSION)
    --platform PLATFORM  Target platform (default: $PLATFORM)
                         Only linux-arm64 is supported for source builds
    --help               Show this help message

Examples:
    $0
    $0 --version 3.51.2
EOF
    exit "${1:-0}"
}

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
        --help)
            show_help 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help 1
            ;;
    esac
done

# Validate platform
if [[ "$PLATFORM" != "linux-arm64" ]]; then
    echo "Error: Only linux-arm64 requires source build"
    echo "Use 'pnpm download:sqlite' for other platforms"
    exit 1
fi

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Invalid version format: $VERSION"
    echo "Expected format: X.Y.Z (e.g., 3.51.2)"
    exit 1
fi

echo "Building SQLite $VERSION for $PLATFORM"
echo "========================================"

# Check Docker is available
if ! command -v docker &>/dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Create output directory
OUTPUT_DIR="$SCRIPT_DIR/../../dist"
mkdir -p "$OUTPUT_DIR"

# Build Docker image
echo "Building Docker image..."
docker build \
    --build-arg VERSION="$VERSION" \
    --platform linux/arm64 \
    -t sqlite-builder:$VERSION \
    "$SCRIPT_DIR"

# Run container to extract artifact
echo "Extracting artifact..."
docker run --rm \
    --platform linux/arm64 \
    -v "$OUTPUT_DIR:/dist" \
    sqlite-builder:$VERSION

echo ""
echo "Build complete!"
echo "Output: $OUTPUT_DIR/sqlite-$VERSION-$PLATFORM.tar.gz"
