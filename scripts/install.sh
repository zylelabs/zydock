#!/usr/bin/env bash

set -euo pipefail

ZYDOCK_INSTALL_DIR="${ZYDOCK_INSTALL_DIR:-/data/zydock}"
ZYDOCK_REPO="${ZYDOCK_REPO:-https://github.com/zylelabs/zydock.git}"
ZYDOCK_CHANNEL="${ZYDOCK_CHANNEL:-}"
ZYDOCK_BRANCH="${ZYDOCK_BRANCH:-}"
ZYDOCK_DOMAIN="${ZYDOCK_DOMAIN:-}"
ZYDOCK_HOST="${ZYDOCK_HOST:-}"
ZYDOCK_BUILD="${ZYDOCK_BUILD:-0}"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;33m⚠ %s\033[0m\n' "$1" >&2; }
fail() {
  printf '\n\033[1;31m✖ %s\033[0m\n' "$1" >&2
  exit 1
}

is_private_ipv4() {
  local ip="$1" a b
  a="${ip%%.*}"
  b="$(echo "${ip}" | cut -d. -f2)"

  case "${a}" in
  10 | 127 | 0) return 0 ;;
  169) [ "${b}" = 254 ] && return 0 ;;
  172) [ "${b}" -ge 16 ] 2>/dev/null && [ "${b}" -le 31 ] && return 0 ;;
  192) [ "${b}" = 168 ] && return 0 ;;
  100) [ "${b}" -ge 64 ] 2>/dev/null && [ "${b}" -le 127 ] && return 0 ;;
  esac

  return 1
}

detect_public_ip() {
  local ip_regex='^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
  local candidate="" addr host

  while read -r addr; do
    if [ -n "${addr}" ] && ! is_private_ipv4 "${addr}"; then
      candidate="${addr}"
      break
    fi
  done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1)

  if [ -z "${candidate}" ] && command -v dig >/dev/null 2>&1; then
    candidate="$(dig +short myip.opendns.com @resolver1.opendns.com 2>/dev/null | tail -n1 | tr -d '[:space:]')"
  fi

  if [ -z "${candidate}" ]; then
    for host in https://checkip.amazonaws.com https://icanhazip.com https://api.ipify.org; do
      candidate="$(curl -fsS "${host}" 2>/dev/null | tr -d '[:space:]')"
      [ -n "${candidate}" ] && break
    done
  fi

  echo "${candidate}" | grep -qE "${ip_regex}" && echo "${candidate}"
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

channel_branch() {
  case "$1" in
  stable) echo "main" ;;
  nightly) echo "nightly" ;;
  dev) echo "dev" ;;
  *) echo "$1" ;;
  esac
}

channel_ref() {
  if [ "$1" != "stable" ]; then
    echo "origin/$(channel_branch "$1")"
    return
  fi

  local tag
  tag="$(git tag --list 'v*' | { grep -Ev -- '-' || true; } | sort -V | tail -n1)"

  if [ -n "${tag}" ]; then
    echo "${tag}"
  else
    echo "origin/main"
  fi
}

channel_image_tag() {
  case "$1" in
  stable) echo "latest" ;;
  nightly) echo "nightly" ;;
  *) echo "" ;;
  esac
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

if [ -z "${ZYDOCK_CHANNEL}" ] && [ -n "${ZYDOCK_BRANCH}" ]; then
  case "${ZYDOCK_BRANCH}" in
  main) ZYDOCK_CHANNEL="stable" ;;
  *) ZYDOCK_CHANNEL="${ZYDOCK_BRANCH}" ;;
  esac
fi

CHANNEL="${ZYDOCK_CHANNEL:-stable}"
BRANCH="$(channel_branch "${CHANNEL}")"
IMAGE_TAG="$(channel_image_tag "${CHANNEL}")"

if [ -z "${IMAGE_TAG}" ] && [ "${ZYDOCK_BUILD}" != "1" ]; then
  warn "No published images for channel '${CHANNEL}' — building locally instead."
  ZYDOCK_BUILD=1
fi

[ "$(id -u)" -eq 0 ] || fail "Run as root (or with sudo)."
command -v apt-get >/dev/null 2>&1 || fail "This installer only supports Debian/Ubuntu (needs apt-get)."

log "Installing prerequisites"

if ! command -v git >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git openssl curl
fi

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/zydock-get-docker.sh
  sh /tmp/zydock-get-docker.sh
  rm -f /tmp/zydock-get-docker.sh
  systemctl enable --now docker
fi

docker compose version >/dev/null 2>&1 || fail "Docker was installed but the 'docker compose' plugin is missing."

log "Fetching Zydock (${CHANNEL}) into ${ZYDOCK_INSTALL_DIR}"

if [ ! -d "${ZYDOCK_INSTALL_DIR}/.git" ]; then
  if [ -d "${ZYDOCK_INSTALL_DIR}" ] && [ -n "$(ls -A "${ZYDOCK_INSTALL_DIR}")" ]; then
    fail "${ZYDOCK_INSTALL_DIR} already exists and is not a Zydock install. Remove it or set ZYDOCK_INSTALL_DIR."
  fi

  mkdir -p "$(dirname "${ZYDOCK_INSTALL_DIR}")"
  git clone --branch "${BRANCH}" "${ZYDOCK_REPO}" "${ZYDOCK_INSTALL_DIR}"
fi

cd "${ZYDOCK_INSTALL_DIR}"

git fetch --tags origin "${BRANCH}"
git reset --hard "$(channel_ref "${CHANNEL}")"

NEW_INSTALL=false

