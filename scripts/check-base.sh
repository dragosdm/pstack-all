#!/usr/bin/env bash
# Final check for the pstack base.
#   1. pstack/ is byte-identical (content and mode) to the upstream tree in base/pstack.lock.
#   2. pstack's own test suites give the same pass/fail/skip counts as base/test-baseline.tsv.
# Usage: scripts/check-base.sh [--record]   (--record rewrites the test baseline)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=/dev/null
source base/pstack.lock

record=false
[[ "${1:-}" == "--record" ]] && record=true

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
status=0

export GIT_INDEX_FILE="$work/index"
git add -- pstack
tree="$(git write-tree --prefix=pstack/)"
git ls-files -s -- pstack | awk -F'\t' '{split($1,a," "); print a[1]" blob "a[2]"\t"$2}' >"$work/ls-tree"
unset GIT_INDEX_FILE

if [[ "$tree" == "$UPSTREAM_TREE" ]] && diff -q base/pstack.ls-tree "$work/ls-tree" >/dev/null; then
  echo "integrity: PASS pstack/ tree $tree == upstream $UPSTREAM_COMMIT:$UPSTREAM_PATH"
else
  echo "integrity: FAIL pstack/ tree $tree != upstream $UPSTREAM_TREE"
  diff base/pstack.ls-tree "$work/ls-tree" || true
  status=1
fi

cp -a pstack "$work/pstack"
scripts_dir="$work/pstack/skills/poteto-mode/scripts"
(cd "$scripts_dir" && bun install --frozen-lockfile >"$work/install.log" 2>&1) || {
  echo "tests: FAIL bun install"; cat "$work/install.log"; exit 1
}

counts() { grep -Eo "$2" "$1" | tail -1 | grep -Eo '[0-9]+' || echo 0; }

(cd "$scripts_dir" && bun test orch watch-pr check-plan.test.ts) >"$work/bun-test.log" 2>&1 || true
(cd "$scripts_dir" && bun x tsc --project watch-pr/tsconfig.json --noEmit --strict) >"$work/tsc.log" 2>&1 \
  && tsc_errors=0 || tsc_errors="$(grep -c 'error TS' "$work/tsc.log" || echo 1)"
(cd "$work/pstack/skills/statechart/scripts" && node --test --test-reporter=tap test/statechart.test.mjs) >"$work/node-test.log" 2>&1 || true

{
  printf 'suite\tpass\tfail\tskip\n'
  printf 'poteto-mode bun test\t%s\t%s\t%s\n' \
    "$(counts "$work/bun-test.log" '^ *[0-9]+ pass')" \
    "$(counts "$work/bun-test.log" '^ *[0-9]+ fail')" \
    "$(counts "$work/bun-test.log" '^ *[0-9]+ skip')"
  printf 'watch-pr typecheck\t-\t%s\t-\n' "$tsc_errors"
  printf 'statechart node test\t%s\t%s\t%s\n' \
    "$(counts "$work/node-test.log" '^# pass [0-9]+')" \
    "$(counts "$work/node-test.log" '^# fail [0-9]+')" \
    "$(counts "$work/node-test.log" '^# skipped [0-9]+')"
} >"$work/results.tsv"

column -s$'\t' -t "$work/results.tsv"

if awk -F'\t' 'NR > 1 && $2 != "-" && $2 + $3 + $4 == 0 { found = 1 } END { exit !found }' "$work/results.tsv"; then
  echo "tests: FAIL a suite reported zero tests, so its output was not parsed"
  exit 1
fi

if $record; then
  cp "$work/results.tsv" base/test-baseline.tsv
  echo "tests: RECORDED base/test-baseline.tsv"
elif diff -q base/test-baseline.tsv "$work/results.tsv" >/dev/null; then
  echo "tests: PASS matches base/test-baseline.tsv"
else
  echo "tests: FAIL differs from base/test-baseline.tsv"
  diff base/test-baseline.tsv "$work/results.tsv" || true
  for log in bun-test tsc node-test; do echo "--- $log (tail)"; tail -30 "$work/$log.log"; done
  status=1
fi

exit "$status"
