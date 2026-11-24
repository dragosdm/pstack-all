---
name: verify-pi-subagent-protocol
description: Model-check the Pi adapter's pstack-subagent protocol (send, inbox poll, metadata.json state, wait, rename, suspend on parent quit) with TLA+ and TLC. Use when a change touches .pi/extensions/subagent/shared.ts, index.ts or subagent.ts, especially readMetadata, writeMetadata, updateMetadata, childRole, parentRole, sendSubagent, waitSubagent or renameSubagent, or when `wait` returns a stale answer, hangs, or a suspended subagent is not resumed.
---

# Verify the pstack-subagent protocol

`pstack-subagent` runs a Pi child in tmux and talks to it through files under `<agent dir>/pstack-subagents/<handle>/`. `send` drops a JSON file in `inbox/`. The child's extension polls the inbox, hands the message to pi, and records the run's state in `metadata.json`. `wait` decides from `metadata.json` and the inbox that the child has finished, then prints the latest assistant reply. Three processes write `metadata.json` with an unlocked read-then-rename (`updateMetadata` in `shared.ts`): the child, the `rename` CLI, and the parent pi when it quits. Tests run one order of these steps. This check runs every order.

## The properties

| Invariant | Plain statement | Harm if broken |
| --- | --- | --- |
| `WaitReturnsFreshReply` | A `wait` that exits 0 prints a reply to every message sent before it started. | The parent agent acts on the child's previous answer as if it were the answer to its new message. |
| `IdleMeansAnswered` | When `metadata.json` says `hasStarted` and `idle` and the inbox is empty, the latest reply answers every message sent. | `wait` trusts exactly this, so a break makes `wait` return early. |
| `ExactlyOnce` | Each message in the inbox reaches `pi.sendUserMessage` at most once. | The child runs the same instruction twice. |
| `SuspendKept` | After the parent marks a run `suspended` and kills its tmux session, the mark stays. | On resume the child is not relaunched, and the next quit runs `discardRun`, which deletes the run's transcript. |

## Run it

```
.claude/skills/verify-pi-subagent-protocol/check.sh           # every row, about 5 s
.claude/skills/verify-pi-subagent-protocol/check.sh <row>     # one row, with TLC's output and counterexample
```

It needs `java` 11 or newer and TLC 1.7.4. It uses `$TLA2TOOLS_JAR` if set, otherwise it downloads the v1.7.4 release jar into `~/.cache/pstack-all/` once. Either way it checks the jar against a pinned sha256. With mise, `TLA2TOOLS_JAR=$(mise where http:tla2tools)/tla2tools.jar` reuses an installed copy.

Each row in `ROWS` in `check.sh` names a configuration, one invariant and the expected outcome:

- `pass`: TLC must find no error.
- `finding`: TLC must find this invariant violated. These are known bugs in the current code, listed below. They stay `finding` until the code is fixed. Never weaken the model or the invariant to make them pass.
- `mutant`: the spec's `Mutant` constant breaks one step on purpose, and TLC must find the violation. These rows prove the `pass` rows can fail.

Exit 0 means every row ended as expected and the covered code has not changed since `SYNC`. Exit 1 means a row ended differently from its expectation. Exit 2 means only the drift check failed.

## Coverage

Sync commit: `SYNC=2e52b4c` in `check.sh`. The model was last confirmed against the covered files at that commit.

| Model action (`spec/PiSubagent.tla`) | Code |
| --- | --- |
| `Init` | `spawnSubagent` in `subagent.ts`: `writeMetadata` with `state: "starting"`, then `launchRun` with `@task.md` |
| `ChildRead`, `ChildWrite` | `updateMetadata` and `writeMetadata` in `shared.ts`: read, merge, tmp file, `renameSync` |
| `ChildSessionStart` | `childRole().sessionStart` in `index.ts` |
| `ChildAgentStart`, `ChildAgentSettled` | `childRole().agentStart`, `agentSettled` |
| `ChildPollStart`, `ChildPollNext`, `ChildPollSend`, `ChildPollUnlink` | `processInbox` in `childRole`: `readdirSync`, `updateMetadata busy`, `pi.sendUserMessage`, `unlinkSync` |
| `ChildShutdown` | `childRole().sessionShutdown` with reason `quit` |
| `DSendCheck`, `DSendWrite` | `sendSubagent`: `getRun`, `tmuxSessionExists`, tmp file, `renameSync` into `inbox/`. After a send the driver may wait or send again, as a steer or `--follow-up` does |
| `DWaitInbox`, `DWaitMeta`, `DWaitDecide`, `DWaitRead` | `waitSubagent`'s loop, in code order: `readdirSync(inbox)`, `getRun`, `effectiveRunState`, `readLatestAssistant` |
| `RRead`, `RWrite` | `renameSubagent`: `updateMetadata(..., {name})` |
| `QStep` | `parentRole().sessionShutdown`: `listRuns`, `tmuxSessionExists`, `updateMetadata({suspended: true})`, `tmux kill-session`, `waitForRunShutdown` |
| `PiTakeTask`, `PiAgentStart`, `PiTurnBegin`, `PiTurnEnd`, `PiRunAgain`, `PiSettle` | pi's agent loop, from pi 1.5.2's `docs/extensions.md` and `docs/json.md`, not from code in this repo |