if [ ! -f .env ]; then
  NEW_INSTALL=true
  log "Generating secrets"

  ZYDOCK_HOST="${ZYDOCK_HOST:-$(detect_public_ip || true)}"
  [ -n "${ZYDOCK_HOST}" ] || [ -n "${ZYDOCK_DOMAIN}" ] || fail "Could not autodetect the public IP — set ZYDOCK_HOST or ZYDOCK_DOMAIN explicitly."

  MONGO_USERNAME="zydock"
  MONGO_PASSWORD="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  LOCAL_AGENT_TOKEN="$(openssl rand -hex 32)"

  if [ -n "${ZYDOCK_DOMAIN}" ]; then
    APP_URL="https://${ZYDOCK_DOMAIN}"
    WS_URL="wss://${ZYDOCK_DOMAIN}/api/ws"
  else
    APP_URL="http://${ZYDOCK_HOST}"
    WS_URL="ws://${ZYDOCK_HOST}/api/ws"
  fi

  cat >.env <<EOF
# Generated by scripts/install.sh on $(date -u +%FT%TZ) — keep this file secret and back it up.
MODE="prod"
CORS_ORIGIN="${APP_URL}"
APP_URL="${APP_URL}"
BACKEND_URL="http://backend:8000"

MONGO_USERNAME="${MONGO_USERNAME}"
MONGO_PASSWORD="${MONGO_PASSWORD}"
MONGO_URI="mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@mongo:27017/zydock?authSource=admin"

JWT_SECRET="${JWT_SECRET}"
ENCRYPTION_KEY="${ENCRYPTION_KEY}"
LOCAL_AGENT_TOKEN="${LOCAL_AGENT_TOKEN}"

ZYDOCK_DOMAIN="${ZYDOCK_DOMAIN}"
PUBLIC_IP="${ZYDOCK_HOST}"
URL_API="http://backend:8000"
NUXT_PUBLIC_WS_URL="${WS_URL}"
EOF

  chmod 600 .env
else
  log "Existing install found — reusing .env, updating in place"
  ensure_env LOCAL_AGENT_TOKEN "$(openssl rand -hex 32)"
  ensure_env PUBLIC_IP "$(detect_public_ip || true)"
  migrate_port_urls
fi

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
  log "Building the stack locally (ZYDOCK_BUILD=1)"
  check_build_resources
  docker compose "${COMPOSE_ARGS[@]}" up -d --build
else
  log "Pulling published images and starting the stack"
  docker compose "${COMPOSE_ARGS[@]}" up -d --pull always
fi

log "Waiting for the backend to become healthy"
ATTEMPTS=0
until [ "$(docker compose "${COMPOSE_ARGS[@]}" ps --format '{{.Health}}' backend)" = "healthy" ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [ "${ATTEMPTS}" -le 60 ] || fail "Backend did not become healthy in time. Check: docker compose -f docker-compose.prod.yml logs backend"
  sleep 2
done

log "Checking that the containers can reach GitHub"
GITHUB_CHECK="$(docker compose "${COMPOSE_ARGS[@]}" exec -T backend bun -e 'try { const r = await fetch("https://api.github.com/", { signal: AbortSignal.timeout(10000) }); console.log(r.ok ? "ok" : "http"); } catch { const dns = await import("node:dns/promises"); try { await dns.lookup("api.github.com"); console.log("egress"); } catch { console.log("dns"); } }' </dev/null 2>/dev/null | tr -d '\r' | tail -n1)"

case "${GITHUB_CHECK}" in
ok) ;;
dns)
  warn "The containers cannot resolve api.github.com — deploys from GitHub will fail.
  Give the Docker daemon an explicit resolver and restart it:
    echo '{ \"dns\": [\"1.1.1.1\", \"8.8.8.8\"] }' >/etc/docker/daemon.json && systemctl restart docker"
  ;;
egress)
  warn "The containers resolve api.github.com but cannot connect to it — deploys from GitHub will fail.
  The name resolves, so this is outbound filtering: check 'iptables -S DOCKER-USER', the FORWARD
  chain policy and any firewall of your provider."
  ;;
*)
  warn "Could not check GitHub connectivity from the backend container. If deploys fail at the
  clone step, run: docker compose -f docker-compose.prod.yml exec backend sh -c 'getent hosts api.github.com'"
  ;;
esac

BOOTSTRAP_CODE=""
if [ "${NEW_INSTALL}" = true ]; then
  log "Provisioning the bootstrap code"
  BOOTSTRAP_OUTPUT="$(docker compose "${COMPOSE_ARGS[@]}" exec -T backend bun run bootstrap:code </dev/null 2>&1)" || true
  echo "${BOOTSTRAP_OUTPUT}"
  BOOTSTRAP_CODE="$(echo "${BOOTSTRAP_OUTPUT}" | grep -o 'Bootstrap code: [^"]*' | head -n1 | sed 's/Bootstrap code: //' || true)"
else
  log "Applying the superuser marker migration"
  docker compose "${COMPOSE_ARGS[@]}" exec -T backend bun run migrate:superuser-marker </dev/null 2>&1 || true
fi

log "Done"
echo "Zydock ${ZYDOCK_VERSION} (channel: ${CHANNEL})"
echo "Dashboard: ${APP_URL}"
case "${APP_URL}" in
https://*) ;;
*) echo "No domain configured yet — set one in Settings → Panel for HTTPS access." ;;
esac
if [ -n "${BOOTSTRAP_CODE}" ]; then
  echo "Bootstrap code (shown once): ${BOOTSTRAP_CODE}"
  echo "Open the dashboard and sign up with this code to create the superadmin account."
elif [ "${NEW_INSTALL}" = true ]; then
  echo "A superuser already exists — no bootstrap code generated."
fi
echo
echo "Re-run this script anytime to update Zydock (git pull + rebuild); secrets are kept."
