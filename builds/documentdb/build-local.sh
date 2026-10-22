#!/usr/bin/env bash
set -euo pipefail
version=1.0.0
platform=linux-x64
output=./dist
no_cache=false
while (($#)); do
  case "$1" in
    --version) version="$2"; shift 2 ;;
    --platform) platform="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --no-cache) no_cache=true; shift ;;
    --) shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ "$version" = 1.0.0 ]] || { echo 'Only DocumentDB 1.0.0 is qualified by this recipe' >&2; exit 1; }
case "$platform" in
  linux-x64) docker_platform=linux/amd64 ;;
  linux-arm64) docker_platform=linux/arm64 ;;
  *) echo "Native DocumentDB build is not available for $platform" >&2; exit 1 ;;
esac
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
# Keep failed build files for diagnostics without reusing another architecture's
# objects. An explicit BUILD_CACHE_DIR is for resuming a known local build only.
cache_dir="${BUILD_CACHE_DIR:-}"
if [[ -z "$cache_dir" || "$no_cache" = true ]]; then
  cache_dir=$(mktemp -d "$output/.documentdb-build-${platform}.XXXXXX")
fi
docker run --rm --platform "$docker_platform" --cpus "${BUILD_JOBS:-2}" \
  --memory "${BUILD_MEMORY:-3g}" --memory-swap "${BUILD_MEMORY:-3g}" \
  -e BUILD_JOBS="${BUILD_JOBS:-2}" -e TARGET_PLATFORM="$platform" -e BUILD_FROM="${BUILD_FROM:-all}" \
  -v "$script_dir:/input:ro" -v "$output:/output" -v "$cache_dir:/build" ubuntu:22.04 \
  /bin/bash /input/build-native.sh
archive="documentdb-${version}-${platform}.tar.gz"
tar -C "$output" -czf "$output/$archive" documentdb
bash "$script_dir/../common/check-glibc-floor.sh" documentdb "$output"
(cd "$output" && sha256sum "$archive" > "$archive.sha256")
