#!/usr/bin/env bash
set -euo pipefail

# This runner starts a disposable, network-isolated local database. It never reads
# app credentials, connects to Supabase, publishes a port, or mounts customer data.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"
container_name="perfect-tours-feedback-postgres-test-$$-$RANDOM"
image="postgres:17-alpine"
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/perfect-tours-db-test.XXXXXX")"

db_docker() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}

cleanup() {
  db_docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf -- "$log_dir"
}
trap cleanup EXIT INT TERM

db_docker info --format '{{.ServerVersion}}' >/dev/null
if ! db_docker image inspect "$image" >/dev/null 2>&1; then
  db_docker pull "$image"
fi
db_docker run --detach --rm --name "$container_name" --network none \
  -e POSTGRES_PASSWORD=synthetic-local-database-test-only \
  -e POSTGRES_DB=feedback_test "$image" >/dev/null

ready=false
for _ in {1..60}; do
  if db_docker exec "$container_name" psql -X -U postgres -d feedback_test -c 'SELECT 1' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  db_docker logs "$container_name"
  echo 'Disposable PostgreSQL test database did not become ready.' >&2
  exit 1
fi

run_sql() {
  local database_name="$1"
  db_docker exec -i "$container_name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database_name"
}

run_sql feedback_test < "$repo_dir/test/database/fixture.sql"
run_sql feedback_test < "$repo_dir/supabase/migrations/20261106064512_feedback.sql"
run_sql feedback_test < "$repo_dir/test/database/assertions.sql"

# A failed preflight must leave every feedback object unapplied.
for scenario in rls_disabled wrong_itinerary_type; do
  database_name="feedback_preflight_$scenario"
  db_docker exec "$container_name" createdb -U postgres "$database_name"
  # Fixture roles are cluster-wide and already exist in the main database.
  sed '/^CREATE ROLE anon NOLOGIN;$/d; /^CREATE ROLE authenticated NOLOGIN;$/d' \
    "$repo_dir/test/database/fixture.sql" | run_sql "$database_name"
  if [[ "$scenario" == rls_disabled ]]; then
    run_sql "$database_name" <<'SQL'
ALTER TABLE public.trips DISABLE ROW LEVEL SECURITY;
SQL
  else
    run_sql "$database_name" <<'SQL'
ALTER TABLE public.trips ALTER COLUMN itinerary TYPE text USING itinerary::text;
SQL
  fi
  if run_sql "$database_name" < "$repo_dir/supabase/migrations/20261106064512_feedback.sql" >"$log_dir/$scenario.log" 2>&1; then
    echo "Expected migration preflight to reject $scenario." >&2
    exit 1
  fi
  remaining="$(run_sql "$database_name" <<'SQL'
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname LIKE 'pt_feedback_%';
SQL
  )"
  if [[ "$remaining" != *'0'* ]]; then
    echo "Preflight failure left feedback objects behind: $scenario" >&2
    exit 1
  fi
  echo "PASS: migration preflight fails atomically for $scenario"
done
echo 'Disposable local PostgreSQL feedback checks passed.'
