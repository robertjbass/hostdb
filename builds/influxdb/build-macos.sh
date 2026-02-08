#!/usr/bin/env bash
set -euo pipefail

# Build InfluxDB 3 from source for macOS Intel (darwin-x64)
#
# InfluxDB 3 is a Rust project that uses PYO3 for its Python plugin system.
# No official macOS Intel binary is provided, so we build from source.
#
# Prerequisites (installed by this script on CI):
#   - Rust toolchain (stable)
#   - Python 3.12+ (for PYO3)
#   - protobuf (for gRPC code generation)
#   - cmake (build dependency)
#
# Usage:
#   ./builds/influxdb/build-macos.sh --version 3.8.0
#   ./builds/influxdb/build-macos.sh --version 3.8.0 --output ./dist

VERSION=""
OUTPUT_DIR="./dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 --version VERSION [--output DIR]"
      exit 1
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "ERROR: --version is required"
  echo "Usage: $0 --version VERSION [--output DIR]"
  exit 1
fi

echo "=== InfluxDB macOS Source Build ==="
echo "Version: $VERSION"
echo "Output: $OUTPUT_DIR"
echo ""

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  PLATFORM="darwin-x64"
elif [ "$ARCH" = "arm64" ]; then
  PLATFORM="darwin-arm64"
else
  echo "ERROR: Unsupported architecture: $ARCH"
  exit 1
fi
echo "Platform: $PLATFORM"

# Install build dependencies via Homebrew
echo ""
echo "=== Installing build dependencies ==="
brew install protobuf cmake python@3.12 || true

# Install Rust if not present
if ! command -v cargo &> /dev/null; then
  echo "Installing Rust toolchain..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
fi
echo "Rust: $(rustc --version)"
echo "Cargo: $(cargo --version)"

# Set up Python for PYO3
PYTHON_PATH=$(brew --prefix python@3.12)/bin/python3.12
if [ ! -f "$PYTHON_PATH" ]; then
  echo "ERROR: Python 3.12 not found at $PYTHON_PATH"
  exit 1
fi
echo "Python: $($PYTHON_PATH --version)"

export PYO3_PYTHON="$PYTHON_PATH"

# Clone the source
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo ""
echo "=== Cloning InfluxDB v$VERSION ==="
cd "$WORK_DIR"
git clone --depth 1 --branch "v$VERSION" https://github.com/influxdata/influxdb.git
cd influxdb

# Build
echo ""
echo "=== Building InfluxDB ==="
cargo build --release --package influxdb3

# Locate the built binary
BINARY="$WORK_DIR/influxdb/target/release/influxdb3"
if [ ! -f "$BINARY" ]; then
  echo "ERROR: Built binary not found at $BINARY"
  echo "Contents of target/release/:"
  ls -la "$WORK_DIR/influxdb/target/release/" | head -20
  exit 1
fi
echo "Built binary: $(file "$BINARY")"
echo "Size: $(du -h "$BINARY" | cut -f1)"

# Create archive structure
ARCHIVE_DIR="$WORK_DIR/archive/influxdb"
mkdir -p "$ARCHIVE_DIR"

cp "$BINARY" "$ARCHIVE_DIR/influxdb3"
chmod +x "$ARCHIVE_DIR/influxdb3"

# Copy license files
cp "$WORK_DIR/influxdb/LICENSE-APACHE" "$ARCHIVE_DIR/" 2>/dev/null || true
cp "$WORK_DIR/influxdb/LICENSE-MIT" "$ARCHIVE_DIR/" 2>/dev/null || true

# Bundle Python runtime for PYO3 plugin system
PYTHON_PREFIX=$(brew --prefix python@3.12)
if [ -d "$PYTHON_PREFIX" ]; then
  echo "Bundling Python runtime from $PYTHON_PREFIX..."
  mkdir -p "$ARCHIVE_DIR/python"
  # Copy the Python framework/lib needed for embedding
  cp -R "$PYTHON_PREFIX/Frameworks/Python.framework/Versions/3.12/lib" "$ARCHIVE_DIR/python/" 2>/dev/null || \
    cp -R "$PYTHON_PREFIX/lib/python3.12" "$ARCHIVE_DIR/python/lib/" 2>/dev/null || \
    echo "WARN: Could not bundle Python runtime - plugin system may not work"
fi

# Inject metadata
cat > "$ARCHIVE_DIR/.hostdb-metadata.json" << EOF
{
  "name": "influxdb",
  "version": "$VERSION",
  "platform": "$PLATFORM",
  "source": "source-build",
  "rehosted_by": "hostdb",
  "rehosted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Create archive
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/influxdb-$VERSION-$PLATFORM.tar.gz"
tar -czf "$OUTPUT_FILE" -C "$WORK_DIR/archive" influxdb

echo ""
echo "=== Build Complete ==="
echo "Output: $OUTPUT_FILE"
echo "Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo "SHA256: $(shasum -a 256 "$OUTPUT_FILE" | cut -d' ' -f1)"