One TLC step is one file operation or one pi event. The child's steps never interleave with each other, because pi and the extension share one JS event loop, and `processInbox` has no `await`. Only the other processes interleave between them.

## Scope

Verified, for every order of steps: one run, the task plus N = 2 sent messages (N = 1 with quit), each followed by a `wait` or by the next `send`, at most one `rename`, and one parent quit. Each row explores fewer than 5,000 states.

Assumptions, from pi's docs rather than its code:

- `sendUserMessage` while idle makes `ctx.isIdle()` false before it returns ("Pi counts as busy while a run starts").
- `ctx.isIdle()` is true when the `agent_settled` handler runs.
- Pi waits for an event's handler before it goes on. The poll timer can still run between an event and its handler, which the model allows.
- `tmux kill-session` makes the child run `session_shutdown` with reason `quit`.

Not covered:

- Liveness. TLC runs with `-deadlock`, and no property says that `wait` eventually returns. A lost `hasStarted` from `rename` makes `wait` spin until its timeout. The model can reach that state, but no invariant reports it.
- `wait --timeout`, `stop`, `list`, `status`, `discardRun`, worktrees, the `/pstack-subagent` attach command, and relaunch on resume.
- A crash between `sendUserMessage` and `unlinkSync`, which would deliver the message twice on restart. Invalid inbox JSON and a throwing `sendUserMessage` are also left out.
- More than one run, more than one waiter, and the parent spawning while a run quits.
- The bodies of `readLatestAssistant` and `activeBranch`. The model treats "the latest reply" as the messages in the conversation when the last turn's request went out.

## Findings in the current code

Each is a `finding` row. Run `check.sh <row>` for the full trace.

1. `rename-lost-update`: `rename` can overwrite the child's state. `renameSubagent` reads `metadata.json` while the child is `idle`. The child then marks it `busy` for message 1 and deletes the inbox file. `rename` writes back its stale copy, so `metadata.json` says `idle` and the inbox is empty while message 1 is unanswered. The same lost write can reset `hasStarted` to false, so `wait` spins until its timeout. Reach: no adapter doc, skill or eval tells a model to run `rename`. Only its usage text names it, and the race needs a child write within about 30 to 60 µs of the rename.
2. `quit-lost-suspend`: the parent's `suspended` mark can be lost. `parentRole().sessionShutdown` writes `suspended: true` between a child handler's read and write of `metadata.json`, and the child's write carries the old value back. On resume the run is not relaunched, and the next quit runs `discardRun` on it, which deletes its task and session. Reach: the child's write must land within about 30 µs of the parent's. The wider path, where the child's `sessionStart` cleared the mark on purpose, is fixed: the parent now owns `suspended`. `scripts/check-pi.sh` pins that on a real child.

Both share a cause: `updateMetadata` is an unlocked read-modify-write across processes.

`wait-fresh-reply` was a finding until `waitSubagent` listed the inbox before it read `metadata.json`. `tests/pi-extension.test.ts` reproduces it on the real CLI, and the `mutant-wait-order` row keeps the old order failing in the model.

## When the code changes

1. Run `git diff 2e52b4c -- .pi/extensions/subagent/` (the `SYNC` commit). `check.sh` lists drifted files too. If nothing in the coverage table changed, run the check and you are done.
2. For each changed function, find its action in the coverage table and compare. Ask three questions. Did a file read or write move, appear or disappear? Did an `await` appear inside a handler or `processInbox`? That would split one child step. Did a condition change, such as `ctx.isIdle()` or `hasStarted`?
3. Edit the action in `spec/PiSubagent.tla` so it does what the code now does, with a comment naming the code. Then run `check.sh`.
4. Read any unexpected result.
   - A `pass` row now fails: run `check.sh <row>` and replay the trace against the code, step by step. If every step is something the code can really do, it is a bug in the change. Report it with the trace in the code's terms, and do not edit the model to hide it. If a step is something the code cannot do, the model is wrong. Fix the action, and say what was wrong.
   - A `finding` row now passes: if the change fixed that bug, change its expectation to `pass` and move the finding out of this file. If not, the model no longer reaches the bug. Find out why before you go on.
   - A `mutant` row now passes: the mutation no longer breaks the model. Repair the `Mutant` branch so it again breaks the step it names.
5. Once the model describes the code at the new commit, set `SYNC` in `check.sh` and in this file to that commit. Never move `SYNC` without step 2. This repo squash-merges PRs, which rewrites the commit, so set `SYNC` to the commit on `main` after the change lands. `check.sh` fails while `SYNC` is not an ancestor of `HEAD`.

A new promise, such as `stop` or worktree cleanup, gets a new invariant, a `pass` or `finding` row, and a `mutant` row that shows it can fail.
