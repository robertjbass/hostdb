#!/bin/bash
# Local CouchDB build script using Docker
#
# Extracts CouchDB from official Docker image for Linux platforms
#
# Usage:
#   ./builds/couchdb/build-local.sh --version 3.5.1 --platform linux-x64
#   ./builds/couchdb/build-local.sh --version 3.5.1 --platform linux-arm64

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Default values
VERSION="3.5.1"
PLATFORM=""
OUTPUT_DIR="./downloads"

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
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --version VERSION    CouchDB version (default: 3.5.1)"
            echo "  --platform PLATFORM  Target platform: linux-x64 or linux-arm64"
            echo "  --output DIR         Output directory (default: ./downloads)"
            echo "  --help               Show this help"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate platform
if [[ -z "$PLATFORM" ]]; then
    log_error "Platform is required (--platform linux-x64 or linux-arm64)"
    exit 1
fi

if [[ "$PLATFORM" != "linux-x64" && "$PLATFORM" != "linux-arm64" ]]; then
    log_error "Invalid platform: $PLATFORM"
    log_error "Only linux-x64 and linux-arm64 are supported for Docker extraction"
    exit 1
fi

# Map hostdb platform to Docker platform
DOCKER_PLATFORM=""
case $PLATFORM in
    linux-x64)
        DOCKER_PLATFORM="linux/amd64"
        ;;
    linux-arm64)
        DOCKER_PLATFORM="linux/arm64"
        ;;
esac

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"

# Output file
OUTPUT_FILE="$OUTPUT_DIR/couchdb-${VERSION}-${PLATFORM}.tar.gz"

log_info "CouchDB Docker Extraction"
log_info "Version: $VERSION"
log_info "Platform: $PLATFORM ($DOCKER_PLATFORM)"
log_info "Output: $OUTPUT_FILE"
echo ""

# Check Docker is available
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    exit 1
fi

# Check buildx is available
if ! docker buildx version &> /dev/null; then
    log_error "Docker buildx is not available"
    log_info "Install with: docker buildx install"
    exit 1
fi

# Create temp directory for build output
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

log_info "Building Docker image and extracting CouchDB..."

# Build with buildx and export to local directory
docker buildx build \
    --platform "$DOCKER_PLATFORM" \
    --build-arg VERSION="$VERSION" \
    --output "type=local,dest=$TEMP_DIR" \
    --file "$DOCKERFILE" \
    "$PROJECT_ROOT"

# Check extraction succeeded
if [[ ! -d "$TEMP_DIR/couchdb" ]]; then
    log_error "Extraction failed - couchdb directory not found"
    log_info "Contents of temp dir:"
    ls -la "$TEMP_DIR"
    exit 1
fi

# Verify key files
if [[ ! -f "$TEMP_DIR/couchdb/bin/couchdb" ]]; then
    log_error "Extraction incomplete - couchdb binary not found"
    exit 1
fi

log_success "Extraction complete"

# Create output directory
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Create tarball
log_info "Creating tarball: $(basename "$OUTPUT_FILE")"
tar -czf "$OUTPUT_FILE" -C "$TEMP_DIR" couchdb

# Calculate checksum
SHA256=$(sha256sum "$OUTPUT_FILE" | cut -d' ' -f1)
log_info "SHA256: $SHA256"

log_success "Created: $OUTPUT_FILE"
