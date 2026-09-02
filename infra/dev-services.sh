#!/usr/bin/env bash
# Start the local dev services on this machine (no Docker): Postgres 16 cluster "pal" on 5433 and Redis on 6379.
# Idempotent — safe to run any time; used by agents and check-ins after a container restart.
set -e
if pg_lsclusters 2>/dev/null | grep -q '^16 *pal '; then
  pg_lsclusters | grep '^16 *pal ' | grep -q online || pg_ctlcluster 16 pal start
else
  pg_createcluster 16 pal --port 5433 --start >/dev/null
fi
su postgres -c "psql -p 5433 -tAc \"SELECT 1 FROM pg_roles WHERE rolname='pal'\"" | grep -q 1 \
  || su postgres -c "psql -p 5433 -c \"CREATE ROLE pal LOGIN SUPERUSER PASSWORD 'pal'\"" >/dev/null
su postgres -c "psql -p 5433 -tAc \"SELECT 1 FROM pg_database WHERE datname='palscans'\"" | grep -q 1 \
  || su postgres -c "psql -p 5433 -c 'CREATE DATABASE palscans OWNER pal'" >/dev/null
redis-cli -p 6379 ping >/dev/null 2>&1 || redis-server --daemonize yes --port 6379 --save "" --appendonly no >/dev/null
echo "postgres: $(pg_lsclusters | grep '^16 *pal ' | awk '{print $4}') on 5433 · redis: $(redis-cli -p 6379 ping)"
