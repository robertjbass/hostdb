#!/usr/bin/env bash
# Synthetic dump/restore using the candidate archive, never a customer cluster.
set -euo pipefail
PG_ROOT="${1:?Usage: smoke-pgvector.sh <postgresql-root>}"
export PATH="$PG_ROOT/bin:$PATH"
FIXTURE_DIR=$(mktemp -d /tmp/pgvector-smoke.XXXXXX)
export PGHOST="$FIXTURE_DIR" PGPORT=55439 PGUSER=postgres PGDATABASE=postgres
cleanup() {
    if [[ -f "$FIXTURE_DIR/data/postmaster.pid" ]]; then
        pg_ctl -D "$FIXTURE_DIR/data" -m fast -w stop
    fi
    rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT
initdb -D "$FIXTURE_DIR/data" -U postgres --auth=trust --no-locale >/dev/null
cat >> "$FIXTURE_DIR/data/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$FIXTURE_DIR'
port = $PGPORT
max_parallel_maintenance_workers = 0
CONF
pg_ctl -D "$FIXTURE_DIR/data" -l "$FIXTURE_DIR/postgres.log" -w start
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE vector_source;
CREATE DATABASE vector_target;
\connect vector_source
CREATE SCHEMA extensions;
CREATE EXTENSION vector WITH SCHEMA extensions;
SET search_path = public, extensions;
CREATE TABLE documents (id int PRIMARY KEY, embedding extensions.vector(1536));
INSERT INTO documents SELECT i, array_fill(i::real, ARRAY[1536])::vector FROM generate_series(1, 20) i;
CREATE INDEX documents_hnsw ON documents USING hnsw (embedding vector_l2_ops);
CREATE INDEX documents_ivfflat ON documents USING ivfflat (embedding vector_l2_ops) WITH (lists=1);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_read ON documents FOR SELECT USING (id > 0);
CREATE DOMAIN embedding_domain AS extensions.vector(1536);
CREATE TABLE representations (v embedding_domain, h extensions.halfvec(3), s extensions.sparsevec(3), vectors extensions.vector(3)[]);
INSERT INTO representations VALUES (array_fill(1::real, ARRAY[1536])::vector, '[1,2,3]', '{1:1,3:2}/3', ARRAY['[1,2,3]'::vector]);
SQL
pg_dump -Fc -d vector_source -f "$FIXTURE_DIR/vector.dump"
pg_restore --exit-on-error -d vector_target "$FIXTURE_DIR/vector.dump"
for db in vector_source vector_target; do
    psql -X -v ON_ERROR_STOP=1 -At -d "$db" > "$FIXTURE_DIR/$db.result" <<'SQL'
SET search_path = public, extensions;
SELECT md5(string_agg(id::text || embedding::text, ',' ORDER BY id)) FROM documents;
SELECT v::text, h::text, s::text, vectors::text FROM representations;
SELECT indexname FROM pg_indexes WHERE tablename='documents' ORDER BY indexname;
SELECT policyname, qual FROM pg_policies WHERE tablename='documents';
SELECT relrowsecurity FROM pg_class WHERE oid='documents'::regclass;
SELECT id FROM documents ORDER BY embedding <-> array_fill(1::real, ARRAY[1536])::vector LIMIT 1;
SQL
done
cmp "$FIXTURE_DIR/vector_source.result" "$FIXTURE_DIR/vector_target.result"
[[ "$(psql -X -At -d vector_target -c 'SELECT count(*) FROM documents')" = 20 ]]
echo 'PASS: pgvector types, data, HNSW/IVFFlat indexes, domains, RLS and nearest-neighbor query survive restore.'
