#!/usr/bin/env bash
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
failed=()

layer() {
  echo "=== $1"
  "${@:2}" || failed+=("$1")
}

layer base scripts/check-base.sh
layer manifests node scripts/sync-manifests.mjs --check
layer catalog scripts/check-catalog.sh
layer grok scripts/check-grok.sh
layer claude scripts/check-claude.sh
layer pi scripts/check-pi.sh
layer eval scripts/check-eval.sh

echo "==="
if ((${#failed[@]} > 0)); then
  echo "check: FAIL ${failed[*]}"
  exit 1
fi
echo "check: PASS base manifests catalog grok claude pi eval"
