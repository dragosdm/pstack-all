#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# Resolve the binary before XDG_DATA_HOME moves: under a moved data dir the mise shim installs opencode afresh.
opencode="${OPENCODE_BIN:-$(mise which opencode 2>/dev/null || command -v opencode)}"
work="$(mktemp -d)"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
export HOME="$work/home" XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_STATE_HOME="$work/state" XDG_CACHE_HOME="$work/cache"
export OPENCODE_SERVER_PASSWORD="pstack-check" OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 PSTACK_MOCK_KEY=none
mkdir -p "$HOME" "$XDG_CONFIG_HOME/opencode" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$work/cwd"
status=0
txt='def txt: if type == "string" then . else map(.text // "") | join("") end;'

free_port() { node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close() })'; }
api() { curl -sf -u "opencode:$OPENCODE_SERVER_PASSWORD" "http://127.0.0.1:$port$1?location%5Bdirectory%5D=$work/cwd" "${@:2}"; }
post() { api "$1" -X POST -H 'content-type: application/json' -d "$2"; }
# Waits until the scripted model has sent the given reply, so a run is graded only once it ended.
await_reply() {
  for _ in $(seq 300); do grep -qF "\"content\":\"$1\"" "$work/mock.log" 2>/dev/null && return 0; sleep 0.2; done
  return 1
}

node scripts/opencode-mock-model.mjs "$work/mock.port" "$work/mock.log" & pids+=($!)
for _ in $(seq 50); do [[ -s "$work/mock.port" ]] && break; sleep 0.1; done
jq -n --arg root "$root" --arg url "http://127.0.0.1:$(cat "$work/mock.port")/v1" '{plugins: [$root], model: "pstack-mock/mock",
  providers: {"pstack-mock": {name: "pstack mock", env: ["PSTACK_MOCK_KEY"], package: "@opencode/ai/providers/openai-compatible",
  settings: {baseURL: $url}, models: {mock: {name: "mock"}}}}}' >"$XDG_CONFIG_HOME/opencode/opencode.json"
port="$(free_port)"
cd "$work/cwd"
"$opencode" serve --hostname 127.0.0.1 --port "$port" --print-logs --log-level debug >"$work/serve.log" 2>&1 </dev/null & pids+=($!)
cd "$root"

# Plugins load after the server answers, so poll until pstack is listed.
for _ in $(seq 150); do
  api /api/plugin 2>/dev/null | jq -e '.data[] | select(.id == "pstack")' >/dev/null 2>&1 && break
  sleep 0.2
done
plugin="$(api /api/plugin 2>/dev/null | jq -c '.data[] | select(.id == "pstack") | {source, status: .state.status}' || true)"
echo "opencode: $("$opencode" --version), the repo root is a local plugin in a throwaway XDG config"
if [[ "$plugin" == "$(jq -nc --arg path "$root/index.js" '{source: {type: "local", path: $path}, status: "active"}')" ]]; then
  echo "opencode: /api/plugin lists pstack active, loaded from index.js"
else
  echo "opencode: FAIL /api/plugin lists pstack as [${plugin}]"
  grep -E 'level=(ERROR|WARN)' "$work/serve.log" | head -5
  status=1
fi
if grep -E 'level=(ERROR|WARN)' "$work/serve.log" | grep -qiE 'plugin|pstack'; then
  echo "opencode: FAIL the server log has plugin errors"
  grep -E 'level=(ERROR|WARN)' "$work/serve.log" | grep -iE 'plugin|pstack' | head -5
  status=1
fi

