#!/usr/bin/env bash
set -euo pipefail
prefix="${1:?bundle directory required}"
# Copy all transitive ELF dependencies except the host's glibc and loader.
mkdir -p "$prefix/share/licenses"
cp -a /usr/share/common-licenses "$prefix/share/licenses/"
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
      if [[ ! -f "$prefix/lib/$name" ]]; then
        cp -L "$dependency" "$prefix/lib/$name"
        # Retain distribution copyright notices for bundled system libraries.
        package=''
        canonical=$(readlink -f "$dependency")
        # Ubuntu's merged /usr layout and SONAME symlinks can differ from dpkg's
        # recorded path. Check both spellings and the resolved file.
        for candidate in "$dependency" "$canonical" "${canonical#/usr}" "/usr${dependency}"; do
          package=$(dpkg-query -S "$candidate" 2>/dev/null | sed -n '1s/: \/.*//p' || true)
          [[ -z "$package" ]] || break
        done
        package=${package%%:*}
        if [[ -n "$package" && -f "/usr/share/doc/$package/copyright" ]]; then
          mkdir -p "$prefix/share/licenses/system/$package"
          cp "/usr/share/doc/$package/copyright" "$prefix/share/licenses/system/$package/"
        else
          echo "Cannot locate copyright notice for $dependency" >&2
          exit 1
        fi
      fi
    done < <(ldd "$artifact" | awk '/=> \// {print $3}')
  done < <(find "$prefix/bin" "$prefix/lib" -type f -print0)
done
while IFS= read -r -d '' artifact; do
  file "$artifact" | grep -q ELF || continue
  relative=$(realpath --relative-to="$(dirname "$artifact")" "$prefix/lib")
  patchelf --set-rpath "\$ORIGIN:\$ORIGIN/$relative" "$artifact"
done < <(find "$prefix/bin" "$prefix/lib" -type f -print0)
# Validate only after every transitive dependency has its final RPATH.
while IFS= read -r -d '' artifact; do
  file "$artifact" | grep -q ELF || continue
  if ldd "$artifact" | grep -q 'not found'; then
    echo "Unresolved dependency in $artifact" >&2
    exit 1
  fi
done < <(find "$prefix/bin" "$prefix/lib" -type f -print0)
