#!/usr/bin/env bash
# launch.sh [claude|grok|all]  ->  last line: READY run=<id> evidence=<dir>
set -euo pipefail
source "$(dirname "$0")/lib.sh"

harnesses="${1:-all}"
[[ "$harnesses" == all ]] && harnesses="claude grok"
id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
instance="$(mktemp -d "${TMPDIR:-/tmp}/verify-pstack-all.XXXXXX")"
EVIDENCE="$EVIDENCE_ROOT/$id"
mkdir -p "$EVIDENCE"
printf 'instance=%q\nharnesses=%q\nrepo=%q\n' "$instance" "$harnesses" "$REPO" >"$EVIDENCE/run.env"
{ git -C "$REPO" rev-parse HEAD; git -C "$REPO" status --porcelain; } >"$EVIDENCE/repo-state.txt"

for harness in $harnesses; do
  case "$harness" in
    claude)
      export CLAUDE_CONFIG_DIR="$instance/claude-config"
      mkdir -p "$CLAUDE_CONFIG_DIR"
      { "$CLAUDE" --version
        "$CLAUDE" plugin marketplace add "$REPO"
        "$CLAUDE" plugin install pstack@pstack-all; } >"$EVIDENCE/claude-install.log" 2>&1 || {
        echo "launch: FAIL claude install, see $EVIDENCE/claude-install.log"; exit 1; }
      "$CLAUDE" plugin details pstack@pstack-all >"$EVIDENCE/claude-details.txt"
      unset CLAUDE_CONFIG_DIR
      ;;
    grok)
      mkdir -p "$instance/grok-home"
      HOME="$instance/grok-home" "$GROK" plugin install "$REPO" --trust >"$EVIDENCE/grok-install.log" 2>&1 || {
        echo "launch: FAIL grok install, see $EVIDENCE/grok-install.log"; exit 1; }
      HOME="$instance/grok-home" "$GROK" plugin details pstack >"$EVIDENCE/grok-details.txt" 2>&1
      (cd "$instance" && HOME="$instance/grok-home" "$GROK" inspect --json) | jq -S '{
        skills: [.skills[] | select(.source.plugin_name == "pstack") | .name] | sort,
        agents: [.agents[] | select(.source.plugin_name == "pstack") | .name] | sort
      }' >"$EVIDENCE/grok-inventory.json"
      ;;
    *) echo "launch: unknown harness $harness"; exit 1 ;;
  esac
done
echo "READY run=$id evidence=$EVIDENCE"
