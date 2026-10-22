#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# mise shim breaks under a foreign HOME
grok="${GROK_BIN:-$(mise which grok 2>/dev/null || command -v grok)}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

inventory() {
  local home="$work/home-$2"
  mkdir -p "$home"
  HOME="$home" "$grok" plugin install "$1" --trust >"$work/install-$2.log" 2>&1 || {
    echo "grok: FAIL install $1"; cat "$work/install-$2.log"; exit 1
  }
  HOME="$home" "$grok" plugin details pstack >"$work/details-$2.txt" 2>&1
  (cd "$work" && HOME="$home" "$grok" inspect --json) | jq -S '{
    skills: [.skills[] | select(.source.plugin_name == "pstack") | {name, description, userInvocable}] | sort_by(.name),
    agents: [.agents[] | select(.source.plugin_name == "pstack") | {name, description}] | sort_by(.name)
  }' >"$work/$2.json"
}

inventory "$root/pstack" base
inventory "$root" root

skills="$(find "$root/pstack/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l)"
agents="$(find "$root/pstack/agents" -maxdepth 1 -name '*.md' | wc -l)"
read -r base_skills base_agents < <(jq -r '"\(.skills | length) \(.agents | length)"' "$work/base.json")
read -r root_skills root_agents < <(jq -r '"\(.skills | length) \(.agents | length)"' "$work/root.json")
echo "grok: $("$grok" --version | head -1), pstack/ has $skills skills and $agents agents"
echo "grok: pstack/ install found $base_skills skills, $base_agents agents; repo root install found $root_skills skills, $root_agents agents"

if [[ "$base_skills $base_agents" != "$skills $agents" ]]; then
  echo "grok: FAIL the pstack/ install does not see every skill and agent on disk, so the comparison means nothing"
  exit 1
fi
loaded="$(grep -E '^ +pstack v' "$work/details-root.txt" | sed 's/^ *//' || true)"
version="$(jq -r .version "$root/plugin.json" 2>/dev/null || echo missing)"
if [[ "$loaded" != "pstack v$version" ]]; then
  echo "grok: FAIL repo root install loaded '$loaded', not the root plugin.json (version $version)"
  echo "grok: without a root plugin.json grok falls back to a subdir or to .claude-plugin/plugin.json"
  exit 1
fi
echo "grok: repo root install loaded the root plugin.json ($loaded)"
if ! diff -u "$work/base.json" "$work/root.json"; then
  echo "grok: FAIL repo root install differs from pstack/ install"
  exit 1
fi
echo "grok: PASS repo root install matches pstack/ install"
