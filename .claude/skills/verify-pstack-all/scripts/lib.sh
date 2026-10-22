# Sourced by the other helpers. Not executable on its own.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$SKILL_DIR/../../.." && pwd)"
EVIDENCE_ROOT="${VERIFY_EVIDENCE:-$REPO/.verify-runs}"
CLAUDE="${CLAUDE_BIN:-$(command -v claude)}"
# mise shim breaks under a foreign HOME
GROK="${GROK_BIN:-$(mise which grok 2>/dev/null || command -v grok)}"

load_run() {
  EVIDENCE="$EVIDENCE_ROOT/${1:?usage: $0 <run-id>}"
  [[ -f "$EVIDENCE/run.env" ]] || { echo "no run $1 under $EVIDENCE_ROOT"; exit 1; }
  # shellcheck source=/dev/null
  source "$EVIDENCE/run.env"
}
