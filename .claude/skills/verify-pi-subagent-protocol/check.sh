#!/usr/bin/env bash
# Model-check the pstack-subagent protocol (spec/PiSubagent.tla) with TLC, and report drift of the covered code.
#
#   .claude/skills/verify-pi-subagent-protocol/check.sh            every row of the table below
#   .claude/skills/verify-pi-subagent-protocol/check.sh <row>      one row, with TLC's full output and trace
#
# Exit 0: every row ended as expected and the covered code has not changed since SYNC.
# Exit 1: a row ended differently from its expectation. Exit 2: the covered code drifted (see SKILL.md).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)

# The commit at which the model was last confirmed to describe the covered code. Move it only after that check.
SYNC=2e52b4c
COVERED=(.pi/extensions/subagent/shared.ts .pi/extensions/subagent/index.ts .pi/extensions/subagent/subagent.ts)

# name | N | WithRename | WithQuit | Mutant | invariant | expect
#   pass     TLC must find no error.
#   finding  TLC must report this invariant violated: a known bug in the current code (SKILL.md, Findings).
#   mutant   TLC must report this invariant violated: proof that the property can fail.
ROWS='
exactly-once         |2|FALSE|FALSE|none               |ExactlyOnce          |pass
idle-means-answered  |2|FALSE|FALSE|none               |IdleMeansAnswered    |pass
wait-fresh-reply     |2|FALSE|FALSE|none               |WaitReturnsFreshReply|pass
rename-lost-update   |2|TRUE |FALSE|none               |IdleMeansAnswered    |finding
quit-lost-suspend    |1|FALSE|TRUE |none               |SuspendKept          |finding
mutant-skip-unlink   |2|FALSE|FALSE|skip-unlink        |ExactlyOnce          |mutant
mutant-skip-busy     |2|FALSE|FALSE|skip-mark-busy     |IdleMeansAnswered    |mutant
mutant-settle-idle   |2|FALSE|FALSE|settle-ignores-idle|IdleMeansAnswered    |mutant
mutant-wait-order    |2|FALSE|FALSE|meta-before-inbox  |WaitReturnsFreshReply|mutant
'

TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
jar=${TLA2TOOLS_JAR:-${XDG_CACHE_HOME:-$HOME/.cache}/pstack-all/tla2tools-$TLA_VERSION.jar}
if [[ ! -f $jar ]]; then
	mkdir -p "$(dirname "$jar")"
	curl -fsSL -o "$jar.part" "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar"
	mv "$jar.part" "$jar"
fi
echo "$TLA_SHA256  $jar" | sha256sum -c --quiet - || { echo "tla2tools.jar is not v$TLA_VERSION: $jar" >&2; exit 1; }
command -v java >/dev/null || { echo "java is not on PATH" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$here/spec/PiSubagent.tla" "$work/"

only=${1:-}
failed=0
while IFS='|' read -r name n rename quit mutant inv expect; do
	name=$(echo "$name" | xargs); [[ -z $name ]] && continue
	[[ -n $only && $only != "$name" ]] && continue
	mutant=$(echo "$mutant" | xargs); inv=$(echo "$inv" | xargs); expect=$(echo "$expect" | xargs)
	cat >"$work/$name.cfg" <<-EOF
		CONSTANTS N = $n  WithRename = $(echo "$rename" | xargs)  WithQuit = $(echo "$quit" | xargs)  Mutant = "$mutant"
		SPECIFICATION Spec
		INVARIANTS TypeOK $inv
	EOF
	# -deadlock: a finished run is a terminal state, not a deadlock. Liveness is not checked (SKILL.md, Scope).
	out=$(cd "$work" && java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -deadlock -workers auto \
		-metadir "$work/states-$name" -config "$name.cfg" PiSubagent.tla 2>&1) || true
	if grep -q "No error has been found" <<<"$out"; then got=pass
	elif grep -q "Invariant $inv is violated" <<<"$out"; then got=violated
	else got=error; fi
	states=$(grep -oE '[0-9,]+ distinct states found' <<<"$out" | head -1 || true)
	if [[ $expect == pass && $got == pass ]] || [[ $expect != pass && $got == violated ]]; then
		printf 'ok    %-20s %-22s %-8s %s\n' "$name" "$inv" "$expect" "$states"
	else
		printf 'FAIL  %-20s %-22s expected %s, got %s\n' "$name" "$inv" "$expect" "$got"
		[[ $expect == finding && $got == pass ]] && echo "      The finding no longer reproduces. If the code was fixed, change the row to pass (SKILL.md)."
		failed=1
	fi
	[[ -n $only ]] && echo "$out"
done <<<"$ROWS"

# A squash merge or rebase rewrites the sync commit, and git diff against a missing commit fails without stopping the script.
if ! git -C "$repo" merge-base --is-ancestor "$SYNC" HEAD 2>/dev/null; then
	echo "FAIL  SYNC=$SYNC is not in this checkout's history; set it to the commit on main where the model was last confirmed"
	exit 1
fi
drift=$(git -C "$repo" diff --name-only "$SYNC" -- "${COVERED[@]}")
if [[ -n $drift ]]; then
	echo "DRIFT covered code changed since $SYNC; review it against the model (SKILL.md, When the code changes):"
	sed 's/^/      /' <<<"$drift"
	[[ $failed == 0 ]] && exit 2
fi
exit $failed
