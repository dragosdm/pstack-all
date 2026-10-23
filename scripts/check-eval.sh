#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
work="$(mktemp -d)"
mock=""
trap '[[ -n "$mock" ]] && kill "$mock" 2>/dev/null; rm -rf "$work"' EXIT
status=0

# Catalog consistency, and the graders against real transcripts committed in evals/golden.
if out="$(node evals/cells.mjs check)"; then
  sed 's/^/eval: /' <<<"$out"
else
  sed 's/^/eval: /' <<<"$out"
  status=1
fi

command -v tmux >/dev/null || { echo "eval: FAIL tmux is not installed, the Pi cells need it"; exit 1; }
mkdir -p "$work/agent"

# One Pi cell through the real driver, against a scripted model: install, session, subagents, seal, grade. No billing.
cell() {
  local script="$1" out="$2" scenario="${3:-how-complex}"
  [[ -n "$mock" ]] && kill "$mock" 2>/dev/null
  rm -f "$work/port"
  node scripts/pi-mock-model.mjs "$work/port" "$work/mock.log" "$script" & mock=$!
  for _ in $(seq 50); do [[ -s "$work/port" ]] && break; sleep 0.1; done
  jq -n --arg url "http://127.0.0.1:$(cat "$work/port")/v1" '{providers: {"pstack-mock": {baseUrl: $url, apiKey: "none",
    api: "openai-completions", models: [{id: "mock", contextWindow: 32000, maxTokens: 1024,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}}]}}}' >"$work/agent/models.json"
  PI_OFFLINE=1 node evals/cells.mjs run --scenario "$scenario" --host pi --pi-agent-dir "$work/agent" \
    --pi-model pstack-mock/mock --timeout 120 --out "$out" >"$out.log" 2>&1 || true
}

cell evals/mock/how-complex-good.json "$work/good"
good="$(jq -r '[.verdicts | to_entries[] | select(.value.verdict == "fail") | .key] | join(",")' "$work"/good/*/grade.json 2>/dev/null || echo missing)"
if [[ -z "$good" ]] && [[ "$(jq -r .ok "$work"/good/*/grade.json)" == true ]]; then
  echo "eval: a scripted correct how-complex run in Pi grades ok on every criterion"
else
  echo "eval: FAIL the scripted correct run failed [$good]"
  tail -5 "$work/good.log"
  status=1
fi

cell evals/mock/how-complex-wrong.json "$work/wrong"
wrong="$(jq -r '[.verdicts | to_entries[] | select(.value.verdict == "fail") | .key] | join(",")' "$work"/wrong/*/grade.json 2>/dev/null || echo missing)"
want="adapter,spawns,parallel,readonly,announced,noLeftover"
if [[ "$wrong" == "$want" ]]; then
  echo "eval: a scripted wrong run (no adapter read, serial writable spawns, a child left running, no fallback line) fails exactly $want"
else
  echo "eval: FAIL the scripted wrong run failed [$wrong], want [$want]"
  tail -5 "$work/wrong.log"
  status=1
fi
# Worktree children of a project-local install once never loaded the bridge and sat at a trust prompt, so wait hung.
cell evals/mock/swarm-worktree-good.json "$work/swarm" swarm-worktree
swarm="$(jq -r '[.verdicts | to_entries[] | select(.value.verdict == "fail") | .key] | join(",")' "$work"/swarm/*/grade.json 2>/dev/null || echo missing)"
if [[ -z "$swarm" ]] && [[ "$(jq -r .ok "$work"/swarm/*/grade.json)" == true ]]; then
  echo "eval: two --worktree workers of a project-local install start together, finish and are stopped"
else
  echo "eval: FAIL the scripted swarm run failed [$swarm]"
  tail -5 "$work/swarm.log"
  status=1
fi

leaked="$(tmux ls 2>/dev/null | grep -c '^pstack-subagent-' || true)"
if [[ "$leaked" != 0 ]]; then
  echo "eval: FAIL $leaked pstack-subagent tmux sessions left after the cells"
  status=1
fi

((status == 0)) || exit 1
echo "eval: PASS scenario catalog, golden transcripts, and the Pi cell pipeline grade as expected"
