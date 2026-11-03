#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# Resolve the binary before HOME moves, as for grok.
codex="${CODEX_BIN:-$(mise which codex 2>/dev/null || command -v codex)}"
work="$(mktemp -d)"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
export HOME="$work/home" CODEX_HOME="$work/codex" XDG_CONFIG_HOME="$work/config"
mkdir -p "$HOME" "$CODEX_HOME" "$XDG_CONFIG_HOME" "$work/cwd"
status=0
fail() { echo "codex: FAIL $*"; status=1; }

node scripts/codex-mock-model.mjs "$work/mock.port" "$work/mock.log" & pids+=($!)
for _ in $(seq 50); do [[ -s "$work/mock.port" ]] && break; sleep 0.1; done
# Top-level keys go first, because `codex plugin` appends its tables to this file.
printf 'model = "mock"\nmodel_provider = "pstack-mock"\n\n[model_providers.pstack-mock]\nname = "pstack mock"\nbase_url = "http://127.0.0.1:%s/v1"\nwire_api = "responses"\n' \
  "$(cat "$work/mock.port")" >"$CODEX_HOME/config.toml"

echo "codex: $("$codex" --version 2>/dev/null), the repo root is a local marketplace in a throwaway CODEX_HOME"
if ! "$codex" plugin marketplace add "$root" >"$work/marketplace.log" 2>&1; then
  fail "codex plugin marketplace add $root"
  cat "$work/marketplace.log"
  exit 1
fi
# Without .agents/plugins/marketplace.json, Codex 0.165.0 falls back to .claude-plugin/marketplace.json.
"$codex" plugin list >"$work/list.txt" 2>/dev/null || true
if grep -qxF "$root/.agents/plugins/marketplace.json" "$work/list.txt"; then
  echo "codex: the pstack-all marketplace is read from .agents/plugins/marketplace.json"
else
  fail "codex plugin list does not read the pstack-all marketplace from .agents/plugins/marketplace.json"
fi
if ! "$codex" plugin add pstack@pstack-all --json >"$work/add.json" 2>"$work/add.log"; then
  fail "codex plugin add pstack@pstack-all"
  cat "$work/add.log"
  exit 1
fi
version="$(jq -r .version .codex-plugin/plugin.json)"
installed="$(jq -r .installedPath "$work/add.json")"
if [[ "$(jq -r .version "$work/add.json")" == "$version" && -d "$installed/pstack/skills" ]]; then
  echo "codex: pstack@pstack-all installed version $version into the plugin cache"
else
  fail "codex plugin add returned $(jq -c . "$work/add.json")"
fi

# Codex runs a plugin hook only once the user trusts it. The TUI asks at startup and writes these two hashes.
node scripts/codex-hooks.mjs "$codex" "$work/cwd" >"$work/hooks.json" || fail "the app-server did not answer hooks/list"
hooks="$(jq -c '[.data[]?.hooks[]? | select(.pluginId == "pstack@pstack-all") | {key, eventName, trustStatus}]' "$work/hooks.json")"
if [[ "$hooks" == '[{"key":"pstack@pstack-all:.codex-plugin/hooks.json:session_start:0:0","eventName":"sessionStart","trustStatus":"untrusted"}]' ]]; then
  echo "codex: hooks/list shows the pstack SessionStart hook from .codex-plugin/hooks.json, untrusted until the user trusts it"
else
  fail "hooks/list shows pstack hooks $hooks"
fi
jq -r '.data[].hooks[] | select(.pluginId == "pstack@pstack-all") | (.currentHash | split("/")) as $h
  | "\n[hooks.state.\"\(.key)\"]\ntrusted_hash = \"\($h[0])\"\ntrusted_content_hash = \"\($h[1])\""' \
  "$work/hooks.json" >>"$CODEX_HOME/config.toml" || fail "could not write the pstack hook trust from hooks/list"

# One turn that names the largest skill, so a truncated body cannot pass.
probe=poteto-mode
(cd "$work/cwd" && RUST_LOG=codex_core_plugins=warn "$codex" exec --skip-git-repo-check "Use \$pstack:$probe" </dev/null >"$work/exec.log" 2>&1) ||
  fail "codex exec exited non-zero"
if grep -qE 'Agent Plugins manifest.*/pstack-all/pstack/' "$work/exec.log"; then
  fail "Codex read pstack as an Agent Plugin, not through .codex-plugin/plugin.json"
  grep -F 'Agent Plugins manifest' "$work/exec.log" | head -3
fi

jq -r 'select(.method == "POST") | .body.input[] | .content[]?.text // empty' "$work/mock.log" >"$work/input.txt"
adapter="$(grep -oE 'read /[^ ]+\.md once per session' "$work/input.txt" | head -1 | cut -d' ' -f2 || true)"
if [[ "$adapter" == "$installed/docs/harness/codex.md" ]] && cmp -s "$adapter" docs/harness/codex.md; then
  echo "codex: the trusted hook gives the model the adapter line, naming the installed docs/harness/codex.md"
else
  fail "the model's input names '${adapter:-no adapter}', which is not $installed/docs/harness/codex.md, or is missing, or differs from docs/harness/codex.md"
fi
want="$(find pstack/skills -mindepth 2 -maxdepth 2 -name SKILL.md | cut -d/ -f3 | sort | paste -sd, -)"
have="$({ grep -oE '^- pstack:[^:]+:' "$work/input.txt" || true; } | sed -E 's/^- pstack:(.*):$/\1/' | sort -u | paste -sd, -)"
if [[ -n "$have" && "$have" == "$want" ]]; then
  echo "codex: the model's skill list names $(tr ',' '\n' <<<"$have" | wc -l) pstack: skills, the same names as pstack/skills"
else
  fail "the model's skill list names pstack: skills [$have], pstack/skills has [$want]"
fi

# Codex wraps the file as "<skill>\n<name>…</name>\n<path>…</path>\n" + file + "\n</skill>".
jq -j --arg name "<name>pstack:$probe</name>" 'select(.method == "POST") | .body.input[] | .content[]?.text // empty
  | select(startswith("<skill>\n\($name)\n")) | .[(index("</path>\n") + 8):] | rtrimstr("\n</skill>")' \
  "$work/mock.log" >"$work/body.md"
if cmp -s "$work/body.md" "pstack/skills/$probe/SKILL.md"; then
  echo "codex: \$pstack:$probe reached the model as the whole SKILL.md, $(wc -c <"$work/body.md") bytes"
else
  fail "\$pstack:$probe reached the model as $(wc -c <"$work/body.md") bytes, pstack/skills/$probe/SKILL.md has $(wc -c <"pstack/skills/$probe/SKILL.md")"
fi

((status == 0)) && echo "codex: PASS"
exit "$status"
