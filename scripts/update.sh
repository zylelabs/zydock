#!/usr/bin/env bash

set -euo pipefail

ZYDOCK_INSTALL_DIR="${ZYDOCK_INSTALL_DIR:-/data/zydock}"
ZYDOCK_CHANNEL="${ZYDOCK_CHANNEL:-}"
ZYDOCK_BRANCH="${ZYDOCK_BRANCH:-}"
ZYDOCK_REF="${ZYDOCK_REF:-}"
ZYDOCK_FORCE="${ZYDOCK_FORCE:-false}"
ZYDOCK_BUILD="${ZYDOCK_BUILD:-0}"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;33m⚠ %s\033[0m\n' "$1" >&2; }
fail() {
  printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2
  exit 1
}

channel_image_tag() {
  case "$1" in
  stable) echo "latest" ;;
  nightly) echo "nightly" ;;
  *) echo "" ;;
  esac
}

fix_storage_permissions() {
  docker compose "${COMPOSE_ARGS[@]}" run --rm --no-deps --user 0:0 --entrypoint sh backend \
    -c 'mkdir -p /app/storage && chown -R zydock:zydock /app/storage' >/dev/null 2>&1 ||
    warn "Could not adjust the ownership of the backend storage volume. Backups and installation snapshots may fail to write.
  Fix it manually with:
    docker compose -f docker-compose.prod.yml run --rm --no-deps --user 0:0 --entrypoint sh backend -c 'chown -R zydock:zydock /app/storage'"
}

check_build_resources() {
  local mem_kb mem_mb disk_kb disk_mb

  mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  mem_mb="$((mem_kb / 1024))"

  disk_kb="$(df -Pk . 2>/dev/null | awk 'NR==2 {print $4}')"
  disk_mb="$((${disk_kb:-0} / 1024))"

  [ "${mem_mb}" -ge 2048 ] || fail "Building locally needs at least 2GB RAM (found ${mem_mb}MB). Unset ZYDOCK_BUILD to use the published images instead, or add swap."
  [ "${disk_mb}" -ge 4096 ] || fail "Building locally needs at least 4GB free disk (found ${disk_mb}MB free). Unset ZYDOCK_BUILD to use the published images instead, or free up space."
}

ensure_env() {
  local key="$1" value="$2"

  grep -q "^${key}=" .env 2>/dev/null || printf '%s="%s"\n' "${key}" "${value}" >>.env
}

set_env() {
  local key="$1" value="$2"

  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=\"${value}\"|" .env
  else
    printf '%s="%s"\n' "${key}" "${value}" >>.env
  fi
}

env_value() {
  local line
  line="$(grep -m1 "^$1=" .env 2>/dev/null || true)"
  line="${line#*=}"
  line="${line%\"}"

  printf '%s' "${line#\"}"
}

migrate_port_urls() {
  [ -f .env ] || return 0

  . ./.env
  local changed=false

  case "${APP_URL:-}" in
  *:3000)
    set_env APP_URL "${APP_URL%:3000}"
    changed=true
    ;;
  esac

  case "${CORS_ORIGIN:-}" in
  *:3000)
    set_env CORS_ORIGIN "${CORS_ORIGIN%:3000}"
    changed=true
    ;;
  esac

  case "${NUXT_PUBLIC_WS_URL:-}" in
  *:8000/api/ws)
    set_env NUXT_PUBLIC_WS_URL "${NUXT_PUBLIC_WS_URL%:8000/api/ws}/api/ws"
    changed=true
    ;;
  esac

  if [ "${changed}" = true ]; then
    log "Migrated .env off the published :3000/:8000 URLs"
  fi
}

[ "$(id -u)" -eq 0 ] || fail "Run as root (or with sudo)."
[ -d "${ZYDOCK_INSTALL_DIR}" ] || fail "${ZYDOCK_INSTALL_DIR} does not exist. Set ZYDOCK_INSTALL_DIR if Zydock was installed elsewhere, or install it with scripts/install.sh."

cd "${ZYDOCK_INSTALL_DIR}"

[ -f docker-compose.prod.yml ] || fail "${ZYDOCK_INSTALL_DIR} doesn't look like a Zydock install (no docker-compose.prod.yml). Set ZYDOCK_INSTALL_DIR."
[ -d .git ] || fail "${ZYDOCK_INSTALL_DIR} is not a git checkout — this install cannot be updated in place. Reinstall with scripts/install.sh."
[ -f .env ] || fail "${ZYDOCK_INSTALL_DIR}/.env is missing. Without it the stack would come back up with new secrets and lose access to the database — restore the file from your backup before updating."

