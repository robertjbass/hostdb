#!/usr/bin/env bash
# Run as an unprivileged user inside the candidate packager image, with no
# network, against the extracted archive mounted somewhere OTHER than
# /opt/postgresql, so nothing can resolve through a build-time path.
#
# Usage: smoke-postgis.sh <postgresql-root>
# Env:   EXPECTED_POSTGIS, EXPECTED_GEOS, EXPECTED_PROJ (from `postgis.sh pins`)
#
# PROJ_DATA and PROJ_LIB are deliberately unset: the archive must find
# share/proj/proj.db relative to its own lib/libproj.so, because neither spindb
# nor Cloud exports either variable.
set -euo pipefail

PG_ROOT="${1:?Usage: smoke-postgis.sh <postgresql-root>}"
: "${EXPECTED_POSTGIS:?Set EXPECTED_POSTGIS from postgis.sh pins}"
: "${EXPECTED_GEOS:?Set EXPECTED_GEOS from postgis.sh pins}"
: "${EXPECTED_PROJ:?Set EXPECTED_PROJ from postgis.sh pins}"

unset PROJ_DATA PROJ_LIB LD_LIBRARY_PATH
export PATH="$PG_ROOT/bin:$PATH"
FIXTURE_DIR=$(mktemp -d /tmp/postgis-smoke.XXXXXX)
export PGHOST="$FIXTURE_DIR"
export PGPORT=55433
export PGUSER=postgres
export PGDATABASE=postgres
DATA_DIR="$FIXTURE_DIR/data"

cleanup() {
  if [ -f "$DATA_DIR/postmaster.pid" ]; then
    pg_ctl -D "$DATA_DIR" -m fast -w stop || return 1
  fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  if [ -f "$FIXTURE_DIR/postgres.log" ]; then
    cat "$FIXTURE_DIR/postgres.log" >&2
  fi
  exit 1
}
query() { psql -X -v ON_ERROR_STOP=1 -Atqc "$1"; }
query_db() { psql -X -v ON_ERROR_STOP=1 -Atq -d "$1" -c "$2"; }
expect() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" != "$expected" ]; then
    fail "$label: expected '$expected', got '$actual'"
  fi
  echo "ok: $label"
}

test -z "${PROJ_DATA:-}" || fail "PROJ_DATA must be unset"
test -z "${PROJ_LIB:-}" || fail "PROJ_LIB must be unset"
test -s "$PG_ROOT/lib/postgis-3.so" || fail "lib/postgis-3.so missing"
test -s "$PG_ROOT/share/proj/proj.db" || fail "share/proj/proj.db missing"
test -s "$PG_ROOT/lib/pg_cron.so" || fail "lib/pg_cron.so missing"

initdb -D "$DATA_DIR" -U postgres --auth=trust --no-locale >/dev/null
cat >>"$DATA_DIR/postgresql.conf" <<EOF
listen_addresses = ''
unix_socket_directories = '$FIXTURE_DIR'
port = $PGPORT
shared_preload_libraries = 'pg_stat_statements,pg_cron'
cron.database_name = 'postgres'
cron.use_background_workers = on
cron.max_running_jobs = 2
max_worker_processes = 8
EOF
pg_ctl -D "$DATA_DIR" -l "$FIXTURE_DIR/postgres.log" -w start

# Extension availability: core postgis only.
expect "postgis is available" \
  "$(query "SELECT default_version FROM pg_available_extensions WHERE name = 'postgis'")" \
  "$EXPECTED_POSTGIS"
expect "no excluded PostGIS components are available" \
  "$(query "SELECT count(*) FROM pg_available_extensions WHERE name IN ('postgis_raster','postgis_topology','postgis_tiger_geocoder','address_standardizer','address_standardizer_data_us','postgis_sfcgal')")" \
  "0"

query 'CREATE EXTENSION postgis; CREATE EXTENSION pg_cron;'

