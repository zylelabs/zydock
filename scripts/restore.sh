#!/usr/bin/env bash

set -euo pipefail

ZYDOCK_INSTALL_DIR="${ZYDOCK_INSTALL_DIR:-/data/zydock}"
ZYDOCK_RESTORE="${ZYDOCK_RESTORE:-}"
ZYDOCK_RESTORE_PASSPHRASE="${ZYDOCK_RESTORE_PASSPHRASE:-}"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;33m⚠ %s\033[0m\n' "$1" >&2; }
fail() {
  printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2
  exit 1
}

env_value() {
  local line
  line="$(grep -m1 "^$1=" .env 2>/dev/null || true)"
  line="${line#*=}"
  line="${line%\"}"

  printf '%s' "${line#\"}"
}

set_env() {
  local key="$1" value="$2"

  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=\"${value}\"|" .env
  else
    printf '%s="%s"\n' "${key}" "${value}" >>.env
  fi
}

project_name() {
  local configured
  configured="$(env_value COMPOSE_PROJECT_NAME)"

  if [ -n "${configured}" ]; then
    printf '%s' "${configured}"
    return
  fi

  basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]/_/g; s/^[^a-z0-9]+//'
}

fix_storage_permissions() {
  docker compose "${COMPOSE_ARGS[@]}" run --rm --no-deps --user 0:0 --entrypoint sh backend \
    -c 'mkdir -p /app/storage && chown -R zydock:zydock /app/storage' >/dev/null 2>&1 ||
    warn "Could not adjust the ownership of the backend storage volume. Backups and installation snapshots may fail to write.
  Fix it manually with:
    docker compose -f docker-compose.prod.yml run --rm --no-deps --user 0:0 --entrypoint sh backend -c 'chown -R zydock:zydock /app/storage'"
}

