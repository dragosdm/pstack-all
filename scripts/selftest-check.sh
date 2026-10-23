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
run "Claude manifest loads only one skill" claude "jq '.skills = \"./pstack/skills/how/\"' .claude-plugin/plugin.json >m && mv m .claude-plugin/plugin.json"
run "Claude manifest drops an agent" claude "jq '.agents |= .[:1]' .claude-plugin/plugin.json >m && mv m .claude-plugin/plugin.json"
run "Claude adapter hook removed" claude "jq 'del(.hooks)' .claude-plugin/plugin.json >m && mv m .claude-plugin/plugin.json"
run "Claude marketplace removed" claude "rm .claude-plugin/marketplace.json"
run "Pi package loads only one skill" pi "jq '.pi.skills = [\"./pstack/skills/how\"]' package.json >m && mv m package.json"
run "Pi package.json removed" pi "rm package.json"
run "Pi extension removed" pi "rm .pi/extensions/pstack.ts"
run "Pi adapter removed" pi "rm docs/harness/pi.md"
run "Pi subagent extension dropped from the package" pi "jq '.pi.extensions |= .[:1]' package.json >m && mv m package.json"
run "Pi subagent ignores --agent" pi "sed -i 's/launchArgs.push(\"--append-system-prompt\", agentFile);//' .pi/extensions/subagent/subagent.ts"
run "Pi subagent stop leaves the worktree" pi "sed -i 's/\"worktree\", \"remove\"/\"worktree\", \"list\"/' .pi/extensions/subagent/shared.ts"

((bad == 0)) && echo "selftest: every break failed its layer" || echo "selftest: FAIL a break went unnoticed"
exit "$bad"
