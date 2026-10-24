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
run "Pi package loads only one skill" manifests "jq '.pi.skills = [\"./pstack/skills/how\"]' package.json >m && mv m package.json"
run "Pi package.json removed" pi "rm package.json"
run "Pi extension removed" pi "rm .pi/extensions/pstack.ts"
run "Pi adapter removed" pi "rm docs/harness/pi.md"
run "Pi extension stops bringing the skills" pi "sed -i '/resources_discover/d' .pi/extensions/pstack.ts"
run "Pi /pstack:<name> forwards /skill:<name> as plain text" pi "sed -i 's/expandPromptTemplates: true/expandPromptTemplates: false/' .pi/extensions/pstack.ts"
run "Pi extension registers its commands twice inside the checkout" pi "sed -i '/if ((globalThis as any)\\[owner\\]) return/d' .pi/extensions/pstack.ts"
run "Pi command descriptions lose the folded-block parse" pi "sed -i 's/return block.join(\" \")/return block.join(\"\\\\n\")/' .pi/extensions/pstack.ts"
run "Pi subagent extension dropped from the package" pi "jq '.pi.extensions |= .[:1]' package.json >m && mv m package.json"
run "Pi subagent ignores --agent" pi "sed -i 's/launchArgs.push(\"--append-system-prompt\", agentFile);//' .pi/extensions/subagent/subagent.ts"
run "Pi subagent stop leaves the worktree" pi "sed -i 's/\"worktree\", \"remove\"/\"worktree\", \"list\"/' .pi/extensions/subagent/shared.ts"
run "opencode index.js removed" opencode "rm index.js"
run "opencode adapter removed" opencode "rm docs/harness/opencode.md"
run "opencode offers every skill to the model" opencode "sed -i 's/autoinvoke: meta\\[\"disable-model-invocation\"\\] !== true/autoinvoke: true/' .opencode/plugins/pstack.js"
run "opencode commands lose the pstack: prefix" opencode "sed -i 's/name: \`pstack:\${skill.id}\`/name: skill.id/' .opencode/plugins/pstack.js"
run "opencode agent body hook disabled" opencode "sed -i 's/if (agent) event.system.push/if (false) event.system.push/' .opencode/plugins/pstack.js"
run "opencode delegates may ask and spawn" opencode "sed -i 's/draft.permissions.push(...delegateDenies)//' .opencode/plugins/pstack.js"
run "Pi /pstack:<name> steers a busy agent instead of following up" unit "sed -i 's/ctx.isIdle() ? {} : { deliverAs: \"followUp\" }/{}/' .pi/extensions/pstack.ts"
run "Pi /pstack:<name> returns before a JSON run settles" unit "sed -i 's/ctx.mode === \"print\" || ctx.mode === \"json\"/ctx.mode === \"print\"/' .pi/extensions/pstack.ts"
run "eval grader ignores Pi --tools" eval "sed -i 's/readonly: tools !== null \&\& /readonly: true || /' evals/hosts/pi.mjs"
run "eval grader counts parallel spawns across turns" eval "sed -i 's/perTurn.set(spawn.turn,/perTurn.set(0,/' evals/criteria.mjs"
run "eval scenario names a missing skill" eval "sed -i 's/skill: \"interrogate\",/skill: \"interrogat\",/' evals/scenarios.mjs"
run "eval scenario loses its negative control" eval "sed -i 's/    control: \[\"adapter\", \"answer\"\],/    control: [],/' evals/scenarios.mjs"
run "eval Claude parser reads the first result" eval "sed -i 's/results.at(-1)/results[0]/' evals/hosts/claude.mjs"
run "eval golden transcript edited" eval "printf x >>evals/golden/claude-how-simple/transcript.jsonl"

((bad == 0)) && echo "selftest: every break failed its layer" || echo "selftest: FAIL a break went unnoticed"
exit "$bad"
