#!/usr/bin/env bash
# doctor.sh <run-id>  ->  read-only; exit 0 only when every line is OK
set -uo pipefail
source "$(dirname "$0")/lib.sh"
load_run "${1:-}"
bad=0
ok() { echo "OK   $*"; }
no() { echo "BAD  $*"; bad=1; }

# claude and grok recreate a missing config dir or HOME, so stop before calling them.
[[ -d "$instance" ]] || { no "instance $instance is gone; relaunch"; exit 1; }
ok "instance $instance exists"
for harness in $harnesses; do
  case "$harness" in
    claude)
      want="$(jq -r .version "$REPO/.claude-plugin/plugin.json")"
      config="$instance/claude-config"
      CLAUDE_CONFIG_DIR="$config" "$CLAUDE" plugin details pstack@pstack-all 2>/dev/null | grep -qx "pstack $want" &&
        ok "claude lists pstack $want" || no "claude does not list pstack $want in $config"
      installed="$(jq -r '.plugins["pstack@pstack-all"][0].installPath // empty' "$config/plugins/installed_plugins.json" 2>/dev/null)"
      if [[ -n "$installed" ]] && diff -rq "$installed/pstack" "$REPO/pstack" >/dev/null &&
        cmp -s "$installed/.claude-plugin/plugin.json" "$REPO/.claude-plugin/plugin.json"; then
        ok "claude install matches the working tree"
      else
        no "claude install is stale or missing (the repo changed since launch); clean up and relaunch"
      fi
      "$CLAUDE" auth status 2>/dev/null | jq -e .loggedIn >/dev/null &&
        ok "claude login present for drive-claude.sh" || no "claude is not logged in; drive-claude.sh will fail"
      ;;
    grok)
      line="$(HOME="$instance/grok-home" "$GROK" plugin details pstack 2>/dev/null | grep -E '^ +pstack v' | sed 's/^ *//')"
      want="pstack v$(jq -r .version "$REPO/plugin.json")"
      [[ "$line" == "$want" ]] && ok "grok loaded the root plugin.json ($line)" || no "grok loaded '$line', want '$want'"
      ;;
  esac
done
exit "$bad"
