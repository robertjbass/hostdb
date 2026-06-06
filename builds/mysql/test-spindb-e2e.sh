#!/usr/bin/env bash
#
# End-to-end test: spindb's OWN published CLI driving a hostdb minimal binary.
#
# Unlike test-roundtrip.sh (which drives the binaries directly), this installs
# the real published `spindb`, pre-places the minimal at spindb's binary-cache
# path (so spindb USES it instead of downloading the full from R2), and runs the
# real product lifecycle as a NON-root user (mirroring prod's `gosu` user):
#
#   spindb create --start  ->  query (seed)  ->  backup  ->  restore  ->  verify
#
# If this prints SPINDB_E2E_OK, the actual product (and therefore layerbase-cloud,
# which shells out to spindb) works with the minimal build. linux-x64 binaries
# run in a linux/amd64 container (native on an amd64 host). Requires Docker.
#
# Usage: ./builds/mysql/test-spindb-e2e.sh <tarball> <version>
#   e.g. ./builds/mysql/test-spindb-e2e.sh /tmp/.../mysql-8.4.9-linux-x64.tar.gz 8.4.9

set -euo pipefail

TARBALL="${1:?usage: test-spindb-e2e.sh <tarball> <version>}"
VERSION="${2:?usage: test-spindb-e2e.sh <tarball> <version>}"
[ -f "$TARBALL" ] || { echo "ERROR: tarball not found: $TARBALL" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker is not running." >&2; exit 1; }

ABS="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
DIR="$(dirname "$ABS")"
NAME="$(basename "$ABS")"

echo "=== spindb end-to-end test (minimal binary) ==="
echo "  tarball: $NAME"
echo "  version: $VERSION"
echo

# Container script. Runs as root for setup (apt/npm/place binary), then runs the
# spindb lifecycle as the unprivileged 'node' user. SQL uses integer columns
# only, so there are no nested quotes to escape, and a distinctive marker-sum
# (666666) proves all rows survived the restore.
OUTER='
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq libaio1 libnuma1 libncurses6 >/dev/null

echo "[setup] installing published spindb"
npm install -g spindb >/tmp/npm.log 2>&1 || { echo "npm install spindb FAILED"; tail -30 /tmp/npm.log; exit 1; }
echo "[setup] spindb $(spindb --version 2>/dev/null || echo "?"), node $(node --version)"

BINDIR="/work/.spindb/bin/mysql-${VERSION}-linux-x64"
mkdir -p "$BINDIR"
tar xf "/input/${TARBALL_NAME}" -C "$BINDIR" --strip-components=1
test -x "$BINDIR/bin/mysqld" || { echo "FAIL: mysqld not placed at $BINDIR/bin"; ls -R "$BINDIR" | head -20; exit 1; }
echo "[setup] placed minimal $(du -sm "$BINDIR" | cut -f1)MB | $("$BINDIR/bin/mysqld" --version)"

# Inner lifecycle runs as non-root (prod parity). ${VERSION} is baked in here.
cat > /work/inner.sh <<INNER
set -e
export SPINDB_HOME=/work/.spindb
export USER=node
echo "[e2e] spindb create + start"
spindb create appcon -e mysql --db-version ${VERSION} -d appdb -p 3399 --start -f --json
echo "[e2e] spindb query: seed 3 rows"
spindb query appcon "CREATE TABLE smoke(id INT PRIMARY KEY, marker INT); INSERT INTO smoke VALUES (1,111111),(2,222222),(3,333333);" -d appdb
echo "[e2e] spindb backup"
mkdir -p /work/backups
spindb backup appcon -d appdb -o /work/backups --json
echo "[e2e] spindb query: drop table"
spindb query appcon "DROP TABLE smoke;" -d appdb
echo "[e2e] locate backup file"
BK=\$(find /work /root /home/node -maxdepth 4 -type f \( -name "*.sql" -o -name "*.sql.gz" -o -name "*.dump" -o -name "*.dump.gz" \) 2>/dev/null | head -1)
echo "[e2e] backup file: \$BK"
test -n "\$BK"
echo "[e2e] spindb restore"
spindb restore appcon "\$BK" -d appdb -f --json
echo "[e2e] spindb query: verify (SUM of markers must be 666666)"
spindb query appcon "SELECT SUM(marker) FROM smoke;" -d appdb | tee /work/q.out
spindb stop appcon >/dev/null 2>&1 || true
INNER

chown -R node:node /work
echo "[run] executing spindb lifecycle as non-root user (node)"
su - node -c "bash /work/inner.sh"

# Guard: prove spindb used our minimal and did NOT silently download the full.
AFTER=$(du -sm "$BINDIR" | cut -f1)
echo "[check] binary dir after run: ${AFTER}MB (minimal ~450MB; full would be ~3GB)"
[ "$AFTER" -lt 800 ] || { echo "FAIL: binary grew to ${AFTER}MB - spindb downloaded the FULL build, test invalid"; exit 1; }

grep -q "666666" /work/q.out || { echo "FAIL: data did not survive restore"; echo "--- query output ---"; cat /work/q.out; exit 1; }
echo "SPINDB_E2E_OK"
'

set +e
docker run --rm --platform linux/amd64 \
  -v "$DIR":/input:ro \
  -e TARBALL_NAME="$NAME" -e VERSION="$VERSION" \
  node:22-bookworm bash -c "$OUTER"
STATUS=$?
set -e

echo
if [ "$STATUS" -eq 0 ]; then
  echo "=== PASS: spindb end-to-end works on the minimal $VERSION linux-x64 build ==="
else
  echo "=== FAIL (exit $STATUS) ===" >&2
fi
exit "$STATUS"