want_skills="$(find pstack/skills -mindepth 2 -maxdepth 2 -name SKILL.md | cut -d/ -f3 | sort | paste -sd, -)"
# ugrep's -L exits 1 even when it lists files, so the status says nothing here.
skills_with() { { grep "$1" "$2" pstack/skills/*/SKILL.md || true; } | cut -d/ -f3 | sort | paste -sd, -; }
want_hidden="$(skills_with -l '^disable-model-invocation: true')"
want_offered="$(skills_with -L '^disable-model-invocation: true')"
want_commands="$(skills_with -L '^user-invocable: false')"
api /api/skill >"$work/skills.json" 2>/dev/null || true
pstack_skills() { jq -r --arg dir "$root/pstack/skills/" ".data[]? | select(.path | startswith(\$dir)) | $1" "$work/skills.json" | sort | paste -sd, -; }
have_skills="$(pstack_skills 'select(.path == "\($dir)\(.id)/SKILL.md") | .id')"
have_hidden="$(pstack_skills 'select(.autoinvoke == false) | .id')"
if [[ -n "$have_skills" && "$have_skills" == "$want_skills" ]]; then
  echo "opencode: /api/skill lists $(tr ',' '\n' <<<"$have_skills" | wc -l) skills from pstack/skills, the same names as on disk"
else
  echo "opencode: FAIL /api/skill lists pstack skills [$have_skills], pstack/skills has [$want_skills]"
  status=1
fi
if [[ "$have_hidden" == "$want_hidden" ]]; then
  echo "opencode: autoinvoke is false for the $(tr ',' '\n' <<<"$have_hidden" | wc -l) skills with disable-model-invocation: true, and only those"
else
  echo "opencode: FAIL autoinvoke is false for [$have_hidden], want [$want_hidden]"
  status=1
fi
have_commands="$(api /api/command 2>/dev/null | jq -r '.data[]? | .name | select(startswith("pstack:")) | ltrimstr("pstack:")' | sort | paste -sd, - || true)"
if [[ -n "$have_commands" && "$have_commands" == "$want_commands" ]]; then
  echo "opencode: /api/command has pstack:<name> for every skill"
else
  echo "opencode: FAIL /api/command has pstack commands [$have_commands], want [$want_commands]"
  status=1
fi
have_agents="$(api /api/agent 2>/dev/null | jq -r '.data[]? | select((.id == "comment-sicko" or .id == "poteto-agent") and .mode == "subagent"
  and any(.permissions[]; . == {action: "question", resource: "*", effect: "deny"})
  and any(.permissions[]; . == {action: "subagent", resource: "*", effect: "deny"})) | .id' | sort | paste -sd, - || true)"
if [[ "$have_agents" == "comment-sicko,poteto-agent" ]]; then
  echo "opencode: /api/agent has comment-sicko and poteto-agent as subagents that cannot ask the user or spawn"
else
  echo "opencode: FAIL /api/agent subagents with the question and subagent denies are [$have_agents]"
  status=1
fi

# A real run against the scripted model: the parent calls the subagent tool for comment-sicko, then for poteto-agent.
session="$(post /api/session '{}' | jq -r .data.id)"
post "/api/session/$session/prompt" '{"text":"spawn"}' >/dev/null
await_reply "PARENT done" || { echo "opencode: FAIL the scripted parent run did not finish"; status=1; }
jq -s "$txt"' map(.request) | map(select((.tools // []) | length > 0)) | map({
    system: ([.messages[] | select(.role == "system") | .content | txt] | join("\n")),
    users: [.messages[] | select(.role == "user") | .content | txt],
    tools: [.tools[].function.name]})' "$work/mock.log" >"$work/requests.json"
jq -r 'map(select(.users == ["spawn"]))[0].system // ""' "$work/requests.json" >"$work/parent.txt"
adapter="$(grep -oE 'read /[^ ]+\.md once per session' "$work/parent.txt" | head -1 | cut -d' ' -f2 || true)"
if [[ -n "$adapter" ]] && cmp -s "$adapter" docs/harness/opencode.md; then
  echo "opencode: the parent's system prompt tells the model to read docs/harness/opencode.md"
else
  echo "opencode: FAIL the parent's system prompt names '${adapter:-no adapter}', not docs/harness/opencode.md"
  status=1
fi
offered="$(sed -nE 's#^ *<id>([^<]+)</id>$#\1#p' "$work/parent.txt" | sort | comm -12 - <(tr ',' '\n' <<<"$want_skills") | paste -sd, -)"
if [[ -n "$offered" && "$offered" == "$want_offered" ]]; then
  echo "opencode: <available_skills> offers the model $offered, every pstack skill without disable-model-invocation"
else
  echo "opencode: FAIL <available_skills> offers pstack skills [$offered], want [$want_offered]"
  status=1
fi
child() {
  local name="$1" probe="$2" heading="$3" row
  row="$(jq -c --arg probe "$probe" --arg heading "$heading" --arg adapter "read $root/docs/harness/opencode.md once per session" '
    map(select(.users | any(contains($probe))))[0] // {} | {body: (.system // "" | contains($heading)),
    adapter: (.system // "" | contains($adapter)), subagent: (.tools // [] | index("subagent") != null), seen: (.system != null)}' "$work/requests.json")"
  if [[ "$row" == '{"body":true,"adapter":true,"subagent":false,"seen":true}' ]]; then
    echo "opencode: the $name child got '$heading' and the adapter line, and has no subagent tool"
  else
    echo "opencode: FAIL the $name child got $row"
    status=1
  fi
}
child comment-sicko "CHILD-PROBE sicko" "# Comment Sicko"
child poteto-agent "CHILD-PROBE poteto" "# Poteto subagent"

# opencode run "/x" sends the text as is, so dispatch the command over the API as the TUI does.
session="$(post /api/session '{}' | jq -r .data.id)"
post "/api/session/$session/command" '{"name":"pstack:how","text":"probe"}' >/dev/null
await_reply "SKILL done" || { echo "opencode: FAIL the pstack:how command run did not finish"; status=1; }
jq -s -r "$txt"' map(select(.request.messages[-1].role == "tool")) | map(.request.messages[-1].content | txt)
  | map(select(contains("<skill_content name=\"how\">")))[0] // ""' "$work/mock.log" >"$work/skill.txt"
asked="$(jq -s -r "$txt"' map(select(.reply.toolCall.name == "skill"))[0].request.messages | map(select(.role == "user"))[-1].content | txt' "$work/mock.log" 2>/dev/null || true)"
if [[ "$asked" == $'Load and execute the `how` skill.\n\nprobe' ]] && node -e '
  const { readFileSync } = require("node:fs")
  const body = readFileSync(process.argv[1], "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim()
  process.exit(readFileSync(process.argv[2], "utf8").includes(body) ? 0 : 1)' pstack/skills/how/SKILL.md "$work/skill.txt"; then
  echo "opencode: /pstack:how asks the model to load how, and the skill tool returns the SKILL.md body"
else
  echo "opencode: FAIL /pstack:how sent [$asked], or the skill tool did not return the how body"
  status=1
fi

((status == 0)) || exit 1
echo "opencode: PASS repo root loads as an opencode plugin with every pstack skill, pstack:<name> commands, both agents, and the adapter line"
