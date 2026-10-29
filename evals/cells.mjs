#!/usr/bin/env node
// Drives pstack skills in real harness sessions and grades what the harness recorded.
//   node evals/cells.mjs list
//   node evals/cells.mjs run --scenario how-simple,help-models --host claude,pi [--arm post,ablate,ref:<sha>,upstream,ab] [--trials 1] [options]
//   node evals/cells.mjs grade <run dir or cell dir> [--criteria current|original]
//   node evals/cells.mjs check
// `run` bills each harness's own login. See evals/README.md.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cellOk, expectFor, grade } from "./criteria.mjs";
import { HOSTS } from "./hosts/index.mjs";
import { installShims, withoutCredentials } from "./shims.mjs";
import { SCENARIOS, armsFor, scenarioById } from "./scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const DERIVED = new Set(["run.json", "grade.json", "manifest.json", "summary.json", "summary.md"]);
const BLINDED = /\b(eval|evals|test|judge|rubric|score|benchmark|experiment|candidate|grader)\b/i;
// Only what a harness loads goes into a cell's plugin tree, so a session can't read this directory's expectations.
const LOADED_PATHS = ["pstack", ".claude-plugin", ".cursor-plugin", "plugin.json", "package.json", "index.js", ".pi", ".opencode", "docs/harness"];
const RULE_FILES = [".claude/rules/pstack-models.md", ".pi/agent/pstack-models.md", ".cursor/rules/pstack-models.mdc"].map((p) => join(homedir(), p));

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return (r.stdout ?? "").trim();
};
const sha = (data) => createHash("sha256").update(data).digest("hex");
const write = (file, value) => writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);

function filesUnder(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? filesUnder(path, base) : [relative(base, path)];
  });
}

function seal(dir) {
  const files = {};
  for (const file of filesUnder(dir).sort()) if (!DERIVED.has(file)) files[file] = sha(readFileSync(join(dir, file)));
  write(join(dir, "manifest.json"), { files });
}

function verifySeal(dir) {
  const { files } = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const now = filesUnder(dir).filter((f) => !DERIVED.has(f)).sort();
  if (JSON.stringify(now) !== JSON.stringify(Object.keys(files).sort())) throw new Error(`${dir}: evidence files differ from manifest.json`);
  for (const [file, hash] of Object.entries(files)) if (sha(readFileSync(join(dir, file))) !== hash) throw new Error(`${dir}: ${file} changed after sealing`);
}

// The code that turns a cell's evidence into verdicts. A cell records this hash so a later grade can tell whether it changed.
export function gradingSha(hostName) {
  const files = ["criteria.mjs", "hosts/common.mjs", `hosts/${hostName}.mjs`];
  return sha(files.map((file) => `${file}\0${readFileSync(join(here, file), "utf8")}`).join("\0"));
}

// Normalize and grade one sealed cell. Reruns read only the evidence, never a model.
// `current` grades with today's scenario. `original` grades with the scenario the cell ran with, and only under the same grading code.
function gradeCell(dir, criteria = "current") {
  const cell = JSON.parse(readFileSync(join(dir, "cell.json"), "utf8"));
  const host = HOSTS[cell.host];
  if (!host) throw new Error(`${dir}: unknown host ${cell.host}`);
  const base = { criteria, arm: cell.arm, reference: Boolean(host.reference), process: cell.process };
  let scenario = scenarioById(cell.scenario);
  if (criteria === "original") {
    const reason = !cell.scenarioSnapshot || !cell.gradingSha
      ? "sealed before cells recorded their scenario and grading code"
      : cell.gradingSha !== gradingSha(cell.host) ? "the grading code changed since the cell ran" : null;
    if (reason) {
      const result = { ...base, status: "not-assessable", ok: null, reason, verdicts: {} };
      rmSync(join(dir, "run.json"), { force: true });
      write(join(dir, "grade.json"), result);
      return { cell, run: null, result };
    }
    scenario = cell.scenarioSnapshot;
  }
  if (!scenario) throw new Error(`${dir}: unknown scenario ${cell.scenario}`);
  const run = host.normalize(dir, cell);
  const verdicts = grade(run, expectFor(scenario, cell.host));
  const ok = cell.process.exit === 0 && !cell.process.timedOut && cellOk(verdicts, cell.arm, scenario.control);
  const result = { ...base, status: ok ? "ok" : "not ok", ok, verdicts };
  write(join(dir, "run.json"), run);
  write(join(dir, "grade.json"), result);
  return { cell, run, result };
}

