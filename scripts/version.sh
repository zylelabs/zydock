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
  git -C "${ROOT_DIR}" tag --list 'v*' | { grep -Ev -- '-' || true; } | sort -V | tail -n1
}

stable_tag_at_head() {
  git -C "${ROOT_DIR}" tag --points-at HEAD --list 'v*' | { grep -Ev -- '-' || true; } | sort -V | tail -n1
}

commit_short() {
  git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || fail "not a git checkout"
}

commit_full() {
  git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || fail "not a git checkout"
}

BRANCH="${ZYDOCK_BRANCH:-${GITHUB_REF_NAME:-$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}}"

if [ -z "${BRANCH}" ] || [ "${BRANCH}" = "HEAD" ]; then
  BRANCH="main"
fi

CHANNEL="${ZYDOCK_CHANNEL:-}"

if [ -z "${CHANNEL}" ]; then
  case "${BRANCH}" in
  main) CHANNEL="stable" ;;
  nightly) CHANNEL="nightly" ;;
  dev) CHANNEL="dev" ;;
  *) CHANNEL="${BRANCH}" ;;
  esac
fi

channel_branch() {
  case "${CHANNEL}" in
  stable) echo "main" ;;
  nightly) echo "nightly" ;;
  dev) echo "dev" ;;
  *) echo "${CHANNEL}" ;;
  esac
}

channel_ref() {
  if [ "${CHANNEL}" != "stable" ]; then
    echo "origin/$(channel_branch)"
    return
  fi

  local tag
  tag="$(latest_stable_tag)"

  if [ -n "${tag}" ]; then
    echo "${tag}"
  else
    echo "origin/main"
  fi
}

channel_version() {
  local stable_tag range count

  case "${CHANNEL}" in
  stable)
    stable_tag="$(stable_tag_at_head)"
    [ -n "${stable_tag}" ] || stable_tag="$(latest_stable_tag)"
    [ -n "${stable_tag}" ] || fail "channel is stable but no stable tag (vX.Y.Z) exists yet"
    echo "${stable_tag}"
    ;;
  nightly)
    stable_tag="$(latest_stable_tag)"
    range="HEAD"
    [ -n "${stable_tag}" ] && range="${stable_tag}..HEAD"
    count="$(git -C "${ROOT_DIR}" rev-list --count "${range}")"
    echo "v$(root_version)-n.${count}"
    ;;
  dev)
    echo "v$(root_version)-dev.$(commit_short)"
    ;;
  *)
    echo "v$(root_version)-branch.$(commit_short)"
    ;;
  esac
}

case "${1:-version}" in
version) channel_version ;;
channel) echo "${CHANNEL}" ;;
branch) channel_branch ;;
ref) channel_ref ;;
commit) commit_full ;;
*) fail "unknown command '$1' (use: version, channel, branch, ref or commit)" ;;
esac