FULL_VERSION=$(query 'SELECT postgis_full_version()')
echo "postgis_full_version: $FULL_VERSION"
case "$FULL_VERSION" in *"POSTGIS=\"$EXPECTED_POSTGIS\""* | *"POSTGIS=\"$EXPECTED_POSTGIS "*) ;; *) fail "postgis_full_version does not report PostGIS $EXPECTED_POSTGIS" ;; esac
case "$FULL_VERSION" in *"GEOS=\"$EXPECTED_GEOS-"*) ;; *) fail "postgis_full_version does not report GEOS $EXPECTED_GEOS" ;; esac
case "$FULL_VERSION" in *"PROJ=\"$EXPECTED_PROJ "*) ;; *) fail "postgis_full_version does not report PROJ $EXPECTED_PROJ" ;; esac
case "$FULL_VERSION" in *"NETWORK_ENABLED=OFF"*) ;; *) fail "PROJ network access must be off" ;; esac
case "$FULL_VERSION" in *"DATABASE_PATH=$PG_ROOT/share/proj/proj.db"*) ;; *) fail "PROJ did not resolve proj.db inside the archive ($PG_ROOT/share/proj/proj.db)" ;; esac
case "$FULL_VERSION" in *LIBPROTOBUF=*) ;; *) fail "PostGIS was built without protobuf (ST_AsMVT)" ;; esac
case "$FULL_VERSION" in *LIBJSON=*) ;; *) fail "PostGIS was built without json-c (ST_GeomFromGeoJSON)" ;; esac
case "$FULL_VERSION" in *GDAL*|*RASTER*|*TOPOLOGY*|*SFCGAL*) fail "postgis_full_version reports an excluded component" ;; esac
echo "ok: postgis_full_version"

# Geometry and geography round trips.
expect "geometry WKT round trip" \
  "$(query "SELECT ST_AsText(ST_GeomFromText('POLYGON((0 0,4 0,4 4,0 4,0 0))', 4326))")" \
  "POLYGON((0 0,4 0,4 4,0 4,0 0))"
expect "geometry EWKB round trip" \
  "$(query "SELECT ST_AsEWKT(ST_GeomFromEWKB(ST_AsEWKB('SRID=4326;LINESTRING(1 2,3 4)'::geometry)))")" \
  "SRID=4326;LINESTRING(1 2,3 4)"
expect "geography round trip" \
  "$(query "SELECT ST_AsText('SRID=4326;POINT(-0.1278 51.5074)'::geography)")" \
  "POINT(-0.1278 51.5074)"
# Empire State Building to Trafalgar Square on the WGS84 spheroid: 5,581.4 km (Vincenty).
expect "geodesic distance" \
  "$(query "SELECT round(ST_Distance('SRID=4326;POINT(-73.9857 40.7484)'::geography, 'SRID=4326;POINT(-0.1278 51.5074)'::geography) / 1000) BETWEEN 5579 AND 5584")" \
  "t"

# ST_Transform needs proj.db for both CRS definitions.
expect "ST_Transform 4326 -> 3857" \
  "$(query "SELECT abs(ST_X(p) - (-14226.6309)) < 0.01 AND abs(ST_Y(p) - 6711542.4756) < 0.01 FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326), 3857) AS p) t")" \
  "t"
expect "ST_Transform 3857 -> 4326 round trip" \
  "$(query "SELECT abs(ST_X(p) - (-0.1278)) < 1e-9 AND abs(ST_Y(p) - 51.5074) < 1e-9 FROM (SELECT ST_Transform(ST_Transform(ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326), 3857), 4326) AS p) t")" \
  "t"

# Vector tiles (protobuf-c) and GeoJSON (json-c). Tile 10/511/340 contains the point.
expect "ST_AsMVT" \
  "$(query "SELECT octet_length(ST_AsMVT(q, 'layer', 4096, 'geom')) > 0 FROM (SELECT 1 AS id, ST_AsMVTGeom(ST_Transform(ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326), 3857), ST_TileEnvelope(10, 511, 340)) AS geom) q WHERE geom IS NOT NULL")" \
  "t"
expect "ST_GeomFromGeoJSON" \
  "$(query "SELECT ST_AsText(ST_GeomFromGeoJSON('{\"type\":\"Point\",\"coordinates\":[1.5,2.5]}'))")" \
  "POINT(1.5 2.5)"
expect "ST_AsGeoJSON" \
  "$(query "SELECT ST_AsGeoJSON('POINT(1.5 2.5)'::geometry)")" \
  '{"type":"Point","coordinates":[1.5,2.5]}'

