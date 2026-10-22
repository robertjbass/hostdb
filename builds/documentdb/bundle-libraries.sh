#!/usr/bin/env bash
set -euo pipefail
prefix="${1:?bundle directory required}"
# Copy all transitive ELF dependencies except the host's glibc and loader.
previous=-1
while true; do
  count=$(find "$prefix/lib" -type f | wc -l)
  [[ "$count" != "$previous" ]] || break
  previous="$count"
  while IFS= read -r -d '' artifact; do
    file "$artifact" | grep -q ELF || continue
    while read -r dependency; do
      name=$(basename "$dependency")
      case "$name" in
        ld-linux*|libc.so*|libm.so*|libdl.so*|libpthread.so*|librt.so*|libresolv.so*|libnss_*) continue ;;
      esac
      [[ -f "$prefix/lib/$name" ]] || cp -L "$dependency" "$prefix/lib/$name"
    done < <(ldd "$artifact" | awk '/=> \// {print $3}')
  done < <(find "$prefix/bin" "$prefix/lib" -type f -print0)
done
while IFS= read -r -d '' artifact; do
  file "$artifact" | grep -q ELF || continue
  relative=$(realpath --relative-to="$(dirname "$artifact")" "$prefix/lib")
  patchelf --set-rpath "\$ORIGIN:\$ORIGIN/$relative" "$artifact"
  if ldd "$artifact" | grep -q 'not found'; then
    echo "Unresolved dependency in $artifact" >&2
    exit 1
  fi
done < <(find "$prefix/bin" "$prefix/lib" -type f -print0)
