#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'version.sh: %s\n' "$1" >&2
  exit 1
}

read_version() {
  grep -m1 '"version"' | sed -E 's/.*"version": *"([^"]+)".*/\1/'
}

root_version() {
  local ref="${1:-}"

  if [ -n "${ref}" ]; then
    git -C "${ROOT_DIR}" show "${ref}:package.json" | read_version
  else
    read_version <"${ROOT_DIR}/package.json"
  fi
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

nightly_tag_at_head() {
  local ref="${1:-}"
  local points_ref="${ref:-HEAD}"

  git -C "${ROOT_DIR}" tag --points-at "${points_ref}" --list "v$(root_version "${ref}")-n.*" | sort -V | tail -n1
}

latest_nightly_tag() {
  git -C "${ROOT_DIR}" tag --list "v$(root_version)-n.*" | sort -V | tail -n1
}

next_nightly_number() {
  local ref="${1:-}"
  local latest

  latest="$(git -C "${ROOT_DIR}" tag --list "v$(root_version "${ref}")-n.*" |
    sed -E 's/.*-n\.([0-9]+)$/\1/' | sort -n | tail -n1)"
  echo "$((${latest:-0} + 1))"
}

next_nightly() {
  local ref="${1:-}"
  local existing

  existing="$(nightly_tag_at_head "${ref}")"

  if [ -n "${existing}" ]; then
    echo "${existing}"
  else
    echo "v$(root_version "${ref}")-n.$(next_nightly_number "${ref}")"
  fi
}

channel_version() {
  local stable_tag
  local nightly_tag

  case "${CHANNEL}" in
  stable)
    stable_tag="$(stable_tag_at_head)"
    if [ -z "${stable_tag}" ] &&
      ! git -C "${ROOT_DIR}" rev-parse -q --verify "refs/tags/v$(root_version)" >/dev/null; then
      nightly_tag="$(latest_nightly_tag)"
      [ -n "${nightly_tag}" ] || nightly_tag="v$(root_version)-n.$(next_nightly_number)"
      echo "${nightly_tag}"
      return
    fi
    [ -n "${stable_tag}" ] || stable_tag="$(latest_stable_tag)"
    echo "${stable_tag}"
    ;;
  nightly)
    next_nightly
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
root-version) root_version "${2:-}" ;;
stable-tag) latest_stable_tag ;;
next-nightly) next_nightly "${2:-}" ;;
*) fail "unknown command '$1' (use: version, channel, branch, ref, commit, root-version, stable-tag or next-nightly)" ;;
esac
