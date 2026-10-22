#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=/dev/null
source base/pstack.lock
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
status=0

while IFS=$'\t' read -r meta path; do
  want="${meta##* }"
  have="$(git hash-object "base/upstream/$path")"
  if [[ "$have" != "$want" ]]; then
    echo "catalog: FAIL base/upstream/$path is $have, lock says $want"
    status=1
  fi
done <base/upstream.ls-tree
if [[ -n "${PSTACK_UPSTREAM_DIR:-}" ]]; then
  cut -f2 base/upstream.ls-tree | xargs git -C "$PSTACK_UPSTREAM_DIR" ls-tree "$UPSTREAM_COMMIT" >"$work/upstream.ls-tree"
  if diff -q base/upstream.ls-tree "$work/upstream.ls-tree" >/dev/null; then
    echo "catalog: upstream validator and schemas match $UPSTREAM_COMMIT"
  else
    echo "catalog: FAIL base/upstream.ls-tree differs from $UPSTREAM_COMMIT"
    status=1
  fi
fi
((status == 0)) || exit 1

mkdir -p "$work/repo"
cp -a .cursor-plugin pstack "$work/repo/"
cp -a base/upstream/scripts base/upstream/schemas "$work/repo/"
(cd "$work/repo" && npm install --no-save --no-package-lock ajv@8.20.0 ajv-formats@3.0.1) >"$work/npm.log" 2>&1 || {
  echo "catalog: FAIL npm install"; cat "$work/npm.log"; exit 1
}
if (cd "$work/repo" && node scripts/validate-plugins.mjs) >"$work/validate.log" 2>&1; then
  echo "catalog: PASS upstream validate-plugins.mjs: $(tail -1 "$work/validate.log")"
else
  echo "catalog: FAIL upstream validate-plugins.mjs"
  cat "$work/validate.log"
  status=1
fi

gates="$(jq -c '[.plugins[] | select(.name == "pstack") | .minClientVersions // empty]' .cursor-plugin/marketplace.json)"
entries="$(jq '[.plugins[] | select(.name == "pstack")] | length' .cursor-plugin/marketplace.json)"
if [[ "$entries" == 1 && "$gates" == "[]" ]]; then
  echo "catalog: PASS one pstack entry and no minClientVersions, so Cursor and Grok Bot both list it, as upstream does"
else
  echo "catalog: FAIL expected one pstack entry with no minClientVersions, found $entries entries and gates $gates"
  status=1
fi
exit "$status"