// --- run -------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    arm: ["post"], trials: 1, timeout: 900, claudeModel: "sonnet", claudeBudget: 2,
    piModel: process.env.PSTACK_CELL_PI_MODEL ?? "openai-codex/gpt-6.1-sol:medium", cursorModel: null, grokModel: null, opencodeModel: null, opencodeConfig: null, piAgentDir: null, out: null,
  };
  const list = (v) => v.split(",").filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    i++;
    switch (flag) {
      case "--scenario": opts.scenario = value === "all" ? SCENARIOS.map((s) => s.id) : list(value); break;
      case "--host": opts.host = list(value); break;
      case "--arm": opts.arm = list(value); break;
      case "--trials": opts.trials = Number(value); break;
      case "--timeout": opts.timeout = Number(value); break;
      case "--claude-model": opts.claudeModel = value; break;
      case "--claude-budget": opts.claudeBudget = Number(value); break;
      case "--pi-model": opts.piModel = value; break;
      case "--pi-agent-dir": opts.piAgentDir = resolve(value); break;
      case "--cursor-model": opts.cursorModel = value; break;
      case "--grok-model": opts.grokModel = value; break;
      case "--opencode-model": opts.opencodeModel = value; break;
      case "--opencode-config": opts.opencodeConfig = resolve(value); break;
      case "--out": opts.out = resolve(value); break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  // Every cell bills a session, so nothing runs without an explicit selection.
  if (!opts.scenario?.length || !opts.host?.length) throw new Error("run needs --scenario <ids|all> and --host <names>");
  if (opts.arm.includes("ab")) {
    const missing = opts.scenario.filter((id) => !scenarioById(id)?.baseline_ref);
    if (missing.length) throw new Error(`--arm ab needs a baseline_ref, and ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} none`);
  }
  return opts;
}

function materialize(arm, dest) {
  mkdirSync(dest, { recursive: true });
  if (arm.startsWith("ref:")) {
    // An older commit lacks the newer harness entries, and git archive refuses a path the commit does not have.
    const present = sh("git", ["-C", repo, "ls-tree", "--name-only", arm.slice(4), "--", ...LOADED_PATHS]).split("\n").filter(Boolean);
    sh("bash", ["-c", `git -C "$0" archive "$1" -- "\${@:3}" | tar -x -C "$2"`, repo, arm.slice(4), dest, ...present]);
  } else if (arm === "upstream") {
    const upstream = process.env.PSTACK_UPSTREAM_DIR;
    if (!upstream) throw new Error("the upstream arm needs PSTACK_UPSTREAM_DIR");
    const commit = /UPSTREAM_COMMIT=(\S+)/.exec(readFileSync(join(repo, "base/pstack.lock"), "utf8"))[1];
    sh("sh", ["-c", `git -C "$0" archive "$1" harness/pstack/claude-code | tar -x -C "$2" --strip-components=3`, upstream, commit, dest]);
  } else {
    sh("bash", ["-c", `cd "$0" && git ls-files -co --exclude-standard -z -- "\${@:2}" | tar --null -T - -cf - | tar -x -C "$1"`, repo, dest, ...LOADED_PATHS]);
  }
}

