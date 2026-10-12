#!/bin/zsh
# R3 PoC harness: registers the mv3-poc content script (isolated world) in the
# current ego-browser page, then runs the payload file given as $1.
# The payload executes AFTER registration in the same invocation and may use
# `task`, `page`, REG_POC(), NET_SNAPSHOT(), DETAIL_PROBE(id). Usage:
#   exploration-poc/r3/run.sh payload.js
set -e
PAYLOAD="$1"
ROOT="/Users/devon/claude/peek-main"
OUT="/tmp/r3-harness-$$.mjs"
cat "${ROOT}/exploration-poc/r3/_prelude.js" "${PAYLOAD}" > "${OUT}"
ego-browser nodejs < "${OUT}"
rm -f "${OUT}"
