#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=/dev/null
source base/pstack.lock
claude="${CLAUDE_BIN:-$(command -v claude)}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for manifest in .claude-plugin/plugin.json .claude-plugin/marketplace.json; do
  "$claude" plugin validate --strict "$manifest" >"$work/validate.log" 2>&1 || {
    echo "claude: FAIL validate --strict $manifest"; grep -E '❯|✘' "$work/validate.log"; exit 1
  }
done
echo "claude: $("$claude" --version), validate --strict passes on both manifests"

# Prints "<skills>|<agents>|<hooks>" as Claude Code lists them for $2 in a throwaway config dir.
install() {
  local config="$work/config-$1"
  mkdir -p "$config"
  CLAUDE_CONFIG_DIR="$config" "$claude" plugin marketplace add "$2" >"$work/install-$1.log" 2>&1 &&
    CLAUDE_CONFIG_DIR="$config" "$claude" plugin install "$3" >>"$work/install-$1.log" 2>&1 || {
    echo "claude: FAIL install $3 from $2"; cat "$work/install-$1.log"; exit 1
  }
  CLAUDE_CONFIG_DIR="$config" "$claude" plugin details "$3" >"$work/details-$1.txt"
  jq -r --arg id "$3" '.plugins[$id][0].installPath' "$config/plugins/installed_plugins.json" >"$work/path-$1"
  for kind in Skills Agents Hooks; do
    sed -nE "s/^  $kind \([0-9]+\)  (.*)/\1/p" "$work/details-$1.txt" | sed 's/  (.*//' | tr -d ' ' | tr ',' '\n' | sort | paste -sd, -
  done | paste -sd'|'
}

IFS='|' read -r skills agents hooks < <(install root "$root" pstack@pstack-all)
installed="$(cat "$work/path-root")"
want_skills="$(find pstack/skills -mindepth 2 -maxdepth 2 -name SKILL.md | cut -d/ -f3 | sort | paste -sd, -)"
want_agents="$(find pstack/agents -maxdepth 1 -name '*.md' -printf '%f\n' | sed 's/\.md$//' | sort | paste -sd, -)"
status=0

if [[ "$skills" == "$want_skills" ]]; then
  echo "claude: install lists $(tr ',' '\n' <<<"$skills" | wc -l) skills, the same names as pstack/skills"
else
  echo "claude: FAIL install lists skills [$skills], pstack/skills has [$want_skills]"
  status=1
fi
if ! diff -r "$installed/pstack" pstack >"$work/tree.diff"; then
  echo "claude: FAIL the installed pstack/ differs from the repo's pstack/"
  head -20 "$work/tree.diff"
  status=1
fi
# claude plugin details counts only a default agents/ folder, so read the installed manifest instead.
have_agents="$(jq -r '.agents[]' "$installed/.claude-plugin/plugin.json" | while read -r path; do
  [[ -f "$installed/$path" ]] && basename "$path" .md
done | sort | paste -sd, -)"
if [[ "$have_agents" == "$want_agents" ]]; then
  echo "claude: installed manifest lists agents $have_agents, each file present"
else
  echo "claude: FAIL installed manifest lists agents [$have_agents], pstack/agents has [$want_agents]"
  status=1
fi
if [[ "$hooks" != "SessionStart" ]]; then
  echo "claude: FAIL install lists hooks [$hooks], want SessionStart"
  status=1
fi
hook="$(jq -r '.hooks.SessionStart[0].hooks[0].command // empty' "$installed/.claude-plugin/plugin.json")"
adapter="$(CLAUDE_PLUGIN_ROOT="$installed" sh -c "$hook" | grep -oE '/[^ ]+\.md' || true)"
if [[ -n "$adapter" ]] && cmp -s "$adapter" pstack/docs/harness/claude-code.md; then
  echo "claude: SessionStart hook points at the installed adapter, pstack/docs/harness/claude-code.md"
else
  echo "claude: FAIL SessionStart hook names '${adapter:-nothing}', not the installed pstack/docs/harness/claude-code.md"
  status=1
fi

if [[ -n "${PSTACK_UPSTREAM_DIR:-}" ]]; then
  mkdir -p "$work/upstream"
  git -C "$PSTACK_UPSTREAM_DIR" archive "$UPSTREAM_COMMIT" | tar -x -C "$work/upstream"
  IFS='|' read -r up_skills up_agents _ < <(install upstream "$work/upstream" pstack@cursor-plugins)
  if [[ "$up_skills" == "$skills" && "$up_agents" == "$want_agents" ]]; then
    echo "claude: upstream's generated Claude tree at $UPSTREAM_COMMIT lists the same skills and agents"
  else
    echo "claude: FAIL upstream $UPSTREAM_COMMIT lists skills [$up_skills] agents [$up_agents]"
    status=1
  fi
else
  echo "claude: SKIP set PSTACK_UPSTREAM_DIR to compare with upstream's generated Claude tree"
fi

# Bills a small model call, so it is opt-in. User settings are skipped so an installed pstack can't answer for this one.
if [[ -n "${PSTACK_CLAUDE_RUNTIME:-}" ]]; then
  ask='Answer in exactly two lines, no tools. Line 1: the comma-separated subagent_type values your Agent tool offers that start with "pstack:", or NONE. Line 2: if your context contains a SessionStart hook message telling you to read a pstack Claude Code adapter file, quote the file path verbatim; otherwise write NONE.'
  probe() { (cd "$work" && "$claude" -p --setting-sources project,local --model haiku --max-turns 1 "$@" "$ask" 2>&1 | tail -2 | tr -d ' ' | paste -sd'|'); }
  control="$(probe)"
  run="$(probe --plugin-dir "$root")"
  echo "claude: runtime control [$control], with the repo [$run]"
  if [[ "$control" != "NONE|NONE" || "$run" != "pstack:comment-sicko,pstack:poteto-agent|$root/pstack/docs/harness/claude-code.md" ]]; then
    echo "claude: FAIL runtime probe"
    status=1
  fi
else
  echo "claude: SKIP set PSTACK_CLAUDE_RUNTIME=1 to probe agents and the hook in a model run"
fi

((status == 0)) || exit 1
echo "claude: PASS repo root installs pstack/ unchanged with its skills, agents and adapter hook"
