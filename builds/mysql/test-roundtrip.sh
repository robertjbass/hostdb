#!/usr/bin/env bash
#
# Functional round-trip test for a re-wrapped MySQL tarball.
#
# Proves that the four binaries spindb actually uses all work against a freshly
# initialized server:
#   mysqld     -> initialize + start
#   mysql      -> create/insert + RESTORE (pipe SQL in)
#   mysqldump  -> BACKUP
#   mysqladmin -> shutdown
#
# This is the guard against the "minimal build dropped a needed binary" failure
# mode (the pg_dump/pg_restore incident). If this exits 0, backup+restore work.
#
# linux-x64 binaries are exercised inside a linux/amd64 container (so it runs on
# an Apple Silicon host via Docker's emulation). Requires Docker to be running.
#
# Usage:
#   ./builds/mysql/test-roundtrip.sh <path-to-tarball> [platform]
#     platform defaults to linux-x64
#
# Example:
#   ./builds/mysql/test-roundtrip.sh downloads/mysql-8.4.9-linux-x64.tar.gz linux-x64

set -euo pipefail

TARBALL="${1:?usage: test-roundtrip.sh <tarball> [platform]}"
PLATFORM="${2:-linux-x64}"

if [ ! -f "$TARBALL" ]; then
  echo "ERROR: tarball not found: $TARBALL" >&2
  exit 1
fi

ABS_TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
TARBALL_DIR="$(dirname "$ABS_TARBALL")"
TARBALL_NAME="$(basename "$ABS_TARBALL")"

case "$PLATFORM" in
  linux-x64)   DOCKER_PLATFORM="linux/amd64" ;;
  linux-arm64) DOCKER_PLATFORM="linux/arm64" ;;
  *)
    echo "ERROR: this harness only runs linux-* tarballs (got: $PLATFORM)." >&2
    echo "       macOS/Windows must be tested natively." >&2
    exit 1
    ;;
esac

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

echo "=== MySQL round-trip test ==="
echo "  tarball:  $TARBALL_NAME"
echo "  platform: $PLATFORM ($DOCKER_PLATFORM)"
echo

# The in-container test script. Extracts the tarball, initializes a server,
# round-trips a small dataset through mysqldump -> mysql, and verifies the data
# survived intact.
CONTAINER_SCRIPT='
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
# MySQL glibc tarballs need libaio + libnuma at runtime; ncurses for the client;
# xz-utils so tar can read .tar.xz inputs.
apt-get install -y -qq libaio1 libnuma1 libncurses6 xz-utils >/dev/null

WORK=/work
BASE=$WORK/mysql
DATA=$WORK/data
mkdir -p "$BASE" "$DATA"

echo "[extract] $TARBALL_NAME"
tar xf "/input/$TARBALL_NAME" -C "$BASE" --strip-components=1

echo "[assert ] required binaries present + executable"
for b in mysqld mysql mysqldump mysqladmin; do
  if [ ! -x "$BASE/bin/$b" ]; then
    echo "FAIL: missing or non-executable bin/$b" >&2
    exit 1
  fi
done

echo "[init   ] mysqld --initialize-insecure"
"$BASE/bin/mysqld" --no-defaults --basedir="$BASE" --datadir="$DATA" \
  --user=root --initialize-insecure --log-error="$WORK/init.log" \
  || { echo "FAIL: initialize"; cat "$WORK/init.log" 2>/dev/null; exit 1; }

echo "[start  ] mysqld (127.0.0.1:3399)"
"$BASE/bin/mysqld" --no-defaults --basedir="$BASE" --datadir="$DATA" \
  --user=root --bind-address=127.0.0.1 --port=3399 \
  --socket="$WORK/mysql.sock" --mysqlx=OFF --log-error="$WORK/server.log" &
SERVER_PID=$!

ok=0
for i in $(seq 1 60); do
  if "$BASE/bin/mysqladmin" -h 127.0.0.1 -P 3399 -u root ping >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "FAIL: server never became ready" >&2
  cat "$WORK/server.log" 2>/dev/null
  exit 1
fi

CONN="-h 127.0.0.1 -P 3399 -u root"

echo "[seed   ] create db + 3 rows"
"$BASE/bin/mysql" $CONN -e "CREATE DATABASE t; USE t; CREATE TABLE x(id INT PRIMARY KEY, v VARCHAR(64)); INSERT INTO x VALUES (1,\"alpha\"),(2,\"beta\"),(3,\"gamma\");"

echo "[backup ] mysqldump --set-gtid-purged=OFF t > dump.sql"
"$BASE/bin/mysqldump" $CONN --set-gtid-purged=OFF t > "$WORK/dump.sql"
test -s "$WORK/dump.sql" || { echo "FAIL: empty dump"; exit 1; }

echo "[restore] drop db, then mysql t < dump.sql"
"$BASE/bin/mysql" $CONN -e "DROP DATABASE t; CREATE DATABASE t;"
"$BASE/bin/mysql" $CONN t < "$WORK/dump.sql"

echo "[verify ] row count + values"
COUNT=$("$BASE/bin/mysql" $CONN -N -e "SELECT COUNT(*) FROM t.x")
VALS=$("$BASE/bin/mysql" $CONN -N -e "SELECT GROUP_CONCAT(v ORDER BY id) FROM t.x")

"$BASE/bin/mysqladmin" $CONN shutdown >/dev/null 2>&1 || kill "$SERVER_PID" 2>/dev/null || true

if [ "$COUNT" = "3" ] && [ "$VALS" = "alpha,beta,gamma" ]; then
  echo "ROUNDTRIP_OK"
else
  echo "FAIL: data mismatch after restore (count=$COUNT vals=$VALS)" >&2
  exit 1
fi
'

set +e
docker run --rm --platform "$DOCKER_PLATFORM" \
  -v "$TARBALL_DIR":/input:ro \
  -e TARBALL_NAME="$TARBALL_NAME" \
  debian:bookworm-slim \
  bash -c "$CONTAINER_SCRIPT"
STATUS=$?
set -e

echo
if [ "$STATUS" -eq 0 ]; then
  echo "=== PASS: backup + restore round-trip succeeded on $PLATFORM ==="
else
  echo "=== FAIL (exit $STATUS): do NOT ship this tarball ===" >&2
fi
exit "$STATUS"