# A GiST index is built and used, and agrees with a sequential scan.
query 'CREATE DATABASE gis;'
query_db gis 'CREATE EXTENSION postgis;'
query_db gis "CREATE TABLE places (id int PRIMARY KEY, name text NOT NULL, geom geometry(Point, 4326) NOT NULL, geog geography(Point, 4326) NOT NULL);
INSERT INTO places SELECT g, 'p' || g, ST_SetSRID(ST_MakePoint((g % 360) - 180 + 0.5, (g % 170) - 85 + 0.25), 4326), ST_SetSRID(ST_MakePoint((g % 360) - 180 + 0.5, (g % 170) - 85 + 0.25), 4326)::geography FROM generate_series(1, 5000) AS g;
CREATE INDEX places_geom_gist ON places USING gist (geom);
CREATE INDEX places_geog_gist ON places USING gist (geog);
ANALYZE places;"
BOX_PREDICATE="geom && ST_MakeEnvelope(-10, -10, 10, 10, 4326)"
SEQ_COUNT=$(query_db gis "SET enable_indexscan = off; SET enable_bitmapscan = off; SELECT count(*) FROM places WHERE $BOX_PREDICATE")
PLAN=$(query_db gis "SET enable_seqscan = off; EXPLAIN SELECT count(*) FROM places WHERE $BOX_PREDICATE")
case "$PLAN" in *places_geom_gist*) ;; *) fail "the GiST index was not used: $PLAN" ;; esac
expect "GiST index result matches a sequential scan" \
  "$(query_db gis "SET enable_seqscan = off; SELECT count(*) FROM places WHERE $BOX_PREDICATE")" \
  "$SEQ_COUNT"
test "$SEQ_COUNT" -gt 0 || fail "the GiST comparison matched no rows, so it proves nothing"

# pg_dump / pg_restore of a geometry table, extension included.
CHECKSUM_SQL="SELECT md5(string_agg(id || ':' || encode(ST_AsEWKB(geom), 'hex') || ':' || encode(ST_AsEWKB(geog::geometry), 'hex'), ',' ORDER BY id)) FROM places"
BEFORE=$(query_db gis "$CHECKSUM_SQL")
pg_dump -Fc -d gis -f "$FIXTURE_DIR/gis.dump"
query 'CREATE DATABASE gis_restored;'
pg_restore --exit-on-error -d gis_restored "$FIXTURE_DIR/gis.dump"
expect "pg_restore reproduces every geometry" "$(query_db gis_restored "$CHECKSUM_SQL")" "$BEFORE"
expect "pg_restore recreates the GiST index" \
  "$(query_db gis_restored "SELECT count(*) FROM pg_indexes WHERE indexname IN ('places_geom_gist', 'places_geog_gist')")" \
  "2"
expect "restored ST_Transform" \
  "$(query_db gis_restored "SELECT ST_SRID(ST_Transform(geom, 3857)) FROM places WHERE id = 1")" \
  "3857"

# pg_cron still loads alongside PostGIS, and a scheduled job can call PostGIS
# from a background worker.
query 'CREATE TABLE public.postgis_cron_sentinel (x double precision NOT NULL);'
query "SELECT cron.schedule('postgis-smoke', '2 seconds', \$\$INSERT INTO public.postgis_cron_sentinel SELECT ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(1, 1), 4326), 3857))\$\$)" >/dev/null
deadline=$((SECONDS + 60))
while [ "$(query 'SELECT count(*) FROM public.postgis_cron_sentinel')" -lt 1 ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    query "SELECT status, return_message FROM cron.job_run_details ORDER BY runid DESC LIMIT 5" >&2
    fail "the pg_cron job calling PostGIS never completed"
  fi
  sleep 1
done
query "SELECT cron.unschedule('postgis-smoke')" >/dev/null
expect "pg_cron job result" \
  "$(query 'SELECT bool_and(abs(x - 111319.4908) < 0.01) FROM public.postgis_cron_sentinel')" \
  "t"
expect "shared_preload_libraries" "$(query 'SHOW shared_preload_libraries')" "pg_stat_statements,pg_cron"

echo "PASS: PostGIS $EXPECTED_POSTGIS (GEOS $EXPECTED_GEOS, PROJ $EXPECTED_PROJ) with PROJ_DATA unset: availability, full version, geometry and geography round trips, ST_Transform, ST_AsMVT, GeoJSON, GiST, pg_dump/pg_restore, pg_cron coexistence."
echo "NOT TESTED: datum shifts that need grid files (PROJ is built without network and TIFF), managed hibernation, Cloud store swap."
