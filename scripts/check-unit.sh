#!/usr/bin/env bash
# The in-process unit tests behind `bun run test`. No harness binary, login or network.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if bun run test >"$log" 2>&1; then
  echo "unit: PASS bun run test, $(grep -Eo 'Ran [0-9]+ tests across [0-9]+ files' "$log")"
else
  grep -E '^\(fail\)|^error:|^\s*[0-9]+ fail' "$log"
  echo "unit: FAIL bun run test"
  exit 1
fi
