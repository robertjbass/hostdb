#!/usr/bin/env bash
set -euo pipefail

# Build InfluxDB 3 from source for macOS Intel (darwin-x64)
#
# InfluxData does not publish official macOS Intel binaries for InfluxDB 3.
# This script replicates their CircleCI build process natively on macOS:
#
# 1. Download python-build-standalone (PBS) for x86_64-apple-darwin
# 2. Generate a PYO3_CONFIG_FILE pointing at the PBS Python
# 3. Build with cargo using the same flags as upstream
# 4. Rewrite the Python dylib path with install_name_tool
# 5. Re-sign with ad-hoc codesign
# 6. Package binary + PBS python/ + licenses into a tar.gz
#
# Prerequisites (installed by this script on CI):
#   - Rust toolchain (version from rust-toolchain.toml in repo)
#   - protobuf (for gRPC code generation)
#   - cmake
#
# Usage:
#   ./builds/influxdb/build-macos.sh --version 3.8.0
#   ./builds/influxdb/build-macos.sh --version 3.8.0 --output ./dist

# Python-build-standalone configuration
# These match what InfluxDB's CircleCI config uses (or closest available for x86_64)
PBS_DATE="20251205"
PBS_PYTHON_VERSION="3.13.11"
PBS_PYTHON_MAJ_MIN="3.13"
PBS_TARGET="x86_64-apple-darwin"
PBS_LIBPYTHON="python${PBS_PYTHON_MAJ_MIN}"

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
  PBS_TARGET="aarch64-apple-darwin"
else
  echo "ERROR: Unsupported architecture: $ARCH"
  exit 1
fi
echo "Platform: $PLATFORM"

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# ─── Install build dependencies ───────────────────────────────────────────────

echo ""
echo "=== Installing build dependencies ==="
brew install protobuf cmake pkg-config || true

# Install Rust if not present (repo's rust-toolchain.toml will select the right version)
if ! command -v cargo &> /dev/null; then
  echo "Installing Rust toolchain..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi
echo "Rust: $(rustc --version)"
echo "Cargo: $(cargo --version)"

# ─── Download python-build-standalone ─────────────────────────────────────────

echo ""
echo "=== Downloading python-build-standalone ==="
PBS_FILENAME="cpython-${PBS_PYTHON_VERSION}+${PBS_DATE}-${PBS_TARGET}-install_only_stripped.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_DATE}/${PBS_FILENAME}"
PBS_DIR="$WORK_DIR/python-standalone"

mkdir -p "$PBS_DIR"
echo "URL: $PBS_URL"
curl -fSL "$PBS_URL" -o "$WORK_DIR/$PBS_FILENAME"
echo "Extracting PBS..."
tar -xzf "$WORK_DIR/$PBS_FILENAME" -C "$PBS_DIR"

# PBS extracts to python/ inside the target directory
if [ ! -d "$PBS_DIR/python" ]; then
  echo "ERROR: PBS extraction failed - python/ directory not found"
  ls -la "$PBS_DIR"
  exit 1
fi

echo "PBS Python: $($PBS_DIR/python/bin/python${PBS_PYTHON_MAJ_MIN} --version)"
echo "PBS libpython: $(ls "$PBS_DIR/python/lib/lib${PBS_LIBPYTHON}"* 2>/dev/null | head -1)"

# ─── Generate PYO3 config file ────────────────────────────────────────────────

echo ""
echo "=== Generating PYO3 config file ==="
PYO3_CONFIG="$WORK_DIR/pyo3_config_file.txt"
cat > "$PYO3_CONFIG" << EOF
implementation=CPython
version=${PBS_PYTHON_MAJ_MIN}
shared=true
abi3=false
lib_name=${PBS_LIBPYTHON}
lib_dir=${PBS_DIR}/python/lib
executable=${PBS_DIR}/python/bin/python${PBS_PYTHON_MAJ_MIN}
pointer_width=64
build_flags=
suppress_build_script_link_lines=false
EOF

echo "Config:"
cat "$PYO3_CONFIG"

# ─── Clone source ─────────────────────────────────────────────────────────────

echo ""
echo "=== Cloning InfluxDB v$VERSION ==="
cd "$WORK_DIR"
git clone --depth 1 --branch "v$VERSION" https://github.com/influxdata/influxdb.git
cd influxdb

# ─── Build ────────────────────────────────────────────────────────────────────

