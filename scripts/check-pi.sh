#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
pi="${PI_BIN:-$(mise which pi 2>/dev/null || command -v pi)}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export PI_CODING_AGENT_DIR="$work/agent"
mkdir -p "$PI_CODING_AGENT_DIR" "$work/cwd"
status=0

# Sends one RPC line to a fresh pi and keeps stdout; no model is called.
rpc() {
  (echo "$1"; sleep "${2:-4}") | (cd "$work/cwd" && PI_OFFLINE=1 timeout 60 "$pi" --mode rpc --no-session) 2>"$work/rpc.err" || true
}

"$pi" install "$root" >"$work/install.log" 2>&1 || {
  echo "pi: FAIL install $root"; cat "$work/install.log"; exit 1
}
echo "pi: $("$pi" --version), installed the repo root into a throwaway PI_CODING_AGENT_DIR"

# The user's own ~/.agents/skills also load, so keep only skills read from this repo's pstack/skills.
pstack_skills() { jq -r --arg dir "$root/pstack/skills/" 'select(.command == "get_commands") | .data.commands[]
  | select(.source == "skill" and (.sourceInfo.path | startswith($dir))) | .name | ltrimstr("skill:")' "$1" | sort | paste -sd, -; }
# Every name, suffixed or not, so a duplicate registration (/pstack:how:1) shows up as a mismatch.
pstack_commands() { jq -r 'select(.command == "get_commands") | .data.commands[]
  | select(.source == "extension" and (.name | startswith("pstack:"))) | .name | ltrimstr("pstack:")' "$1" | sort | paste -sd, -; }
rpc '{"type":"get_commands"}' >"$work/commands.json"
have_skills="$(pstack_skills "$work/commands.json")"
want_skills="$(find pstack/skills -mindepth 2 -maxdepth 2 -name SKILL.md | cut -d/ -f3 | sort | paste -sd, -)"
if [[ -n "$have_skills" && "$have_skills" == "$want_skills" ]]; then
  echo "pi: get_commands lists $(tr ',' '\n' <<<"$have_skills" | wc -l) skills from pstack/skills, the same names as on disk"
else
  echo "pi: FAIL get_commands lists pstack skills [$have_skills], pstack/skills has [$want_skills]"
  status=1
fi
have_commands="$(pstack_commands "$work/commands.json")"
if [[ "$have_commands" == "$want_skills" ]]; then
  echo "pi: get_commands lists an extension command pstack:<name> for every pstack skill, so they show in the / menu"
else
  echo "pi: FAIL get_commands lists pstack:<name> commands [$have_commands], want [$want_skills]"
  status=1
fi
# The extension parses each description itself, at load, so it must agree with Pi's own parse of the skill.
differ="$(jq -rs '[.[] | select(.command == "get_commands") | .data.commands[]] as $all
  | ($all | map(select(.source == "skill")) | map({key: (.name | ltrimstr("skill:")), value: .description}) | from_entries) as $skill
  | $all[] | select(.source == "extension" and (.name | startswith("pstack:")))
  | select(.description != $skill[.name | ltrimstr("pstack:")]) | .name' "$work/commands.json" | paste -sd, -)"
if [[ -n "$have_commands" && -z "$differ" ]]; then
  echo "pi: every pstack:<name> has the same description as Pi's skill:<name>"
else
  echo "pi: FAIL pstack:<name> descriptions differ from Pi's skill:<name> for [$differ]"
  status=1
fi
if grep -qiE 'error|failed' "$work/rpc.err"; then
  echo "pi: FAIL pi reported errors at startup"
  head -5 "$work/rpc.err"
  status=1
fi

# Inside this checkout, with nothing installed, Pi still auto-loads the trusted project's .pi/extensions but not the
# package.json pi.skills, so the skills must come from the extension or the adapter line arrives with no skills.
mkdir -p "$work/bare"
(echo '{"type":"get_commands"}'; sleep 4) | PI_CODING_AGENT_DIR="$work/bare" PI_OFFLINE=1 timeout 60 "$pi" --mode rpc \
  --no-session --approve >"$work/bare.json" 2>/dev/null || true
in_repo="$(pstack_skills "$work/bare.json") $(pstack_commands "$work/bare.json")"
if [[ "$in_repo" == "$want_skills $want_skills" ]]; then
  echo "pi: run inside the checkout with nothing installed, get_commands still lists every pstack skill and pstack:<name>"
else
  echo "pi: FAIL run inside the checkout with nothing installed, get_commands lists pstack skills and commands [$in_repo]"
  status=1
fi
# Inside this checkout with pstack also installed from another path, such as a git install, the extension loads twice,
# and Pi would suffix both copies' commands (/pstack:how:1, /pstack:how:2). The same path loads once, so use a copy.
mkdir -p "$work/copy" "$work/twice"
git ls-files -co --exclude-standard | tar -cf - -T - | tar -xf - -C "$work/copy"
PI_CODING_AGENT_DIR="$work/twice" "$pi" install "$work/copy" >/dev/null 2>&1 || true
(echo '{"type":"get_commands"}'; sleep 4) | PI_CODING_AGENT_DIR="$work/twice" PI_OFFLINE=1 timeout 60 "$pi" --mode rpc --no-session \
  --approve >"$work/twice.json" 2>/dev/null || true
twice="$(pstack_commands "$work/twice.json")"
if [[ "$twice" == "$want_skills" ]]; then
  echo "pi: run inside the checkout with pstack installed from another path too, each pstack:<name> is listed once, without a suffix"
else
  echo "pi: FAIL run inside the checkout with pstack installed from another path too, pstack:<name> commands are [$twice]"
  status=1
fi

# A real print-mode run against a dummy provider. The extension below saves the request pi would send, after every
# before_agent_start handler has run, and exits before sending it.
cat >"$work/dump.ts" <<'EOF'
import { writeFileSync } from "node:fs"
export default function (pi: any) {
  pi.registerProvider("pstack-check", {
    baseUrl: "http://127.0.0.1:9", apiKey: "none", api: "openai-completions",
    models: [{ type: "chat", id: "none", name: "none", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 64 }],
  })
  pi.on("before_provider_request", async (event: any) => { writeFileSync(process.env.PSTACK_REQUEST!, JSON.stringify(event.payload)); process.exit(0) })
}
EOF
# pi -p reads piped stdin, so close it or the run waits forever.
(cd "$work/cwd" && PI_OFFLINE=1 PSTACK_REQUEST="$work/request.json" timeout 60 "$pi" -p --no-session --no-context-files \
  --model pstack-check/none -e "$work/dump.ts" hi </dev/null >"$work/print.log" 2>&1) || true
jq -r '.messages[] | select(.role == "system" or .role == "developer") | .content
  | if type == "string" then . else map(.text) | join("") end' "$work/request.json" >"$work/prompt.txt" 2>/dev/null || true
adapter="$(grep -oE 'read /[^ ]+\.md once per session' "$work/prompt.txt" 2>/dev/null | cut -d' ' -f2 || true)"
if [[ -n "$adapter" ]] && cmp -s "$adapter" docs/harness/pi.md; then
  echo "pi: the system prompt of a print run tells the model to read docs/harness/pi.md"
else
  echo "pi: FAIL the system prompt names '${adapter:-no adapter}', not docs/harness/pi.md"
  head -3 "$work/print.log"
  status=1
fi
# Pi hides skills with disable-model-invocation: true from the model, as Cursor and Claude Code do; /skill:<name> still runs them.
offered="$(grep -oE "<location>$root/pstack/skills/[^/]+/SKILL.md</location>" "$work/prompt.txt" 2>/dev/null | sed -E 's#.*/pstack/skills/([^/]+)/.*#\1#' | sort | paste -sd, - || true)"
want_offered="$(grep -L '^disable-model-invocation: true' pstack/skills/*/SKILL.md | cut -d/ -f3 | sort | paste -sd, -)"
if [[ -n "$offered" && "$offered" == "$want_offered" ]]; then
  echo "pi: the system prompt offers the model $offered, every pstack skill without disable-model-invocation"
else
  echo "pi: FAIL the system prompt offers [$offered], want [$want_offered]"
  status=1
fi
# Users type /pstack:<name>, the standard shared with Claude Code and opencode; Pi must load the skill for it.
(cd "$work/cwd" && PI_OFFLINE=1 PSTACK_REQUEST="$work/alias.json" timeout 60 "$pi" -p --no-session --no-context-files \
  --model pstack-check/none -e "$work/dump.ts" "/pstack:how check-pi" </dev/null >"$work/alias.log" 2>&1) || true
alias_text="$(jq -r '[.messages[] | select(.role == "user") | .content
  | if type == "string" then . else map(.text) | join("") end] | last' "$work/alias.json" 2>/dev/null || true)"
if [[ "$alias_text" == "<skill name=\"how\" location=\"$root/pstack/skills/how/SKILL.md\">"* && "$alias_text" == *check-pi ]]; then
  echo "pi: /pstack:how loads the how skill with its arguments"
else
  echo "pi: FAIL /pstack:how sent [$(head -c 80 <<<"$alias_text")], not the how skill"
  status=1
fi

# A real spawn: a scripted model (scripts/pi-mock-model.mjs) has the parent run pstack-subagent through bash, and each
# child answers with the agent prompt, tools and cwd it got. Registered in models.json so the tmux children see it too.
command -v tmux >/dev/null || { echo "pi: FAIL tmux is not installed, the subagent extension needs it"; exit 1; }
node scripts/pi-mock-model.mjs "$work/mock.port" "$work/mock.log" & mock=$!
trap 'kill "$mock" 2>/dev/null; rm -rf "$work"' EXIT
for _ in $(seq 50); do [[ -s "$work/mock.port" ]] && break; sleep 0.1; done
jq -n --arg url "http://127.0.0.1:$(cat "$work/mock.port")/v1" '{providers: {"pstack-mock": {baseUrl: $url, apiKey: "none",
  api: "openai-completions", models: [{id: "mock", contextWindow: 32000, maxTokens: 1024,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}}]}}}' >"$PI_CODING_AGENT_DIR/models.json"
