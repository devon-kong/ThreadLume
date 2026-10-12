#!/bin/zsh
# R3 PoC harness: registers the mv3-poc content script (isolated world) in the
# current ego-browser page, then runs the payload file given as $1.
# The payload executes AFTER registration in the same invocation and may use
# `task`, `page`, REG_POC(), NET_SNAPSHOT(), DETAIL_PROBE(id). Usage:
#   exploration-poc/r3/run.sh payload.js
# Repo root is derived from this script's location (E1: no absolute paths),
# so the harness works from any checkout or worktree.
set -e
PAYLOAD="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# ego-browser's Node runtime does not inherit shell env vars, so the repo root
# is injected by substituting the __PEEK_REPO_ROOT__ placeholder at concat time.
OUT="/tmp/r3-harness-$$.mjs"
sed "s|__PEEK_REPO_ROOT__|${ROOT}|g" "${ROOT}/exploration-poc/r3/_prelude.js" "${PAYLOAD}" > "${OUT}"
ego-browser nodejs < "${OUT}"
rm -f "${OUT}"
