#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-zylelabs/zydock}"
REGISTRY_NAMESPACE="${REGISTRY_NAMESPACE:-ghcr.io/zylelabs}"
SERVICES="${SERVICES:-backend frontend agent}"

fail() {
  printf 'release-notes.sh: %s\n' "$1" >&2
  exit 1
}

TAG="${1:-}"
PREVIOUS="${2:-}"
[ -n "${TAG}" ] || fail "usage: release-notes.sh <tag> [previous-tag]"

RANGE="${TAG}"
[ -n "${PREVIOUS}" ] && RANGE="${PREVIOUS}..${TAG}"

LOG="$(git -C "${ROOT_DIR}" log --no-merges --reverse --format='%h%x09%s' "${RANGE}")"

KNOWN_TYPES="feat|fix|perf|refactor|docs|chore|ci|build|test|style"
NOISE='(bump version|run lint( script)?|run linter script)'

pick() {
  printf '%s\n' "${LOG}" | { grep -E "^[^	]+	($1)(\([^)]+\))?: " || true; }
}

render() {
  local sha subject scope text
  while IFS=$'\t' read -r sha subject; do
    [ -n "${sha}" ] || continue
    scope="$(printf '%s' "${subject}" | sed -nE 's/^[a-z]+\(([^)]+)\)!?:.*/\1/p')"
    text="$(printf '%s' "${subject}" | sed -E 's/^[a-z]+(\([^)]+\))?!?: *//; s/^(.)/\U\1/')"
    if [ -n "${scope}" ]; then
      printf -- '- **%s** — %s ([`%s`](%s/commit/%s))\n' "${scope}" "${text}" "${sha}" "${REPO_URL}" "${sha}"
    else
      printf -- '- %s ([`%s`](%s/commit/%s))\n' "${text}" "${sha}" "${REPO_URL}" "${sha}"
    fi
  done
}

section() {
  local heading="$1" body="$2"
  [ -n "${body}" ] || return 0
  printf '%s\n\n' "${heading}"
  printf '%s\n' "${body}" | render
  echo
}

if [ -z "${LOG}" ]; then
  printf 'No code changes since %s.\n\n' "${PREVIOUS:-the start of history}"
fi

BREAKING="$(printf '%s\n' "${LOG}" | { grep -E "^[^	]+	[a-z]+(\([^)]+\))?!: " || true; })"
section "### ⚠️ Breaking changes" "${BREAKING}"

section "### Features" "$(pick feat)"
section "### Bug fixes" "$(pick fix)"
section "### Performance" "$(pick perf)"
section "### Refactoring" "$(pick refactor)"
section "### Documentation" "$(pick docs)"

CHORES="$(pick 'chore|ci|build|test|style' | { grep -Evi "	[a-z]+(\([^)]+\))?!?: ${NOISE}" || true; })"
if [ -n "${CHORES}" ]; then
  printf '<details><summary>Internal maintenance</summary>\n\n'
  printf '%s\n' "${CHORES}" | render
  printf '\n</details>\n\n'
fi

section "### Other changes" \
  "$(printf '%s\n' "${LOG}" | { grep -Ev "^[^	]+	(${KNOWN_TYPES})(\([^)]+\))?!?: " || true; })"

printf '### Images\n\n'
for service in ${SERVICES}; do
  printf -- '- `docker pull %s/zydock-%s:%s`\n' "${REGISTRY_NAMESPACE}" "${service}" "${TAG#v}"
done
echo

if [ -n "${PREVIOUS}" ]; then
  printf -- '**Full changelog**: [%s...%s](%s/compare/%s...%s)\n' \
    "${PREVIOUS}" "${TAG}" "${REPO_URL}" "${PREVIOUS}" "${TAG}"
fi
