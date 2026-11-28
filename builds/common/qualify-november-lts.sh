#!/usr/bin/env bash
set -euo pipefail
engine=$1
version=$2
archive=$3
root=$(mktemp -d)
pid=''
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
tar -xzf "$archive" -C "$root"
base="$root/$engine"
data="$root/data"
socket="$root/db.sock"
mkdir -p "$data"
if [[ "$engine" == mariadb ]]; then
  init="$base/scripts/mariadb-install-db"
  [[ -f "$init" ]] || init="$base/bin/mariadb-install-db"
  bash "$init" --no-defaults --basedir="$base" --datadir="$data" --auth-root-authentication-method=normal
  start() {
    "$base/bin/mariadbd" --no-defaults --basedir="$base" --datadir="$data" --skip-networking --socket="$socket" --pid-file="$root/server.pid" --log-error="$root/server.log" &
    pid=$!
    for _ in {1..80}; do
      if "$base/bin/mariadb-admin" --no-defaults -S "$socket" -u root ping >/dev/null 2>&1; then return; fi
      sleep 1
    done
    cat "$root/server.log"; return 1
  }
  query() { "$base/bin/mariadb" --no-defaults -S "$socket" -u root -NB "$@"; }
  start
  actual=$(query -e 'SELECT VERSION()')
  [[ "$actual" == "$version"-MariaDB* ]]
  query -e 'CREATE DATABASE proof; CREATE TABLE proof.t(n INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO proof.t VALUES(271828)'
  "$base/bin/mariadb-dump" --no-defaults -S "$socket" -u root --single-transaction proof > "$root/proof.sql"
  query -e 'DROP TABLE proof.t'
  query proof < "$root/proof.sql"
  "$base/bin/mariadb-admin" --no-defaults -S "$socket" -u root shutdown
  wait "$pid"; pid=''
  start
  [[ "$(query -e 'SELECT n FROM proof.t')" == 271828 ]]
  "$base/bin/mariadb-admin" --no-defaults -S "$socket" -u root shutdown
  wait "$pid"; pid=''
else
  redis() { "$base/bin/redis-cli" -s "$socket" --raw "$@"; }
  start() {
    "$base/bin/redis-server" --port 0 --unixsocket "$socket" --dir "$data" --dbfilename dump.rdb --save '' > "$root/redis.log" 2>&1 &
    pid=$!
    for _ in {1..30}; do if [[ "$(redis ping 2>/dev/null)" == PONG ]]; then return; fi; sleep 1; done
    cat "$root/redis.log"; return 1
  }
  start
  redis info server | tr -d '\r' | grep -Fx "redis_version:$version"
  [[ "$(redis set proof 271828)" == OK ]]
  [[ "$(redis save)" == OK ]]
  cp "$data/dump.rdb" "$root/backup.rdb"
  [[ "$(redis del proof)" == 1 ]]
  redis shutdown nosave; wait "$pid"; pid=''
  cp "$root/backup.rdb" "$data/dump.rdb"
  start
  [[ "$(redis get proof)" == 271828 ]]
  redis shutdown nosave; wait "$pid"; pid=''
fi
echo "Verified $engine $version: server version, restored marker 271828 and restart."
