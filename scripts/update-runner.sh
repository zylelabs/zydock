#!/bin/sh

set -eu

INSTALL_DIR="${ZYDOCK_INSTALL_DIR:-/data/zydock}"
RUN_ID="${ZYDOCK_RUN_ID:-}"
RUN_FROM="${ZYDOCK_RUN_FROM:-}"
RUN_TARGET="${ZYDOCK_RUN_TARGET:-}"
RUN_CHANNEL="${ZYDOCK_RUN_CHANNEL:-}"
RUN_STARTED_AT="${ZYDOCK_RUN_STARTED_AT:-}"

STATE_FILE="${INSTALL_DIR}/.zydock-update.json"
LOG_FILE="${INSTALL_DIR}/.zydock-update.log"

[ -n "${RUN_ID}" ] || {
  echo "update-runner.sh: ZYDOCK_RUN_ID is required" >&2
  exit 2
}

escape() {
  printf '%s' "$1" | tr -d '\r' | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

now() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

write_state() {
  status="$1"
  finished_at="$2"
  error="$3"
  exit_code="$4"
  target="$5"

  cat >"${STATE_FILE}.tmp" <<EOF
{
  "id": "$(escape "${RUN_ID}")",
  "status": "${status}",
  "from": "$(escape "${RUN_FROM}")",
  "to": "$(escape "${target}")",
  "channel": "$(escape "${RUN_CHANNEL}")",
  "installPath": "$(escape "${INSTALL_DIR}")",
  "startedAt": "$(escape "${RUN_STARTED_AT}")",
  "finishedAt": "$(escape "${finished_at}")",
  "error": "$(escape "${error}")",
  "exitCode": ${exit_code}
}
EOF

  mv "${STATE_FILE}.tmp" "${STATE_FILE}"
}

install_missing_tools() {
  missing=''

  for tool in bash git openssl; do
    command -v "${tool}" >/dev/null 2>&1 || missing="${missing} ${tool}"
  done

  [ -n "${missing}" ] || return 0

  if command -v apk >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    apk add --no-cache ${missing} >>"${LOG_FILE}" 2>&1 || true
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update >>"${LOG_FILE}" 2>&1 || true
    # shellcheck disable=SC2086
    apt-get install -y --no-install-recommends ${missing} >>"${LOG_FILE}" 2>&1 || true
  fi
}

head_commit() {
  git -C "${INSTALL_DIR}" rev-parse HEAD 2>/dev/null || printf '%s' "${RUN_TARGET}"
}

last_log_line() {
  grep -v '^[[:space:]]*$' "${LOG_FILE}" 2>/dev/null | tail -n1 || true
}

[ -d "${INSTALL_DIR}" ] || {
  echo "update-runner.sh: ${INSTALL_DIR} is not mounted" >&2
  exit 2
}

: >"${LOG_FILE}"
install_missing_tools

if ! command -v bash >/dev/null 2>&1; then
  write_state failed "$(now)" "bash is not available in the updater image" 2 "${RUN_TARGET}"
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  write_state failed "$(now)" "docker is not available in the updater image" 2 "${RUN_TARGET}"
  exit 2
fi

set +e
bash "${INSTALL_DIR}/scripts/update.sh" >>"${LOG_FILE}" 2>&1
EXIT_CODE=$?
set -e

if [ "${EXIT_CODE}" -eq 0 ]; then
  write_state success "$(now)" '' 0 "$(head_commit)"
else
  write_state failed "$(now)" "$(last_log_line)" "${EXIT_CODE}" "$(head_commit)"
fi

exit "${EXIT_CODE}"