command -v git >/dev/null 2>&1 || fail "git is not installed."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker compose version >/dev/null 2>&1 || fail "The 'docker compose' plugin is missing."

if [ -z "${ZYDOCK_CHANNEL}" ] && [ -z "${ZYDOCK_BRANCH}" ]; then
  ZYDOCK_CHANNEL="$(env_value ZYDOCK_CHANNEL)"
fi

export ZYDOCK_CHANNEL ZYDOCK_BRANCH

CHANNEL="$(bash scripts/version.sh channel)"
BRANCH="$(bash scripts/version.sh branch)"
IMAGE_TAG="$(channel_image_tag "${CHANNEL}")"

if [ -z "${IMAGE_TAG}" ] && [ "${ZYDOCK_BUILD}" != "1" ]; then
  warn "No published images for channel '${CHANNEL}' — building locally instead."
  ZYDOCK_BUILD=1
fi

export ZYDOCK_CHANNEL="${CHANNEL}"

CURRENT="$(git rev-parse HEAD)"

log "Fetching ${ZYDOCK_REF:-${CHANNEL}}"
git fetch --tags origin "${BRANCH}"

TARGET="${ZYDOCK_REF:-$(bash scripts/version.sh ref)}"

git rev-parse --verify --quiet "${TARGET}^{commit}" >/dev/null || fail "Could not resolve '${TARGET}' after fetching. Check ZYDOCK_REF/ZYDOCK_CHANNEL."
NEXT="$(git rev-parse "${TARGET}^{commit}")"

if [ "${CURRENT}" = "${NEXT}" ] && [ "${ZYDOCK_FORCE}" != "true" ]; then
  log "Already up to date"
  echo "Zydock is at $(git rev-parse --short HEAD) — nothing to do."
  echo "Run again with ZYDOCK_FORCE=true to rebuild and restart anyway."
  exit 0
fi

if [ "${CURRENT}" != "${NEXT}" ]; then
  echo
  git --no-pager log --oneline --no-decorate "${CURRENT}..${NEXT}" | head -n 20
fi

log "Updating the code to $(git rev-parse --short "${NEXT}")"
git reset --hard "${NEXT}"

ensure_env LOCAL_AGENT_TOKEN "$(openssl rand -hex 32)"
migrate_port_urls

export ZYDOCK_CHANNEL="${CHANNEL}"

set_env ZYDOCK_VERSION "$(bash scripts/version.sh)"
set_env ZYDOCK_COMMIT "$(bash scripts/version.sh commit)"
set_env ZYDOCK_CHANNEL "${CHANNEL}"
set_env ZYDOCK_INSTALL_DIR "${ZYDOCK_INSTALL_DIR}"
set_env ZYDOCK_IMAGE_TAG "${IMAGE_TAG}"

. ./.env

COMPOSE_ARGS=(-f docker-compose.prod.yml --env-file .env)

docker network inspect zydock >/dev/null 2>&1 || docker network create zydock

if [ "${ZYDOCK_BUILD}" = "1" ]; then
  log "Rebuilding the stack locally (ZYDOCK_BUILD=1)"
  check_build_resources
  docker compose "${COMPOSE_ARGS[@]}" up -d --build --remove-orphans
else
  log "Pulling published images and restarting the stack"
  docker compose "${COMPOSE_ARGS[@]}" up -d --pull always --remove-orphans
fi

log "Making sure the backend storage volume is writable"
fix_storage_permissions

log "Waiting for the backend to become healthy"
ATTEMPTS=0
until [ "$(docker compose "${COMPOSE_ARGS[@]}" ps --format '{{.Health}}' backend)" = "healthy" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "${ATTEMPTS}" -gt 60 ]; then
    warn "Backend did not become healthy in time. Check: docker compose -f docker-compose.prod.yml logs backend
  To roll back to the previous version:
    ZYDOCK_REF=${CURRENT} bash ${ZYDOCK_INSTALL_DIR}/scripts/update.sh"
    exit 1
  fi
  sleep 2
done

log "Cleaning up images left behind by the rebuild"
docker image prune -f >/dev/null 2>&1 || true

log "Done"
echo "Zydock updated: $(git rev-parse --short "${CURRENT}") → $(git rev-parse --short HEAD)"
echo "Now on ${ZYDOCK_VERSION} (channel: ${ZYDOCK_CHANNEL})"
echo "Dashboard: ${APP_URL}"
echo
echo "Secrets in .env and the data volumes were kept. To roll this back:"
echo "  ZYDOCK_REF=${CURRENT} bash ${ZYDOCK_INSTALL_DIR}/scripts/update.sh"
