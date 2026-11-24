----------------------------- MODULE PiSubagent -----------------------------
(***************************************************************************)
(* The pstack-subagent message protocol of the Pi adapter.                 *)
(*                                                                         *)
(* One run, as `pstack-subagent spawn` leaves it: metadata.json says       *)
(* "starting", the tmux session is up, and the child pi holds the task as  *)
(* message 0. Processes:                                                   *)
(*   Child   the child pi: pi's agent loop plus childRole() in             *)
(*           .pi/extensions/subagent/index.ts. One JS event loop, so its   *)
(*           steps never interleave with each other, only with the        *)
(*           other processes' file operations.                            *)
(*   Driver  the agent that spawned it: `wait`, then for k in 1..N         *)
(*           `send k` and `wait` (sendSubagent, waitSubagent in            *)
(*           .pi/extensions/subagent/subagent.ts).                         *)
(*   Renamer `pstack-subagent rename` once (renameSubagent), if WithRename.*)
(*   Parent  the parent pi quitting (parentRole().sessionShutdown), if     *)
(*           WithQuit.                                                     *)
(*                                                                         *)
(* Every updateMetadata (shared.ts) is a read of metadata.json, then an    *)
(* atomic rename over it, with no lock. The model splits it into those two *)
(* steps. Every other file operation is one step.                          *)
(*                                                                         *)
(* Mutant names a deliberate break of the code, used only to show that a   *)
(* property can fail. "none" is the code as it is.                         *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS N, WithRename, WithQuit, Mutant

ASSUME N \in Nat /\ WithRename \in BOOLEAN /\ WithQuit \in BOOLEAN
ASSUME Mutant \in {"none", "skip-unlink", "skip-mark-busy", "settle-ignores-idle", "meta-before-inbox"}

Msgs == 0..N
Live == {"starting", "busy", "idle"}          \* the states effectiveRunState checks tmux for
MinOf(S) == CHOOSE m \in S : \A o \in S : m <= o

\* waitSubagent loop, in code order: the inbox, then getRun. "meta-before-inbox" is the order before the fix.
WFirst  == IF Mutant = "meta-before-inbox" THEN "Wmeta" ELSE "Winbox"
WSecond == IF Mutant = "meta-before-inbox" THEN "Winbox" ELSE "Wmeta"
WAfter(step) == IF step = WFirst THEN WSecond ELSE "W3"

VARIABLES
  \* Shared files and processes.
  meta,        \* metadata.json: state, hasStarted, suspended, name
  inbox,       \* <runDir>/inbox/*.json, by message number
  tmux,        \* tmux has-session pstack-subagent-<handle>
  answered,    \* messages the latest assistant entry in session.jsonl replies to
  \* Pi's agent loop inside the child.
  piPhase,     \* "idle" | "starting" | "running" | "turn"
  piBusy,      \* NOT ctx.isIdle()
  piQueue,     \* messages handed to pi that are not yet in the conversation
  conv,        \* messages in the conversation
  covering,    \* messages in the conversation when the current turn's request went out
  turnDone,    \* the current run has finished at least one turn
  submitted0,  \* pi has taken the task file passed as @task.md at launch
  evStart,     \* agent_start emitted, handler not yet run
  evSettled,   \* agent_settled emitted, handler not yet run
  deliv,       \* how many times each message reached pi.sendUserMessage (capped at 2)
  \* Child extension (childRole).
  cPc, cSnap, cPatch, cNext, cBatch, cCur, booted,
  \* Driver.
  dPc, dK, dBase, dMeta, dPending, dReply, sent,
  \* Renamer and Parent.
  rPc, rSnap, qPc, qSnap

vars == <<meta, inbox, tmux, answered, piPhase, piBusy, piQueue, conv, covering,
          turnDone, submitted0, evStart, evSettled, deliv,
          cPc, cSnap, cPatch, cNext, cBatch, cCur, booted,
          dPc, dK, dBase, dMeta, dPending, dReply, sent, rPc, rSnap, qPc, qSnap>>
piVars    == <<piPhase, piBusy, piQueue, conv, covering, turnDone, submitted0, evStart, evSettled, deliv, answered>>
childVars == <<cPc, cSnap, cPatch, cNext, cBatch, cCur, booted>>
drvVars   == <<dPc, dK, dBase, dMeta, dPending, dReply, sent>>
otherVars == <<rPc, rSnap, qPc, qSnap>>

MetaRec == [state : {"starting", "busy", "idle", "exited"}, hasStarted : BOOLEAN,
            suspended : BOOLEAN, name : {0, 1}]

\* spawnSubagent: writeMetadata({state: "starting", hasStarted: false}), then launchRun.
Init ==
  /\ meta = [state |-> "starting", hasStarted |-> FALSE, suspended |-> FALSE, name |-> 0]
  /\ inbox = {} /\ tmux = TRUE /\ answered = {}
  /\ piPhase = "idle" /\ piBusy = FALSE /\ piQueue = {} /\ conv = {} /\ covering = {}
  /\ turnDone = FALSE /\ submitted0 = FALSE /\ evStart = FALSE /\ evSettled = FALSE
  /\ deliv = [m \in Msgs |-> 0]
  /\ cPc = "boot" /\ cSnap = meta /\ cPatch = [state |-> "idle"] /\ cNext = "ready"
  /\ cBatch = {} /\ cCur = 0 /\ booted = FALSE
  /\ dPc = WFirst /\ dK = 0 /\ dBase = {0} /\ dMeta = meta /\ dPending = FALSE
  /\ dReply = {} /\ sent = {0}
  /\ rPc = (IF WithRename THEN "idle" ELSE "off") /\ rSnap = meta
  /\ qPc = (IF WithQuit THEN "idle" ELSE "off") /\ qSnap = meta

-----------------------------------------------------------------------------
(* Pi's agent loop. It shares the child's event loop, so it moves only     *)
(* while the extension is between callbacks (cPc = "ready"), and it waits  *)
(* for an emitted event's handler before going on.                         *)

PiFree == cPc = "ready" /\ tmux /\ ~evStart /\ ~evSettled

\* sendUserMessage while idle: "Pi counts as busy while a run starts" (pi docs, extensions.md).
Submit(m) ==
  /\ piQueue' = piQueue \cup {m}
  /\ deliv' = [deliv EXCEPT ![m] = IF @ < 2 THEN @ + 1 ELSE 2]
  /\ IF piBusy THEN UNCHANGED <<piBusy, piPhase>>
              ELSE piBusy' = TRUE /\ piPhase' = "starting"

\* Pi takes the @task.md argument. Allowed before or after session_start.
PiTakeTask ==
  /\ ~submitted0 /\ cPc \in {"boot", "ready"} /\ tmux /\ ~evStart /\ ~evSettled
  /\ submitted0' = TRUE
  /\ Submit(0)
  /\ UNCHANGED <<conv, covering, turnDone, evStart, evSettled, answered>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED childVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

PiAgentStart ==
  /\ PiFree /\ piPhase = "starting"
  /\ piPhase' = "running" /\ evStart' = TRUE /\ turnDone' = FALSE
  /\ UNCHANGED <<piBusy, piQueue, conv, covering, submitted0, evSettled, deliv, answered>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED childVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* A turn's request carries the conversation, including steered and queued messages.
PiTurnBegin ==
  /\ PiFree /\ piPhase = "running"
  /\ conv' = conv \cup piQueue /\ covering' = conv \cup piQueue /\ piQueue' = {}
  /\ piPhase' = "turn"
  /\ UNCHANGED <<piBusy, turnDone, submitted0, evStart, evSettled, deliv, answered>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED childVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* turn_end: the assistant entry is appended to session.jsonl.
PiTurnEnd ==
  /\ PiFree /\ piPhase = "turn"
  /\ answered' = covering /\ turnDone' = TRUE /\ piPhase' = "running"
  /\ UNCHANGED <<piBusy, piQueue, conv, covering, submitted0, evStart, evSettled, deliv>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED childVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* agent_end with queued follow-up work: another low-level run, another agent_start.
PiRunAgain ==
  /\ PiFree /\ piPhase = "running" /\ turnDone /\ piQueue # {}
  /\ piPhase' = "starting"
  /\ UNCHANGED <<piBusy, piQueue, conv, covering, turnDone, submitted0, evStart, evSettled, deliv, answered>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED childVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* agent_settled: no automatic work left, and ctx.isIdle() is true.
PiSettle ==
  /\ PiFree /\ piPhase = "running" /\ turnDone /\ piQueue = {}
  /\ piPhase' = "idle" /\ piBusy' = FALSE /\ evSettled' = TRUE
  /\ UNCHANGED <<piQueue, conv, covering, turnDone, submitted0, evStart, deliv, answered>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED childVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

-----------------------------------------------------------------------------
(* childRole() in index.ts. A handler's updateMetadata is a read step that *)
(* moves to cPc = "write", then ChildWrite.                                *)

ChildRead(patch, next) ==
  /\ cSnap' = meta /\ cPatch' = patch /\ cNext' = next /\ cPc' = "write"

\* updateMetadata's writeMetadata: tmp file + renameSync over metadata.json.
ChildWrite ==
  /\ cPc = "write"
  /\ meta' = cPatch @@ cSnap
  /\ cPc' = cNext
  /\ UNCHANGED <<cSnap, cPatch, cNext, cBatch, cCur, booted>>
  /\ UNCHANGED <<inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* sessionStart: updateMetadata({state: ctx.isIdle() ? "idle" : "busy", suspended: undefined}); starts the 250 ms poll.
ChildSessionStart ==
  /\ cPc = "boot" /\ tmux
  /\ ChildRead([state |-> IF piBusy THEN "busy" ELSE "idle", suspended |-> FALSE], "ready")
  /\ booted' = TRUE
  /\ UNCHANGED <<cBatch, cCur>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* agentStart: updateMetadata({state: "busy", hasStarted: true}).
ChildAgentStart ==
  /\ cPc = "ready" /\ evStart
  /\ evStart' = FALSE
  /\ ChildRead([state |-> "busy", hasStarted |-> TRUE], "ready")
  /\ UNCHANGED <<cBatch, cCur, booted>>
  /\ UNCHANGED <<piPhase, piBusy, piQueue, conv, covering, turnDone, submitted0, evSettled, deliv, answered>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* agentSettled: if (ctx.isIdle()) updateMetadata({state: "idle"}).
ChildAgentSettled ==
  /\ cPc = "ready" /\ evSettled
  /\ evSettled' = FALSE
  /\ IF ~piBusy \/ Mutant = "settle-ignores-idle"
       THEN ChildRead([state |-> "idle"], "ready")
       ELSE UNCHANGED <<cPc, cSnap, cPatch, cNext>>
  /\ UNCHANGED <<cBatch, cCur, booted>>
  /\ UNCHANGED <<piPhase, piBusy, piQueue, conv, covering, turnDone, submitted0, evStart, deliv, answered>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* processInbox: readdirSync(queueDir) once, then each file in name order.
\* The timer is cleared only in sessionShutdown, so a poll can still run after tmux kill-session.
ChildPollStart ==
  /\ cPc = "ready" /\ booted /\ inbox # {}
  /\ cBatch' = inbox /\ cPc' = "pollNext"
  /\ UNCHANGED <<cSnap, cPatch, cNext, cCur, booted>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* updateMetadata(runDir, {state: "busy", error: undefined}) for the next file.
ChildPollNext ==
  /\ cPc = "pollNext"
  /\ IF cBatch = {}
       THEN cPc' = "ready" /\ UNCHANGED <<cBatch, cCur, cSnap, cPatch, cNext>>
       ELSE /\ cCur' = MinOf(cBatch) /\ cBatch' = cBatch \ {MinOf(cBatch)}
            /\ IF Mutant = "skip-mark-busy"
                 THEN cPc' = "pollSend" /\ UNCHANGED <<cSnap, cPatch, cNext>>
                 ELSE ChildRead([state |-> "busy"], "pollSend")
  /\ UNCHANGED booted
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* pi.sendUserMessage(payload.message[, {deliverAs}]).
ChildPollSend ==
  /\ cPc = "pollSend"
  /\ Submit(cCur)
  /\ cPc' = IF Mutant = "skip-unlink" THEN "pollNext" ELSE "pollUnlink"
  /\ UNCHANGED <<conv, covering, turnDone, submitted0, evStart, evSettled, answered>>
  /\ UNCHANGED <<cSnap, cPatch, cNext, cBatch, cCur, booted>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* unlinkSync(path).
ChildPollUnlink ==
  /\ cPc = "pollUnlink"
  /\ inbox' = inbox \ {cCur} /\ cPc' = "pollNext"
  /\ UNCHANGED <<cSnap, cPatch, cNext, cBatch, cCur, booted>>
  /\ UNCHANGED <<meta, tmux>> /\ UNCHANGED piVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

\* sessionShutdown after SIGHUP from tmux kill-session: updateMetadata({state: "exited"}).
ChildShutdown ==
  /\ cPc = "ready" /\ ~tmux
  /\ ChildRead([state |-> "exited"], "dead")
  /\ UNCHANGED <<cBatch, cCur, booted>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED drvVars /\ UNCHANGED otherVars

-----------------------------------------------------------------------------
(* Driver: `wait` for the task, then `send k` and `wait` for k in 1..N.    *)

\* sendSubagent: getRun, then tmuxSessionExists.
DSendCheck ==
  /\ dPc = "S1"
  /\ dPc' = IF tmux THEN "S2" ELSE "failed"
  /\ UNCHANGED <<dK, dBase, dMeta, dPending, dReply, sent>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED otherVars

\* writeFileSync(temporary) then renameSync into inbox/. `send` returns, then the driver runs `wait`,
\* or sends the next message at once, as a steer or a follow-up while the child is busy.
DSendWrite ==
  /\ dPc = "S2"
  /\ inbox' = inbox \cup {dK} /\ sent' = sent \cup {dK} /\ dBase' = sent \cup {dK}
  /\ \/ dPc' = WFirst /\ UNCHANGED dK
     \/ dK < N /\ dPc' = "S1" /\ dK' = dK + 1
  /\ UNCHANGED <<dMeta, dPending, dReply>>
  /\ UNCHANGED <<meta, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED otherVars

\* const metadata = getRun(handle)
DWaitMeta ==
  /\ dPc = "Wmeta"
  /\ dMeta' = meta /\ dPc' = WAfter("Wmeta")
  /\ UNCHANGED <<dK, dBase, dPending, dReply, sent>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED otherVars

\* const pending = existsSync(queueDir) && readdirSync(queueDir).some(...)
DWaitInbox ==
  /\ dPc = "Winbox"
  /\ dPending' = (inbox # {}) /\ dPc' = WAfter("Winbox")
  /\ UNCHANGED <<dK, dBase, dMeta, dReply, sent>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED otherVars

\* const state = effectiveRunState(metadata), then the three checks.
DWaitDecide ==
  /\ dPc = "W3"
  /\ LET eff == IF dMeta.state \in Live /\ ~tmux THEN "exited" ELSE dMeta.state
     IN dPc' = CASE eff = "exited"                                -> "failed"
               []   dMeta.hasStarted /\ eff = "idle" /\ ~dPending -> "W4"
               []   OTHER                                         -> WFirst
  /\ UNCHANGED <<dK, dBase, dMeta, dPending, dReply, sent>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED otherVars

\* readLatestAssistant(metadata.sessionFile); wait prints it and exits 0.
DWaitRead ==
  /\ dPc = "W4"
  /\ dReply' = answered /\ dPc' = "ret"
  /\ UNCHANGED <<dK, dBase, dMeta, dPending, sent>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED otherVars

DNext ==
  /\ dPc = "ret"
  /\ IF dK < N THEN dK' = dK + 1 /\ dPc' = "S1" ELSE dPc' = "done" /\ UNCHANGED dK
  /\ UNCHANGED <<dBase, dMeta, dPending, dReply, sent>>
  /\ UNCHANGED <<meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED otherVars

-----------------------------------------------------------------------------
(* renameSubagent: updateMetadata(metadata.runDir, {name}).                *)

RRead ==
  /\ rPc = "idle" /\ rSnap' = meta /\ rPc' = "write"
  /\ UNCHANGED <<qPc, qSnap, meta, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED drvVars

RWrite ==
  /\ rPc = "write" /\ meta' = [name |-> 1] @@ rSnap /\ rPc' = "done"
  /\ UNCHANGED <<rSnap, qPc, qSnap, inbox, tmux>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED drvVars

-----------------------------------------------------------------------------
(* parentRole().sessionShutdown on quit, for this run.                     *)

QStep ==
  /\ qPc \in {"idle", "Q2", "Q3", "Q3w", "Q4", "Q5"}
  /\ CASE qPc = "idle" -> qSnap' = meta /\ qPc' = "Q2"                                  \* listRuns
     []   qPc = "Q2"   -> qPc' = (IF tmux THEN "Q3" ELSE "gone") /\ UNCHANGED qSnap        \* tmuxSessionExists; "gone" is out of scope
     []   qPc = "Q3"   -> qSnap' = meta /\ qPc' = "Q3w"                                  \* updateMetadata({suspended: true}): read
     []   qPc = "Q3w"  -> qPc' = "Q4" /\ UNCHANGED qSnap                                 \*   write, below
     []   qPc = "Q4"   -> qPc' = "Q5" /\ UNCHANGED qSnap                                 \* tmux kill-session, below
     []   qPc = "Q5"   -> qPc' = "done" /\ UNCHANGED qSnap                               \* waitForRunShutdown: exited or 2 s
  /\ meta'  = IF qPc = "Q3w" THEN [suspended |-> TRUE] @@ qSnap ELSE meta
  /\ tmux'  = IF qPc = "Q4" THEN FALSE ELSE tmux
  /\ UNCHANGED <<rPc, rSnap, inbox>> /\ UNCHANGED piVars /\ UNCHANGED childVars /\ UNCHANGED drvVars

-----------------------------------------------------------------------------

Next ==
  \/ PiTakeTask \/ PiAgentStart \/ PiTurnBegin \/ PiTurnEnd \/ PiRunAgain \/ PiSettle
  \/ ChildWrite \/ ChildSessionStart \/ ChildAgentStart \/ ChildAgentSettled
  \/ ChildPollStart \/ ChildPollNext \/ ChildPollSend \/ ChildPollUnlink \/ ChildShutdown
  \/ DSendCheck \/ DSendWrite \/ DWaitMeta \/ DWaitInbox \/ DWaitDecide \/ DWaitRead \/ DNext
  \/ RRead \/ RWrite
  \/ QStep

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties.                                                             *)

TypeOK ==
  /\ meta \in MetaRec /\ inbox \subseteq Msgs /\ answered \subseteq Msgs
  /\ piPhase \in {"idle", "starting", "running", "turn"}
  /\ deliv \in [Msgs -> 0..2]

\* P1. A `wait` that exits 0 prints a reply to every message sent before it started.
WaitReturnsFreshReply == dPc = "ret" => dBase \subseteq dReply

\* P2. When metadata.json says finished (hasStarted, idle) and the inbox is empty,
\*     the latest reply answers every message sent. `wait` relies on this.
IdleMeansAnswered ==
  (meta.hasStarted /\ meta.state = "idle" /\ inbox = {}) => sent \subseteq answered

\* P3. Each sent message reaches pi.sendUserMessage at most once.
ExactlyOnce == \A m \in Msgs : deliv[m] <= 1

\* P4. Once the parent has marked the run suspended and stopped it, the mark stays,
\*     so the next session_start relaunches the run and the next quit keeps it.
SuspendKept ==
  (qPc \in {"Q4", "Q5", "done"} /\ cPc \in {"ready", "dead"}) => meta.suspended

=============================================================================