function seedProject(scenario, project) {
  cpSync(join(here, "fixtures", scenario.fixture), project, { recursive: true });
  const git = (...args) => sh("git", ["-C", project, "-c", "user.name=dev", "-c", "user.email=dev@example.invalid", ...args]);
  git("init", "-q", "-b", "main");
  return {
    commit() {
      git("add", "-A");
      git("commit", "-qm", "init");
      if (scenario.overlay) {
        cpSync(join(here, "overlays", scenario.overlay.dir), project, { recursive: true });
        if (scenario.overlay.staged) git("add", "-A");
        else { git("add", "-A"); git("commit", "-qm", "add files"); }
      }
    },
    status: () => git("status", "--porcelain"),
    staged: () => sha(git("diff", "--cached")),
  };
}

function snapshotRules() {
  return new Map(RULE_FILES.map((file) => [file, existsSync(file) ? readFileSync(file) : null]));
}

function restoreRules(before) {
  const changed = [];
  for (const [file, bytes] of before) {
    const now = existsSync(file) ? readFileSync(file) : null;
    if (bytes === null ? now === null : now !== null && bytes.equals(now)) continue;
    changed.push(file.replace(homedir(), "~"));
    if (bytes === null) rmSync(file, { force: true });
    else writeFileSync(file, bytes);
  }
  return changed;
}

function launch({ argv, stdin, env }, cwd, dir, timeoutSecs) {
  const fullEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) v === undefined ? delete fullEnv[k] : (fullEnv[k] = v);
  if (stdin !== null) write(join(dir, "prompt.txt"), stdin);
  const out = argv[0] === "pi" ? "print.log" : "transcript.jsonl";
  return new Promise((resolvePromise) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd, env: fullEnv, detached: true,
      stdio: [stdin === null ? "ignore" : openSync(join(dir, "prompt.txt"), "r"), openSync(join(dir, out), "w"), openSync(join(dir, "stderr.txt"), "w")],
    });
    const started = Date.now();
    let timedOut = false;
    // The harness's own subagents share its process group, so the whole group goes on timeout.
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutSecs * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ exit: code, timedOut, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

// Pi children outlive the parent if the model never stops them; stop and keep each one that ran in this workbench.
function collectPiLeftovers(agentDir, workbench, dir) {
  const runs = join(agentDir, "pstack-subagents");
  let count = 0;
  for (const handle of existsSync(runs) ? readdirSync(runs) : []) {
    const meta = join(runs, handle, "metadata.json");
    const run = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")) : null;
    if (!run || !(run.cwd?.startsWith(workbench) || run.worktree?.repo?.startsWith(workbench))) continue;
    count++;
    sh(join(repo, ".pi/bin/pstack-subagent"), ["stop", handle], {
      allowFail: true, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PSTACK_SUBAGENT_KEEP_DIR: join(dir, "children") },
    });
  }
  write(join(dir, "leftover.json"), { count });
}

function trustWorkbench(agentDir, workbench) {
  const file = join(agentDir, "trust.json");
  const before = existsSync(file) ? readFileSync(file) : null;
  const trust = before ? JSON.parse(before) : {};
  trust[workbench] = true;
  write(file, trust);
  // Give back the original bytes unless someone else changed the file meanwhile.
  return () => {
    const now = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    delete now[workbench];
    const original = before ? JSON.parse(before) : {};
    if (JSON.stringify(now) !== JSON.stringify(original)) write(file, now);
    else if (before === null) rmSync(file, { force: true });
    else writeFileSync(file, before);
  };
}

const versionOf = (bin) => sh(bin, ["--version"], { allowFail: true, timeout: 20000 }).split("\n")[0];

