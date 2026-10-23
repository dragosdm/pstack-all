#!/usr/bin/env bash
# drive-claude.sh <run-id> <name> <prompt>  ->  <evidence>/drive-<name>/{prompt.txt,transcript.jsonl,init.json,hooks.txt,tools.txt,denied.txt,answer.md}
# Bills one model session. VERIFY_MODEL (default sonnet), VERIFY_BUDGET_USD (default 1).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_run "${1:-}"
name="${2:?usage: $0 <run-id> <name> <prompt>}"
prompt="${3:?usage: $0 <run-id> <name> <prompt>}"
out="$EVIDENCE/drive-$name"
mkdir -p "$out"
printf '%s\n' "$prompt" >"$out/prompt.txt"

# User settings are skipped so an installed pstack@cursor-plugins can't stand in for this repo.
# The prompt goes on stdin because --allowedTools takes every following argument.
set +e
(cd "$instance" && "$CLAUDE" -p --output-format stream-json --verbose --no-session-persistence \
  --setting-sources project,local --plugin-dir "$repo" \
  --model "${VERIFY_MODEL:-sonnet}" --max-budget-usd "${VERIFY_BUDGET_USD:-1}" \
  --allowedTools Read Glob Grep <"$out/prompt.txt") >"$out/transcript.jsonl" 2>"$out/stderr.txt"
code=$?
set -e

jq -c 'select(.type == "system" and .subtype == "init")
  | {model, plugins, agents: [.agents[]? | select(startswith("pstack:"))],
     pstack_commands: [.slash_commands[]? | select(startswith("pstack:"))] | length}' \
  "$out/transcript.jsonl" >"$out/init.json"
jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
  | "\(.name) \(.input | tostring)"' "$out/transcript.jsonl" >"$out/tools.txt"
jq -r 'select(.type == "system" and .subtype == "hook_response") | "\(.hook_name): \(.output)"' \
  "$out/transcript.jsonl" >"$out/hooks.txt"
jq -c 'select(.type == "result") | .permission_denials[]?' "$out/transcript.jsonl" >"$out/denied.txt"
# A session whose background subagents report back ends one result per turn; the last one is the answer and the total cost.
jq -rs 'map(select(.type == "result")) | last | .result // empty' "$out/transcript.jsonl" >"$out/answer.md"
cost="$(jq -rs 'map(select(.type == "result")) | last | .total_cost_usd // empty' "$out/transcript.jsonl")"
echo "drive: exit=$code cost_usd=${cost:-?} evidence=$out"
echo "drive: init $(cat "$out/init.json")"
echo "drive: $(wc -l <"$out/tools.txt") tool calls, $(wc -l <"$out/denied.txt") denied, answer $(wc -c <"$out/answer.md") bytes"
echo "drive: hooks $(cat "$out/hooks.txt")"
exit "$code"
