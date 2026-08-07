#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'version.sh: %s\n' "$1" >&2
  exit 1
}

root_version() {
  grep -m1 '"version"' "${ROOT_DIR}/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/'
}

latest_stable_tag() {
  git -C "${ROOT_DIR}" tag --list 'v*' | grep -Ev -- '-' | sort -V | tail -n1
}

commit_short() {
  git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || fail "not a git checkout"
}

BRANCH="${ZYDOCK_BRANCH:-${GITHUB_REF_NAME:-$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}}"

case "${BRANCH}" in
main)
  STABLE_TAG="$(latest_stable_tag)"
  [ -n "${STABLE_TAG}" ] || fail "branch is main but no stable tag (vX.Y.Z) exists yet"
  echo "${STABLE_TAG}"
  ;;
nightly)
  STABLE_TAG="$(latest_stable_tag)"
  RANGE="HEAD"
  [ -n "${STABLE_TAG}" ] && RANGE="${STABLE_TAG}..HEAD"
  COUNT="$(git -C "${ROOT_DIR}" rev-list --count "${RANGE}")"
  echo "v$(root_version)-n.${COUNT}"
  ;;
dev)
  echo "v$(root_version)-dev.$(commit_short)"
  ;;
*)
  echo "v$(root_version)-branch.$(commit_short)"
  ;;
esac