async function runCells(opts) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z");
  const out = opts.out ?? join(repo, ".verify-runs", `${stamp}-cells`);
  mkdirSync(out, { recursive: true });
  // A neutral folder name: the session sees only a project and the plugin tree.
  const workbench = realpathSync(mkdtempSync(join(tmpdir(), "workbench-")));
  const piAgentDir = opts.piAgentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
  const untrust = opts.host.includes("pi") ? trustWorkbench(piAgentDir, workbench) : () => {};
  const trees = new Map();
  const installs = [];
  const results = [];
  try {
    const versions = Object.fromEntries(opts.host.map((h) => [h, versionOf(h === "cursor" ? "cursor-agent" : h)]));
    const piModels = opts.host.includes("pi")
      ? sh("pi", ["--list-models"], { allowFail: true, env: { ...process.env, PI_CODING_AGENT_DIR: piAgentDir } })
          .split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 1).map(([p, m]) => `${p}/${m}`)
      : null;
    let n = 0;
    for (const id of opts.scenario) {
      const scenario = scenarioById(id);
      if (!scenario) throw new Error(`unknown scenario ${id}`);
      for (const hostName of opts.host) {
        const host = HOSTS[hostName];
        if (!host) throw new Error(`unknown host ${hostName}`);
        if (!scenario.hosts[hostName]) continue;
        for (const arm of armsFor(scenario, opts.arm)) {
          const armKind = arm.startsWith("ref:") ? "ref" : arm;
          if (!host.arms.includes(armKind)) continue;
          if (!trees.has(`${hostName}:${arm}`)) {
            const tree = join(workbench, `tree-${trees.size}`, arm === "upstream" ? "pstack" : "pstack-all");
            materialize(arm, tree);
            if (arm === "ablate") host.ablate(tree);
            trees.set(`${hostName}:${arm}`, tree);
            if (host.install) installs.push({ key: `${hostName}:${arm}`, ...host.install(tree) });
          }
          const pluginRoot = trees.get(`${hostName}:${arm}`);
          for (let trial = 1; trial <= opts.trials; trial++) {
            n++;
            const dir = join(out, `${id}.${hostName}.${arm.replace(":", "-")}.${trial}`);
            mkdirSync(dir, { recursive: true });
            const project = join(workbench, `cell-${n}`, scenario.fixture);
            const seed = seedProject(scenario, project);
            if (hostName === "pi") sh("pi", ["install", "-l", pluginRoot], { cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: piAgentDir } });
            seed.commit();
            const stagedBefore = scenario.overlay?.staged ? seed.staged() : null;
            const cell = {
              scenario: id, scenarioSha: sha(JSON.stringify(scenario)), scenarioSnapshot: scenario, gradingSha: gradingSha(hostName), host: hostName, arm, trial,
              dir, project, pluginRoot,
              skillsDir: join(pluginRoot, arm === "upstream" ? "skills" : "pstack/skills"),
              adapterPath: host.adapter(pluginRoot, arm),
              installedRoot: installs.find((i) => i.key === `${hostName}:${arm}`)?.installedRoot,
              prompt: `${host.command(scenario.skill)}${scenario.prompt ? ` ${scenario.prompt}` : ""}`,
              models: { claude: opts.claudeModel, pi: opts.piModel, cursor: opts.cursorModel, grok: opts.grokModel, opencode: opts.opencodeModel }[hostName] ?? null,
              repoHead: sh("git", ["-C", repo, "rev-parse", "HEAD"]),
              repoDirty: sh("git", ["-C", repo, "status", "--porcelain"]) !== "",
              pstackTree: sh("git", ["-C", repo, "rev-parse", "HEAD:pstack"]),
              versions: { [hostName]: versions[hostName], node: process.version },
              piModels: hostName === "pi" ? piModels : undefined,
              startedAt: new Date().toISOString(),
            };
            const rules = snapshotRules();
            const plan = host.launch(cell, { ...opts, piAgentDir: opts.piAgentDir });
            write(join(dir, "shims.log"), "");
            // Outside the project, so the shims never show in its git status.
            plan.env.PATH = installShims(join(workbench, `cell-${n}`, "bin"), join(dir, "shims.log"), plan.env.PATH ?? process.env.PATH);
            Object.assign(plan.env, withoutCredentials(join(workbench, `cell-${n}`, "gh-config")));
            cell.shims = true;
            cell.argv = plan.argv;
            console.error(`cells: ${n} ${id} ${hostName} ${arm} trial ${trial}`);
            cell.process = await launch(plan, project, dir, opts.timeout);
            if (hostName === "pi") collectPiLeftovers(piAgentDir, workbench, dir);
            write(join(dir, "rules.json"), { changed: restoreRules(rules) });
            write(join(dir, "git-status.txt"), seed.status());
            if (stagedBefore !== null) write(join(dir, "staged.json"), { before: stagedBefore, after: seed.staged() });
            write(join(dir, "cell.json"), cell);
            seal(dir);
            const { run, result } = gradeCell(dir);
            results.push({ dir: relative(out, dir), scenario: id, host: hostName, arm, trial, status: result.status, ok: result.ok, reference: result.reference, cost: run.cost, failing: failing(result) });
            console.error(`cells:   ${result.ok ? "ok" : "NOT OK"} ${failing(result).join(" ") || ""}`);
          }
        }
      }
    }
  } finally {
    for (const install of installs) install.uninstall();
    untrust();
    rmSync(workbench, { recursive: true, force: true });
    summarize(out, results);
  }
  return results;
}

