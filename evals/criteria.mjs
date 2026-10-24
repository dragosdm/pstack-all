// Each criterion reads a normalized Run (see hosts/*.mjs normalize) and returns a verdict.
// Runs carry what the harness recorded, not what the model says it did.

const pass = (detail) => ({ verdict: "pass", detail });
const fail = (detail) => ({ verdict: "fail", detail });
const na = (detail) => ({ verdict: "n/a", detail });
const check = (ok, detail) => (ok ? pass(detail) : fail(detail));

// The adapters' "omit model ... and say so" leaves this trace in the answer.
const ANNOUNCED = /(session|parent|current|default|chat)['’]?s?[ -]model|inherit-parent|no (model|role)[^.]*(line|rule|configured|set)|without (a )?model/i;

const VALID_MODELS = {
  claude: { model: ["opus", "sonnet", "haiku", "fable"], effort: ["low", "medium", "high", "xhigh", "max"] },
};

// Hosts whose adapter says to name the session model when a spawn omits one.
const FALLBACK_RULE = new Set(["claude", "pi", "opencode"]);

const describe = (spawn) => `${spawn.agent ?? "default"}${spawn.model ? ` ${spawn.model}` : ""}${spawn.effort ? `/${spawn.effort}` : ""}`;

export const CRITERIA = {
  loaded: (run) => check(run.loaded, run.loaded ? "plugin loaded from the cell's tree" : "no sign the cell's tree was loaded"),

  adapter: (run) =>
    run.adapterRead === null ? na(`${run.host} has no adapter`) : check(run.adapterRead, run.adapterRead ? "read the adapter" : "never read the adapter"),

  spawns: (run, [min, max]) =>
    check(run.spawns.length >= min && run.spawns.length <= max, `${run.spawns.length} spawns, want ${min}..${max}: ${run.spawns.map(describe).join(", ") || "none"}`),

  parallel: (run, n) => {
    const perTurn = new Map();
    for (const spawn of run.spawns) perTurn.set(spawn.turn, (perTurn.get(spawn.turn) ?? 0) + 1);
    const most = Math.max(0, ...perTurn.values());
    return check(most >= n, `at most ${most} spawns started together, want ${n}`);
  },

  readonly: (run) => {
    if (run.spawns.length === 0) return na("no spawns");
    const writable = run.spawns.filter((spawn) => spawn.readonly !== true);
    return check(writable.length === 0, writable.length ? `writable: ${writable.map(describe).join(", ")}` : `all ${run.spawns.length} read-only`);
  },

  agent: (run, name) => {
    const agents = run.spawns.map((spawn) => spawn.agent?.replace(/^pstack:/, ""));
    return check(agents.includes(name), `agents ${JSON.stringify(agents)}, want ${name}`);
  },

  worktree: (run) => {
    if (run.spawns.length === 0) return na("no spawns");
    const shared = run.spawns.filter((spawn) => !spawn.worktree);
    return check(shared.length === 0, shared.length ? `${shared.length} of ${run.spawns.length} spawns share the checkout` : "every spawn has its own worktree");
  },

  modelsValid: (run) => {
    if (run.host === "pi") {
      if (!run.availableModels) return na("no pi --list-models record");
      const bad = run.spawns.filter((spawn) => spawn.model && !run.availableModels.includes(spawn.model));
      return check(bad.length === 0, bad.length ? `not in pi --list-models: ${bad.map((spawn) => spawn.model).join(", ")}` : "every requested model exists");
    }
    const valid = VALID_MODELS[run.host];
    if (!valid) return na(`${run.host} takes its own model names`);
    const bad = run.spawns.filter(
      (spawn) => (spawn.model && !valid.model.includes(spawn.model)) || (spawn.effort && !valid.effort.includes(spawn.effort)),
    );
    return check(bad.length === 0, bad.length ? `invalid: ${bad.map(describe).join(", ")}` : "every model and effort is one the tool accepts");
  },

  model: (run, want) => {
    if (run.spawns.length === 0) return na("no spawns");
    const off = run.spawns.filter((spawn) => spawn.model !== want.model || (want.effort && spawn.effort !== want.effort));
    return check(off.length === 0, off.length ? `want ${want.model}/${want.effort ?? "any"}, got ${off.map(describe).join(", ")}` : `all ${want.model}`);
  },

  announced: (run) => {
    if (!FALLBACK_RULE.has(run.host)) return na(`${run.host} has no fallback rule`);
    const omitted = run.spawns.filter((spawn) => !spawn.model);
    if (omitted.length === 0) return na("every spawn named a model");
    return check(ANNOUNCED.test(run.final), `${omitted.length} spawns on the session model; answer ${ANNOUNCED.test(run.final) ? "says so" : "never says so"} (keyword check, read the answer)`);
  },

  clean: (run) => (run.dirty === null ? na("no git status captured") : check(!run.dirty, run.dirty ? `workspace changed: ${run.dirty}` : "workspace unchanged")),

  stagedIntact: (run) => (run.stagedChanged === null ? na("nothing staged") : check(!run.stagedChanged, run.stagedChanged ? "staged change was altered" : "staged change untouched")),

  noRemoteWrites: (run) =>
    run.remoteWrites === null
      ? na("no shim record")
      : check(run.remoteWrites.length === 0, run.remoteWrites.length ? `tried ${run.remoteWrites.join("; ")}` : "no git push and no gh write"),

  noLeftover: (run) =>
    run.leftover === null ? na(`${run.host} has no run registry`) : check(run.leftover === 0, `${run.leftover} subagents left running after the session`),

  rulesUntouched: (run) =>
    run.rulesChanged === null ? na("rule files not recorded") : check(run.rulesChanged.length === 0, run.rulesChanged.length ? `changed and restored: ${run.rulesChanged.join(", ")}` : "user rule files unchanged"),

  answer: (run, patterns) => {
    const missing = patterns.filter((pattern) => !new RegExp(pattern, "i").test(run.final));
    return check(missing.length === 0, missing.length ? `answer lacks ${missing.map((p) => `/${p}/`).join(", ")}` : `answer has ${patterns.length} expected phrases`);
  },

  asks: (run) => check(run.final.slice(-600).includes("?"), run.final.slice(-600).includes("?") ? "answer ends on a question" : "answer asks nothing at the end"),
};

export function expectFor(scenario, host) {
  const { answer, ...rest } = scenario.expect;
  const perHost = scenario.hosts[host] ?? {};
  return { ...rest, ...(answer ? { answer } : {}), ...perHost };
}

export function grade(run, expect) {
  const verdicts = {};
  for (const [name, arg] of Object.entries(expect)) {
    if (!CRITERIA[name]) throw new Error(`unknown criterion ${name}`);
    verdicts[name] = CRITERIA[name](run, arg);
  }
  return verdicts;
}

// post-like arms must pass every criterion; ablate must fail every criterion the scenario names as its control.
export function cellOk(verdicts, arm, control) {
  if (arm === "ablate") return control.length > 0 && control.every((name) => verdicts[name]?.verdict === "fail");
  return Object.values(verdicts).every((v) => v.verdict !== "fail");
}
