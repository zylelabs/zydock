#!/usr/bin/env bash

set -euo pipefail

ZYDOCK_INSTALL_DIR="${ZYDOCK_INSTALL_DIR:-/data/zydock}"
ZYDOCK_KEEP_DIR="${ZYDOCK_KEEP_DIR:-false}"
ZYDOCK_YES="${ZYDOCK_YES:-false}"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;33m⚠ %s\033[0m\n' "$1"; }
fail() {
  printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "Run as root (or with sudo)."
[ -d "${ZYDOCK_INSTALL_DIR}" ] || fail "${ZYDOCK_INSTALL_DIR} does not exist. Set ZYDOCK_INSTALL_DIR if Zydock was installed elsewhere."

cd "${ZYDOCK_INSTALL_DIR}"

[ -f docker-compose.prod.yml ] || fail "${ZYDOCK_INSTALL_DIR} doesn't look like a Zydock install (no docker-compose.prod.yml). Set ZYDOCK_INSTALL_DIR."

if [ "${ZYDOCK_YES}" != "true" ]; then
  warn "This removes the Zydock containers, networks and volumes (database, storage, certificates) and the ${ZYDOCK_INSTALL_DIR} directory (code and .env secrets)."
  read -r -p "Type 'yes' to continue: " CONFIRM </dev/tty || fail "No TTY to confirm — re-run with ZYDOCK_YES=true to skip the prompt."
  [ "${CONFIRM}" = "yes" ] || fail "Aborted."
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_ARGS=(-f docker-compose.prod.yml)

  if [ -f .env ]; then
    COMPOSE_ARGS+=(--env-file .env)
    . ./.env
    [ -n "${ZYDOCK_DOMAIN:-}" ] && COMPOSE_ARGS+=(--profile domain)
  fi

  log "Stopping and removing containers, networks and volumes"
  docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans || warn "docker compose down reported an error — continuing"

  log "Removing built images"
  IMAGES="$(docker compose "${COMPOSE_ARGS[@]}" config --images 2>/dev/null | grep -v -E '^(mongo|caddy):' || true)"
  if [ -n "${IMAGES}" ]; then
    echo "${IMAGES}" | xargs -r docker rmi >/dev/null 2>&1 || true
  fi
else
  warn "Docker not available — skipping container/volume cleanup"
fi

if [ "${ZYDOCK_KEEP_DIR}" != "true" ]; then
  log "Removing ${ZYDOCK_INSTALL_DIR}"
  cd /
  rm -rf "${ZYDOCK_INSTALL_DIR}"
else
  log "Keeping ${ZYDOCK_INSTALL_DIR} (ZYDOCK_KEEP_DIR=true)"
fi

log "Done"
echo "Zydock has been removed from this server."
echo "Docker itself was left installed. DNS records for any domain pointed here were not touched."