const failing = (result) => Object.entries(result.verdicts).filter(([, v]) => v.verdict === "fail").map(([name]) => name);

const STATUS_LABEL = { ok: "ok", "not ok": "NOT OK", "not-assessable": "not-assessable" };

function summarize(out, results) {
  write(join(out, "summary.json"), results);
  const rows = results.map((r) => `| ${r.scenario} | ${r.host}${r.reference ? " (ref)" : ""} | ${r.arm} | ${r.trial} | ${STATUS_LABEL[r.status]} | ${r.reason ?? r.failing.join(", ")} | ${r.cost == null ? "" : r.cost.toFixed(2)} |`);
  write(join(out, "summary.md"), ["| scenario | host | arm | trial | result | failing | usd |", "|---|---|---|---|---|---|---|", ...rows, ""].join("\n"));
  console.log(readFileSync(join(out, "summary.md"), "utf8"));
}

// --- grade and check -------------------------------------------------------------------------------------------

function cellDirs(dir) {
  if (existsSync(join(dir, "cell.json"))) return [dir];
  return readdirSync(dir).map((d) => join(dir, d)).filter((d) => statSync(d).isDirectory() && existsSync(join(d, "cell.json")));
}

function regrade(dir, criteria) {
  const results = cellDirs(resolve(dir)).map((d) => {
    verifySeal(d);
    const { cell, run, result } = gradeCell(d, criteria);
    return {
      dir: relative(resolve(dir), d) || ".", scenario: cell.scenario, host: cell.host, arm: cell.arm, trial: cell.trial,
      status: result.status, ok: result.ok, reason: result.reason, reference: result.reference, cost: run?.cost ?? null, failing: failing(result),
    };
  });
  summarize(resolve(dir), results);
  return results.every((r) => r.ok || r.reference);
}