mkdir -p "$work/repo" && git -C "$work/repo" init -q && git -C "$work/repo" -c user.name=check -c user.email=check@invalid commit -q --allow-empty -m init
(cd "$work/repo" && PI_OFFLINE=1 timeout 240 "$pi" -p --no-session --no-context-files --model pstack-mock/mock go </dev/null >"$work/spawn.log" 2>&1) || true
want_children="CHILD agent=comment-sicko tools=find,grep,ls,read worktree=no
CHILD agent=poteto-agent tools=bash,edit,read,write worktree=yes"
if [[ "$(grep '^CHILD ' "$work/spawn.log")" == "$want_children" ]]; then
  echo "pi: a print run spawned comment-sicko read-only and poteto-agent in a worktree through pstack-subagent, and waited for both"
else
  echo "pi: FAIL pstack-subagent spawn, want [$want_children]"
  head -20 "$work/spawn.log"
  status=1
fi
branch="$(sed -nE 's/^Stopped poteto \([a-z0-9]+\), kept branch (.+)$/\1/p' "$work/spawn.log")"
leftovers="$(ls "$PI_CODING_AGENT_DIR/pstack-subagents" 2>/dev/null; git -C "$work/repo" worktree list | tail -n +2; tmux ls 2>/dev/null | grep -o '^pstack-subagent-[a-z0-9]*' || true)"
if [[ -n "$branch" ]] && git -C "$work/repo" rev-parse -q --verify "refs/heads/$branch" >/dev/null && [[ -z "$leftovers" ]]; then
  echo "pi: stop removed both runs, their tmux sessions and the worktree, and kept branch $branch"
else
  echo "pi: FAIL stop left [$leftovers] or lost the worktree branch '${branch}'"
  status=1
fi

((status == 0)) || exit 1
echo "pi: PASS repo root installs as a Pi package with every pstack skill, the adapter extension, and working subagents"
