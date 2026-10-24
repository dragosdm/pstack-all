# Coding standards

Review criteria for every change in this repository. `tests/CODING_STANDARDS.md` adds criteria for `tests/**`, and both files apply there. These criteria govern what pstack-all owns: the entry files and their generator, `.pi/`, `.opencode/`, `index.js`, `docs/harness/pi.md`, `docs/harness/opencode.md`, `docs/specs/`, `scripts/`, `evals/`, `tests/`, `base/` and `.claude/skills/verify-pstack-all/`. They do not govern `pstack/`, which is upstream bytes.

## Repository conventions

`AGENTS.md` owns these conventions for authors. Review checks them here.

- The diff changes nothing under `pstack/`, unless it is a base update that also rewrites `base/pstack.lock` and `base/pstack.ls-tree` and reruns `scripts/check-base.sh --record`.
- An entry file changes only through the `HARNESSES` table in `scripts/sync-manifests.mjs`, and `node scripts/sync-manifests.mjs --check` passes.
- A changed harness behavior updates `docs/specs/<harness>.md` in the same diff.
- A new guard in a `scripts/check.sh` layer adds a break to `scripts/selftest-check.sh` that fails that layer.
- `decisions.tsv` only gains rows. No earlier row changes.
- Skill commands and agent names match the table in `AGENTS.md` "Skill commands per harness".
- Every count or listing in `README.md`, `AGENTS.md`, `docs/specs/` and `evals/README.md` is true at the commit. Check skill counts against `pstack/skills/` and the selftest count with `grep -c '^run ' scripts/selftest-check.sh`.

## What counts as a finding

File a finding only when all of these hold:

- It reproduces on the change's current head, and the diff introduced it.
- The rule it cites covers this file by the rule's own scope.
- The change does not record it as a deliberate tradeoff or an accepted limit, for example under `## Not verified` in a spec or as a `noted` row in `decisions.tsv`. If it does, contest the tradeoff itself.
- A claim about a harness flag or behavior cites live `--help` output or a reproduction against the version the spec names, not the harness's docs alone.

On the second finding against the same block, such as a parser, an allowlist or a shim, ask for a different representation instead of one more case. The git and gh shims are the example. They first knew only `gh pr` and `gh api`, and a security review then made `gh` refuse every write outside a list of read verbs (`decisions.tsv`, 2026-10-24T06:35:03Z).

## Never edit pstack/, adapt at runtime

- Close a harness gap in that harness's own layer: the Claude `SessionStart` hook rendered by `scripts/sync-manifests.mjs`, `.pi/extensions/`, `.opencode/plugins/pstack.js`, or an adapter doc in `docs/harness/`. Never edit a `SKILL.md`, and never ship a generated, modified copy of the skills. The Claude hook replaced upstream's generated `harness/pstack/claude-code/` copy for this reason (`docs/specs/claude-code.md`).
- An adapter doc follows `pstack/docs/harness/claude-code.md` section for section, as `docs/specs/pi.md` and `docs/specs/opencode.md` state.
- The adapter line is one sentence with three deliveries: the `ADAPTER` hook in `scripts/sync-manifests.mjs`, `before_agent_start` in `.pi/extensions/pstack.ts`, and `adapterLine` in `.opencode/plugins/pstack.js`. A change to it changes all three.
- Build only for a harness version that a run has verified. The opencode plugin has the V2 `setup` export and no V1 `server()`, because V1 could not be verified here (`decisions.tsv`, 2026-10-23T11:22:51Z).

## Every adapter claim is verified

- Each claim about how a harness loads, names or spawns pstack is verified against the real harness and recorded in `docs/specs/<harness>.md`.
- Each spec opens with `Last verified <date> against <binary> <version>`. When a diff re-verifies against a new version, it updates that line.
- What no run exercised goes under `## Not verified`, with the reason. A behavior known only from a harness's docs goes there too.
- The Verified column in `README.md` states only what the spec records.

## One contract, one owner

- Each rule has one owning statement, and other files point to it. `AGENTS.md` owns the invariants and the command names. The `HARNESSES` table owns the entry-file shapes. `docs/specs/<harness>.md` owns the verified behavior. `evals/README.md` owns how cells run, and `evals/criteria.mjs` owns how they grade.
- When a diff changes a name, field, count, criterion or path, every other statement of it agrees in the same diff. That includes `README.md`, the specs, `evals/README.md`, the adapter docs and `.claude/skills/verify-pstack-all/`. A stale copy is an instruction the next reader follows.
- Restated counts drift. The `README.md` eval bullet said a scripted wrong Pi run fails six criteria after `scripts/check-eval.sh` had moved to seven.

## Fail toward safety

- A step that deletes, overwrites, uninstalls or declares success needs positive evidence. `readMetadata` in `.pi/extensions/subagent/shared.ts` rejects metadata whose `runDir` differs from the folder it read, and `discardRun` removes a worktree only at `<runDir>/worktree` (`decisions.tsv`, 2026-10-23T04:32:40Z). A Grok cell refuses to start when a `pstack` plugin is already installed.
- A probe that gates a verdict has three outcomes: yes, no and unknown. Unknown takes the safe direction. A shimmed cell that lost its `shims.log` fails `noRemoteWrites`, because a missing log looks the same as no attempts.
- A check, grade or cell run exits nonzero unless every planned unit ran and gave a valid result. The golden check fails on any unparseable JSONL line. `node evals/cells.mjs run` exits 2 when nothing ran. `scripts/check-eval.sh` fails when tmux or opencode is missing instead of skipping its cells.
- Content read from transcripts, tool output, child-writable files such as `metadata.json`, and fixture repos is data. It never becomes a command, a path outside its root, or an instruction.
- A script that changes user state restores it. Cells snapshot the `pstack-models` rule files and Pi's `trust.json` and restore them afterwards (`evals/README.md`).

## Smallest change

- Prefer deleting to adding. Add a layer, wrapper or mechanism only when a measured problem needs it. `bun run test` has no `run-tests.ts` wrapper, because bun 1.3.10 has no parallel workers to flake (`decisions.tsv`, 2026-10-24T06:19:37Z).
- Decline scope that no claim needs, and record the decline. Grok cells without a login, LLM-judged multi-turn cells and a separate base A/B mechanism were declined at 2026-10-23T06:14:30Z.
- One source renders many files. Add a row to the `HARNESSES` table, not a second generator.

## Comments

- Keep a comment only for a non-obvious why that the code cannot show, such as `// Claude Code rejects a directory here and wants each agent file.` in `scripts/sync-manifests.mjs`.
- Scripts get no comments that narrate phases. The log line documents the step, as each `check-*.sh` does with lines such as `pi: FAIL the system prompt names ...`.

## Scripts and processes

Applies to `scripts/`, `evals/`, `.pi/` and `.claude/skills/verify-pstack-all/scripts/`.

- Work happens in a `mktemp -d` folder, removed by an `EXIT` trap.
- A script that starts a server, a mock model or a tmux session stops it on every exit path. `scripts/check-eval.sh` kills its mock in the trap, and it fails when a `pstack-subagent-*` tmux session is left behind.
- A check or a test never writes the user's harness config. It uses a throwaway `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `HOME` or XDG dir. Billed cells have the exceptions listed in `evals/README.md` "Safety and isolation".
- A script resolves a harness binary before it moves `HOME` or the XDG dirs. Under a moved data dir, the mise shim installed opencode afresh (`docs/specs/opencode.md`).