export function checkCatalog(scenarios = SCENARIOS) {
  const problems = [];
  const ids = new Set();
  for (const s of scenarios) {
    if (ids.has(s.id)) problems.push(`${s.id}: duplicate id`);
    ids.add(s.id);
    if (!existsSync(join(repo, "pstack/skills", s.skill, "SKILL.md"))) problems.push(`${s.id}: no skill ${s.skill}`);
    if (!existsSync(join(here, "fixtures", s.fixture))) problems.push(`${s.id}: no fixture ${s.fixture}`);
    if (s.overlay && !existsSync(join(here, "overlays", s.overlay.dir))) problems.push(`${s.id}: no overlay ${s.overlay.dir}`);
    if (BLINDED.test(s.prompt)) problems.push(`${s.id}: prompt names the observation (${BLINDED.exec(s.prompt)[0]})`);
    if (!s.control?.length) problems.push(`${s.id}: no negative control`);
    const baseline = s.baseline_ref && spawnSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${s.baseline_ref}^{commit}`]);
    if (baseline && baseline.status !== 0) problems.push(`${s.id}: baseline_ref ${s.baseline_ref} is not a commit`);
    for (const host of Object.keys(s.hosts)) {
      if (!HOSTS[host]) { problems.push(`${s.id}: unknown host ${host}`); continue; }
      const expect = expectFor(s, host);
      for (const name of s.control) if (!(name in expect)) problems.push(`${s.id}/${host}: control ${name} is not an expected criterion`);
      if (s.control.includes("answer") && !expect.answer) problems.push(`${s.id}/${host}: control needs answer patterns`);
    }
  }
  for (const dir of readdirSync(join(here, "fixtures"))) {
    for (const file of filesUnder(join(here, "fixtures", dir))) if (BLINDED.test(file.replace(/package\.json$/, ""))) problems.push(`fixture ${dir}/${file} names the observation`);
  }
  return problems;
}

function checkGolden() {
  const problems = [];
  const root = join(here, "golden");
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
    verifySeal(dir);
    // Host parsers skip a line that does not parse, as a live run's last line can be partial; a golden file must not rely on that.
    for (const file of filesUnder(dir).filter((f) => f.endsWith(".jsonl"))) {
      readFileSync(join(dir, file), "utf8").split("\n").forEach((line, i) => {
        try { if (line.trim()) JSON.parse(line); } catch { problems.push(`golden ${name}: ${file} line ${i + 1} is not JSON`); }
      });
    }
    const { result } = gradeCell(dir);
    const got = Object.fromEntries(Object.entries(result.verdicts).map(([k, v]) => [k, v.verdict]));
    rmSync(join(dir, "run.json"));
    rmSync(join(dir, "grade.json"));
    const want = expected.verdicts;
    const diff = Object.keys({ ...want, ...got }).filter((k) => want[k] !== got[k]);
    if (diff.length) problems.push(`golden ${name}: ${diff.map((k) => `${k} want ${want[k]} got ${got[k]}`).join("; ")}`);
    else if (result.ok !== expected.ok) problems.push(`golden ${name}: ok want ${expected.ok} got ${result.ok}`);
    else console.log(`cells: golden ${name} grades as recorded (${Object.keys(want).length} criteria, ok=${result.ok})`);
  }
  return problems;
}

async function main([command, ...rest]) {
  try {
    if (command === "list") {
      for (const s of SCENARIOS) console.log(`${s.id.padEnd(20)} ${s.skill.padEnd(14)} ${Object.keys(s.hosts).join(",").padEnd(18)} ${s.why}`);
    } else if (command === "run") {
      const results = await runCells(parseArgs(rest));
      process.exitCode = results.length === 0 ? 2 : results.every((r) => r.ok || r.reference) ? 0 : 1;
    } else if (command === "grade") {
      const flag = rest.indexOf("--criteria");
      const criteria = flag === -1 ? "current" : rest[flag + 1];
      if (!["current", "original"].includes(criteria)) throw new Error("--criteria takes current or original");
      const dirs = rest.filter((_, i) => flag === -1 || (i !== flag && i !== flag + 1));
      process.exitCode = regrade(dirs[0] ?? ".", criteria) ? 0 : 1;
    } else if (command === "seal") {
      // For hand-built golden cells under evals/golden/.
      seal(resolve(rest[0]));
    } else if (command === "check") {
      const problems = [...checkCatalog(), ...checkGolden()];
      for (const p of problems) console.log(`cells: FAIL ${p}`);
      if (!problems.length) console.log(`cells: catalog of ${SCENARIOS.length} scenarios is consistent`);
      process.exitCode = problems.length ? 1 : 0;
    } else {
      console.error("usage: cells.mjs list | run --scenario <ids|all> --host <names> [...] | grade <dir> [--criteria current|original] | check");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`cells: ${error.message}`);
    process.exitCode = 2;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
