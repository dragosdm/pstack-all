#!/usr/bin/env bash
# cleanup.sh <run-id>  ->  removes the run's throwaway instance, keeps its evidence
set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_run "${1:-}"
case "$instance" in
  */verify-pstack-all.*) rm -rf "$instance" ;;
  *) echo "cleanup: refusing to remove $instance, which launch.sh did not create"; exit 1 ;;
esac
echo "cleaned $instance at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$EVIDENCE/cleanup.txt"
echo "cleanup: removed $instance; evidence kept in $EVIDENCE"
ls "$EVIDENCE"
