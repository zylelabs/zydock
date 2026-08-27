#!/bin/sh

set -eu

INSTALL_DIR="${ZYDOCK_INSTALL_DIR:-/data/zydock}"
RUN_ID="${ZYDOCK_RUN_ID:-}"
RUN_STARTED_AT="${ZYDOCK_RUN_STARTED_AT:-}"
BUNDLE_PATH="${ZYDOCK_RESTORE:-}"

STATE_FILE="${INSTALL_DIR}/.zydock-restore.json"
LOG_FILE="${INSTALL_DIR}/.zydock-restore.log"

[ -n "${RUN_ID}" ] || {
  echo "restore-runner.sh: ZYDOCK_RUN_ID is required" >&2
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

  cat >"${STATE_FILE}.tmp" <<EOF
{
  "id": "$(escape "${RUN_ID}")",
  "status": "${status}",
  "bundlePath": "$(escape "${BUNDLE_PATH}")",
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
  command -v bash >/dev/null 2>&1 && return 0

  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache bash >>"${LOG_FILE}" 2>&1 || true
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update >>"${LOG_FILE}" 2>&1 || true
    apt-get install -y --no-install-recommends bash >>"${LOG_FILE}" 2>&1 || true
  fi
}

last_log_line() {
  grep -v '^[[:space:]]*$' "${LOG_FILE}" 2>/dev/null | tail -n1 || true
}

[ -d "${INSTALL_DIR}" ] || {
  echo "restore-runner.sh: ${INSTALL_DIR} is not mounted" >&2
  exit 2
}

: >"${LOG_FILE}"
install_missing_tools

if ! command -v bash >/dev/null 2>&1; then
  write_state failed "$(now)" "bash is not available in the restorer image" 2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  write_state failed "$(now)" "docker is not available in the restorer image" 2
  exit 2
fi

set +e
bash "${INSTALL_DIR}/scripts/restore.sh" >>"${LOG_FILE}" 2>&1
EXIT_CODE=$?
set -e

if [ "${EXIT_CODE}" -eq 0 ]; then
  write_state success "$(now)" '' 0
else
  write_state failed "$(now)" "$(last_log_line)" "${EXIT_CODE}"
fi

exit "${EXIT_CODE}"
