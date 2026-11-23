#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
agy="${AGY_BIN:-$(command -v agy)}"
work="$(mktemp -d)"
mock=""
trap '[[ -n "$mock" ]] && kill "$mock" 2>/dev/null; rm -rf "$work"' EXIT
export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" XDG_DATA_HOME="$work/home/.local/share" \
  XDG_CACHE_HOME="$work/home/.cache" XDG_STATE_HOME="$work/home/.local/state"
mkdir -p "$HOME" "$work/ws"
git -C "$work/ws" init -q
settings='{"modelProvider":"gemini"}'
status=0
echo "agy: $("$agy" --version)"

if "$agy" plugin validate "$root/.agy" --strict >"$work/validate.log" 2>&1; then
  echo "agy: .agy passes plugin validate --strict"
else
  echo "agy: FAIL .agy fails plugin validate --strict"
  grep -vE '^\s*$' "$work/validate.log" | head -8
  status=1
fi

for plugin in "$root/pstack" "$root/.agy"; do
  "$agy" plugin install "$plugin" >"$work/install.log" 2>&1 || {
    echo "agy: FAIL install $plugin"; cat "$work/install.log"; exit 1
  }
done
"$agy" plugin list --json >"$work/list.json"
skills="$(find pstack/skills -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l)"
want_agents="$(find pstack/agents -maxdepth 1 -name '*.md' -printf '%f\n' | sed 's/\.md$//' | sort | paste -sd, -)"
read -r have_skills have_agents have_rules < <(jq -r '
  (.[] | select(.name == "pstack") | .skills | length) as $s
  | (.[] | select(.name == "pstack-agy")) as $a
  | "\($s) \($a.agents // [] | sort | join(",")) \($a.rules // [] | sort | join(","))"' "$work/list.json")
if [[ "$have_skills" == "$skills" && "$have_agents" == "$want_agents" && "$have_rules" == "pstack-adapter.md" ]]; then
  echo "agy: pstack installs $skills skills; pstack-agy installs agents $want_agents and rule pstack-adapter"
else
  echo "agy: FAIL installed pstack skills=$have_skills (want $skills), pstack-agy agents=[$have_agents] (want [$want_agents]), rules=[$have_rules] (want [pstack-adapter.md])"
  status=1
fi

# A dummy key and an unused port: /skills answers without a model call, but agy refuses to start without a key.
(cd "$work/ws" && GEMINI_API_KEY=dummy GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:9 timeout 60 "$agy" -p /skills \
  --settings "$settings" </dev/null >"$work/skills.txt" 2>&1) || true
have_names="$(cut -f1 "$work/skills.txt" | grep '^pstack:' | sort | paste -sd, - || true)"
want_names="$(find pstack/skills -mindepth 2 -maxdepth 2 -name SKILL.md | cut -d/ -f3 | sed 's/^/pstack:/' | sort | paste -sd, -)"
if [[ "$have_names" == "$want_names" ]]; then
  echo "agy: /skills lists pstack:<name> for every skill on disk, and nothing else under pstack:"
else
  echo "agy: FAIL /skills lists [$have_names], want [$want_names]"
  status=1
fi

# Prints the decoded request bodies of one print run against scripts/agy-mock-model.mjs, one JSON line per request.
mock_run() {
  local name="$1" prompt="$2"
  node scripts/agy-mock-model.mjs "$work/$name.port" "$work/$name.jsonl" "${@:3}" & mock=$!
  for _ in $(seq 50); do [[ -s "$work/$name.port" ]] && break; sleep 0.1; done
  (cd "$work/ws" && GEMINI_API_KEY=dummy GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:$(cat "$work/$name.port")" timeout 120 \
    "$agy" -p "$prompt" --settings "$settings" --dangerously-skip-permissions </dev/null >"$work/$name.out" 2>&1) || true
  kill "$mock" 2>/dev/null || true
  mock=""
  touch "$work/$name.jsonl"
}
first_body_line() { awk '/^---$/ && n < 2 {n++; next} n == 2 && NF && !/^#/ {print; exit}' "$1"; }

mock_run how "/pstack:how check-agy"
jq -r '.request.contents[]?.parts[]?.text // empty' "$work/how.jsonl" >"$work/how-user.txt"
jq -r '.request.systemInstruction.parts[]?.text // empty' "$work/how.jsonl" >"$work/how-system.txt"
how_line="$(first_body_line pstack/skills/how/SKILL.md)"
if grep -qF 'invoked the (pstack:how) skill' "$work/how-user.txt" && grep -qF "$how_line" "$work/how-user.txt"; then
  echo "agy: /pstack:how sends the how skill to the model"
else
  echo "agy: FAIL /pstack:how did not send the how skill (no 'invoked the (pstack:how) skill' with its body)"
  head -3 "$work/how.out"
  status=1
fi
rule_description="$(sed -nE '/^---$/,/^---$/s/^description: (.+)$/\1/p' .agy/rules/pstack-adapter.md 2>/dev/null | sed -E 's/^"(.*)"$/\1/' || true)"
if [[ -n "$rule_description" ]] && grep -qF "/plugins/pstack-agy/rules/pstack-adapter.md: $rule_description" "$work/how-system.txt"; then
  echo "agy: the system instruction offers rule pstack-adapter with its description"
else
  echo "agy: FAIL the system instruction does not offer pstack-agy/rules/pstack-adapter.md with its description"
  status=1
fi

for agent in poteto-agent comment-sicko; do
  mock_run "$agent" go "$agent"
  body_line="$(first_body_line "pstack/agents/$agent.md")"
  child="$(jq -c --arg line "$body_line" 'select(.reply.text == "CHILD-DONE")
    | select([.request.systemInstruction.parts[]?.text] | join("") | contains($line))
    | [.request.tools[]?.functionDeclarations[]?.name] | sort' "$work/$agent.jsonl" | head -1)"
  if [[ -n "$child" ]] && jq -e 'index("write_file") and index("edit_file") and index("run_command")' <<<"$child" >/dev/null; then
    echo "agy: invoke_subagent $agent starts a child with its body and write_file, edit_file, run_command"
  else
    echo "agy: FAIL invoke_subagent $agent, child with its body has tools [${child:-no such child}]"
    head -3 "$work/$agent.out"
    status=1
  fi
done

((status == 0)) || exit 1
echo "agy: PASS pstack and pstack-agy install, every skill is pstack:<name>, the rule is offered, both agents spawn with write tools"
