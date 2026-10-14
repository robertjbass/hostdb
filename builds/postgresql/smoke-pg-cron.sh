#!/usr/bin/env bash
# Run as an unprivileged user inside the candidate packager image, with no network.
# This proves binary restart/stop behavior, not Cloud's idle-hibernation lifecycle.
set -euo pipefail

PG_ROOT="${1:-/opt/postgresql}"
export PATH="$PG_ROOT/bin:$PATH"
export LD_LIBRARY_PATH="$PG_ROOT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
FIXTURE_DIR=$(mktemp -d /tmp/c322-cron.XXXXXX)
export PGHOST="$FIXTURE_DIR"
export PGPORT=55432
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

query() { psql -X -v ON_ERROR_STOP=1 -Atqc "$1"; }
start() { pg_ctl -D "$DATA_DIR" -l "$FIXTURE_DIR/postgres.log" -w start; }
wait_for_count() {
  local expected="$1" deadline=$((SECONDS + 85))
  while [ "$(query 'SELECT count(*) FROM public.cron_sentinel')" -lt "$expected" ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      cat "$FIXTURE_DIR/postgres.log"
      echo "Timed out waiting for scheduled sentinel $expected" >&2
      return 1
    fi
    sleep 1
  done
}

test -s "$PG_ROOT/lib/pg_cron.so"
test -s "$PG_ROOT/share/extension/pg_cron.control"
test -s "$PG_ROOT/share/extension/pg_cron--1.0.sql"
test -s "$PG_ROOT/share/extension/pg_cron--1.5--1.6.sql"
initdb -D "$DATA_DIR" -U postgres --auth=trust --no-locale >/dev/null
cat >> "$DATA_DIR/postgresql.conf" <<EOF
listen_addresses = ''
unix_socket_directories = '$FIXTURE_DIR'
port = 55432
shared_preload_libraries = 'pg_stat_statements,pg_cron'
cron.database_name = 'postgres'
cron.use_background_workers = on
cron.max_running_jobs = 2
max_worker_processes = 8
EOF
start
query 'CREATE EXTENSION pg_cron; CREATE EXTENSION pg_stat_statements; CREATE EXTENSION "uuid-ossp";'
query "SELECT version(); SELECT extname || ':' || extversion FROM pg_extension ORDER BY extname; SHOW shared_preload_libraries; SHOW cron.use_background_workers;"
query "CREATE TABLE public.cron_sentinel (ran_at timestamptz NOT NULL DEFAULT clock_timestamp()); SELECT cron.schedule('c322-sentinel', '* * * * *', 'INSERT INTO public.cron_sentinel DEFAULT VALUES');"
wait_for_count 1
before_restart=$(query 'SELECT count(*) FROM public.cron_sentinel')
pg_ctl -D "$DATA_DIR" -m fast -w restart -l "$FIXTURE_DIR/postgres.log"
wait_for_count "$((before_restart + 1))"
query "SELECT status, count(*) FROM cron.job_run_details GROUP BY status; SELECT count(*) FROM pg_stat_statements; SELECT uuid_generate_v4() IS NOT NULL;"
before_stop=$(query 'SELECT count(*) FROM public.cron_sentinel')
pg_ctl -D "$DATA_DIR" -m fast -w stop
echo 'Stopped for 125 seconds across at least two scheduled ticks.'
sleep 125
if pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
  echo 'Database unexpectedly running during stopped interval' >&2
  exit 1
fi
start
sleep 5
after_resume=$(query 'SELECT count(*) FROM public.cron_sentinel')
if [ "$after_resume" -gt "$((before_stop + 1))" ]; then
  echo 'Unexpected catch-up executions immediately after restart' >&2
  exit 1
fi
wait_for_count "$((after_resume + 1))"
query "SELECT cron.unschedule('c322-sentinel'); SELECT count(*) AS executions FROM public.cron_sentinel;"
echo 'PASS: real scheduled SQL, preload coexistence, restart persistence, stopped interval, no immediate catch-up burst.'
echo 'NOT TESTED: managed idle hibernation, wake routing, branch/restore safety, production resource limits.'