mongo_auth_args() {
  local file="$1" username password uri

  username="$(grep -m1 '^MONGO_USERNAME=' "${file}" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  password="$(grep -m1 '^MONGO_PASSWORD=' "${file}" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"

  if [ -z "${username}" ] || [ -z "${password}" ]; then
    uri="$(grep -m1 '^MONGO_URI=' "${file}" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
    username="$(printf '%s' "${uri}" | sed -nE 's#^mongodb(\+srv)?://([^:@/]+):([^@/]+)@.*#\2#p')"
    password="$(printf '%s' "${uri}" | sed -nE 's#^mongodb(\+srv)?://([^:@/]+):([^@/]+)@.*#\3#p')"
  fi

  if [ -z "${username}" ] || [ -z "${password}" ]; then
    return 0
  fi

  printf '%s\n' --username "${username}" --password "${password}" --authenticationDatabase admin
}

restore_volume() {
  local volume="$1" archive="$2"

  [ -f "${archive}" ] || fail "The bundle is missing ${archive}."

  docker volume create "${volume}" >/dev/null
  docker run --rm \
    -v "${volume}:/target" \
    -v "$(dirname "${archive}")":/backup:ro \
    alpine:3 sh -c "tar xzf /backup/$(basename "${archive}") -C /target"
}

[ -n "${ZYDOCK_RESTORE}" ] || fail "ZYDOCK_RESTORE is required (path to the encrypted snapshot bundle)."
[ -n "${ZYDOCK_RESTORE_PASSPHRASE}" ] || fail "ZYDOCK_RESTORE_PASSPHRASE is required."
[ -f "${ZYDOCK_RESTORE}" ] || fail "${ZYDOCK_RESTORE} does not exist."
[ "$(id -u)" -eq 0 ] || fail "Run as root (or with sudo)."
[ -d "${ZYDOCK_INSTALL_DIR}" ] || fail "${ZYDOCK_INSTALL_DIR} does not exist. Set ZYDOCK_INSTALL_DIR if Zydock was installed elsewhere."

cd "${ZYDOCK_INSTALL_DIR}"

[ -f docker-compose.prod.yml ] || fail "${ZYDOCK_INSTALL_DIR} doesn't look like a Zydock install (no docker-compose.prod.yml)."
[ -f .env ] || fail "${ZYDOCK_INSTALL_DIR}/.env is missing — this installation was not set up correctly."

command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker compose version >/dev/null 2>&1 || fail "The 'docker compose' plugin is missing."

. ./.env

COMPOSE_ARGS=(-f docker-compose.prod.yml --env-file .env)
DESTINATION_PUBLIC_IP="$(env_value PUBLIC_IP)"
AGENT_IMAGE="${ZYDOCK_IMAGE_REGISTRY:-ghcr.io/zylelabs}/zydock-agent:${ZYDOCK_IMAGE_TAG:-latest}"

BUNDLE_DIR="$(cd "$(dirname "${ZYDOCK_RESTORE}")" && pwd)"
BUNDLE_NAME="$(basename "${ZYDOCK_RESTORE}")"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

log "Decrypting and unpacking the snapshot bundle"
docker run --rm \
  -v "${BUNDLE_DIR}":/bundle:ro \
  -v "${WORK_DIR}":/work \
  -e ZYDOCK_RESTORE_PASSPHRASE \
  "${AGENT_IMAGE}" \
  bun /app/restore-cli.ts unpack "/bundle/${BUNDLE_NAME}" /work

[ -f "${WORK_DIR}/manifest.json" ] || fail "The bundle has no manifest.json — it may be corrupt or the passphrase may be wrong."
[ -f "${WORK_DIR}/.env" ] || fail "The bundle has no .env — it cannot restore secrets."
[ -f "${WORK_DIR}/mongodump.archive.gz" ] || fail "The bundle has no Mongo dump."

log "Bundle manifest"
cat "${WORK_DIR}/manifest.json"

PROJECT="$(project_name)"
[ -n "${PROJECT}" ] || PROJECT="zydock"

log "Bringing the empty destination stack down — its volumes are discarded"
docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans

log "Restoring the core volumes"
restore_volume "${PROJECT}_backend-storage" "${WORK_DIR}/volumes/backend-storage.tar.gz"
restore_volume "${PROJECT}_caddy-data" "${WORK_DIR}/volumes/caddy-data.tar.gz"
restore_volume "${PROJECT}_caddy-config" "${WORK_DIR}/volumes/caddy-config.tar.gz"

if [ -d "${WORK_DIR}/volumes/application" ]; then
  log "Restoring application and database volumes carried by the bundle"
  for archive in "${WORK_DIR}"/volumes/application/*.tar.gz; do
    [ -f "${archive}" ] || continue
    restore_volume "$(basename "${archive}" .tar.gz)" "${archive}"
  done
fi

log "Starting Mongo to restore the database dump"
docker volume create "${PROJECT}_mongo-data" >/dev/null
docker compose "${COMPOSE_ARGS[@]}" up -d mongo

ATTEMPTS=0
until [ "$(docker compose "${COMPOSE_ARGS[@]}" ps --format '{{.Health}}' mongo)" = "healthy" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [ "${ATTEMPTS}" -le 60 ] || fail "Mongo did not become healthy in time."
  sleep 2
done

log "Restoring the Mongo dump (this replaces the fresh admin user with the origin's)"
mapfile -t LOCAL_MONGO_AUTH < <(mongo_auth_args .env)
docker compose "${COMPOSE_ARGS[@]}" exec -T mongo mongorestore \
  --archive --gzip --drop \
  ${LOCAL_MONGO_AUTH[@]+"${LOCAL_MONGO_AUTH[@]}"} \
  <"${WORK_DIR}/mongodump.archive.gz"

mapfile -t BUNDLE_MONGO_AUTH < <(mongo_auth_args "${WORK_DIR}/.env")

log "Marking the restored installation as standby before it ever comes fully up"
docker compose "${COMPOSE_ARGS[@]}" exec -T mongo mongosh --quiet \
  ${BUNDLE_MONGO_AUTH[@]+"${BUNDLE_MONGO_AUTH[@]}"} \
  zydock --eval "db.installations.updateOne({}, { \$set: { role: 'standby', standbySince: new Date() } }, { upsert: true })"

log "Writing the restored .env, keeping this host's PUBLIC_IP"
cp "${WORK_DIR}/.env" .env
[ -z "${DESTINATION_PUBLIC_IP}" ] || set_env PUBLIC_IP "${DESTINATION_PUBLIC_IP}"
set_env ZYDOCK_INSTALL_DIR "${ZYDOCK_INSTALL_DIR}"

. ./.env

log "Bringing the restored stack up"
docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans

log "Making sure the backend storage volume is writable"
fix_storage_permissions

log "Waiting for the backend to become healthy"
ATTEMPTS=0
until [ "$(docker compose "${COMPOSE_ARGS[@]}" ps --format '{{.Health}}' backend)" = "healthy" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [ "${ATTEMPTS}" -le 60 ] || fail "Backend did not become healthy in time. Check: docker compose -f docker-compose.prod.yml logs backend"
  sleep 2
done

log "Done"
echo "Zydock restored from ${BUNDLE_NAME} — this installation is in standby, with data from the origin."
echo "Dashboard: ${APP_URL}"