echo ""
echo "=== Building InfluxDB (this may take 30-60 minutes with LTO) ==="
export PYO3_CONFIG_FILE="$PYO3_CONFIG"

# Build with the same default features as upstream
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

# ─── Post-build: rewrite Python dylib path ────────────────────────────────────

echo ""
echo "=== Rewriting dylib paths ==="

# Check current linkage
echo "Before rewrite:"
otool -L "$BINARY" | grep -i python || echo "(no python linkage found)"

# The build links against the PBS Python's absolute path. Rewrite to @executable_path
# so the binary finds python/ relative to itself at runtime.
PYTHON_DYLIB_NAME="lib${PBS_LIBPYTHON}.dylib"
PBS_PYTHON_LIB_ABS="$PBS_DIR/python/lib/$PYTHON_DYLIB_NAME"

if otool -L "$BINARY" | grep -q "$PBS_DIR"; then
  echo "Rewriting PBS absolute path to @executable_path..."
  install_name_tool \
    -change "$PBS_PYTHON_LIB_ABS" \
    "@executable_path/python/lib/$PYTHON_DYLIB_NAME" \
    "$BINARY"
elif otool -L "$BINARY" | grep -q "/install/lib/lib${PBS_LIBPYTHON}"; then
  # Upstream uses /install/lib/ prefix in their cross-compilation setup
  echo "Rewriting /install/lib/ path to @executable_path..."
  install_name_tool \
    -change "/install/lib/$PYTHON_DYLIB_NAME" \
    "@executable_path/python/lib/$PYTHON_DYLIB_NAME" \
    "$BINARY"
else
  echo "WARNING: Could not find expected Python dylib reference in binary"
  echo "Current linkage:"
  otool -L "$BINARY"
fi

# Re-sign after modification (macOS requires valid signature)
echo "Re-signing binary..."
codesign -s - --force "$BINARY"

echo "After rewrite:"
otool -L "$BINARY" | grep -i python || echo "(no python linkage found)"

# ─── Verify linkage ───────────────────────────────────────────────────────────

echo ""
echo "=== Verifying binary linkage ==="
echo "All dynamic libraries:"
otool -L "$BINARY"

# Check for any remaining non-system absolute paths
if otool -L "$BINARY" | grep -v "^\s*@" | grep -v "/usr/lib/" | grep -v "/System/" | grep -v ":" | grep -q "/"; then
  echo "WARNING: Binary may have non-relocatable library references"
  otool -L "$BINARY" | grep -v "^\s*@" | grep -v "/usr/lib/" | grep -v "/System/" | grep -v ":"
fi

# ─── Package ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Creating archive ==="
ARCHIVE_DIR="$WORK_DIR/archive/influxdb"
mkdir -p "$ARCHIVE_DIR"

# Copy binary
cp "$BINARY" "$ARCHIVE_DIR/influxdb3"
chmod +x "$ARCHIVE_DIR/influxdb3"

# Copy license files
cp "$WORK_DIR/influxdb/LICENSE-APACHE" "$ARCHIVE_DIR/" 2>/dev/null || true
cp "$WORK_DIR/influxdb/LICENSE-MIT" "$ARCHIVE_DIR/" 2>/dev/null || true

# Bundle the PBS Python runtime (the same one we compiled against)
echo "Bundling Python runtime..."
cp -R "$PBS_DIR/python" "$ARCHIVE_DIR/python"

# Also rewrite the dylib's install name within the python/ bundle
if [ -f "$ARCHIVE_DIR/python/lib/$PYTHON_DYLIB_NAME" ]; then
  install_name_tool \
    -id "@executable_path/python/lib/$PYTHON_DYLIB_NAME" \
    "$ARCHIVE_DIR/python/lib/$PYTHON_DYLIB_NAME"
  codesign -s - --force "$ARCHIVE_DIR/python/lib/$PYTHON_DYLIB_NAME"
fi

echo "Python runtime size: $(du -sh "$ARCHIVE_DIR/python" | cut -f1)"

# Inject metadata
cat > "$ARCHIVE_DIR/.hostdb-metadata.json" << EOF
{
  "name": "influxdb",
  "version": "$VERSION",
  "platform": "$PLATFORM",
  "source": "source-build",
  "rehosted_by": "hostdb",
  "rehosted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "build_info": {
    "pbs_date": "$PBS_DATE",
    "pbs_python": "$PBS_PYTHON_VERSION",
    "rust_version": "$(rustc --version | awk '{print $2}')"
  }
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
