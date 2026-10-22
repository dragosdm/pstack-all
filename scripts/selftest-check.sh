#!/usr/bin/env bash
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
bad=0

run() {
  local name="$1" layer="$2" break="$3"
  rm -rf "$work/repo"
  cp -a "$root" "$work/repo"
  (cd "$work/repo" && eval "$break")
  out="$(cd "$work/repo" && scripts/check.sh 2>&1)"
  code=$?
  summary="$(echo "$out" | tail -1)"
  echo "### $name"
  echo "break: $break"
  echo "$out" | grep -E 'FAIL|DRIFT' | grep -v '^check:' | head -6
  echo "$summary (exit=$code)"
  if ((code == 0)) || [[ " ${summary#check: FAIL } " != *" $layer "* ]]; then
    echo "SELFTEST BAD: expected layer $layer to fail"
    bad=1
  fi
}

run "byte change in a skill" base "printf x >>pstack/skills/how/SKILL.md"
run "root plugin.json edited by hand" manifests "sed -i 's/go deep first/go deep/' plugin.json"
run "catalog points at a missing source" catalog "sed -i 's/\"source\": \"pstack\"/\"source\": \"nope\"/' .cursor-plugin/marketplace.json"
run "catalog hides pstack from Grok Bot" catalog "jq '.plugins[0].minClientVersions = {grokbot: \"never\"}' .cursor-plugin/marketplace.json >m && mv m .cursor-plugin/marketplace.json"
run "root plugin.json removed" grok "rm plugin.json"
run "root plugin.json loads only one skill" grok "jq '.skills = \"./pstack/skills/how/\"' plugin.json >m && mv m plugin.json"

((bad == 0)) && echo "selftest: every break failed its layer" || echo "selftest: FAIL a break went unnoticed"
exit "$bad"
