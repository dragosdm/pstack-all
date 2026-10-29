import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCatalog, gradingSha } from "../evals/cells.mjs";
import { SCENARIOS, armsFor } from "../evals/scenarios.mjs";
import { opencode } from "../evals/hosts/opencode.mjs";
import { installShims, withoutCredentials } from "../evals/shims.mjs";

const repo = join(import.meta.dir, "..");
const cells = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(Bun.which("node")!, [join(repo, "evals/cells.mjs"), ...args], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH!, ...env } });
const made: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-"));
  made.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const golden = join(repo, "evals/golden/claude-how-simple");
const scenario = SCENARIOS.find((s) => s.id === "how-simple")!;

// A copy of a real Claude transcript, sealed the way a cell run seals it.
function sealedCell(edit: (cell: Record<string, unknown>) => void, files: Record<string, string> = {}) {
  const dir = join(scratch(), "cell");
  cpSync(golden, dir, { recursive: true });
  const cell = JSON.parse(readFileSync(join(dir, "cell.json"), "utf8"));
  edit(cell);
  writeFileSync(join(dir, "cell.json"), JSON.stringify(cell));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  expect(cells(["seal", dir]).status).toBe(0);
  return dir;
}
const graded = (dir: string, ...flags: string[]) => {
  const r = cells(["grade", dir, ...flags]);
  return { exit: r.status, ...JSON.parse(readFileSync(join(dir, "grade.json"), "utf8")) };
};

describe("baseline arm", () => {

  test("ab runs the baseline commit and the working tree", () => {
    expect(armsFor({ ...scenario, baseline_ref: "be1ebc5" }, ["ab"])).toEqual(["ref:be1ebc5", "post"]);
    expect(armsFor({ ...scenario, baseline_ref: "be1ebc5" }, ["ab", "ablate", "post"])).toEqual(["ref:be1ebc5", "post", "ablate"]);
    expect(armsFor(scenario, ["post", "ablate"])).toEqual(["post", "ablate"]);
  });

  test("ab refuses a scenario with no baseline", () => {
    expect(() => armsFor(scenario, ["ab"])).toThrow(/how-simple has none/);
  });

  test("run --arm ab refuses before it creates any evidence", () => {
    const dir = scratch();
    const out = join(dir, "run");
    // An empty PATH, so a regression cannot start a billed session.
    const r = cells(["run", "--scenario", "how-simple,how-complex", "--host", "pi", "--arm", "ab", "--out", out], { PATH: dir });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--arm ab needs a baseline_ref, and how-simple, how-complex have none");
    expect(existsSync(out)).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("check rejects a baseline_ref that is not a commit and accepts one that is", () => {
    const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    expect(checkCatalog([{ ...scenario, baseline_ref: "no-such-ref" }])).toContain("how-simple: baseline_ref no-such-ref is not a commit");
    expect(checkCatalog([{ ...scenario, baseline_ref: head }])).toEqual([]);
    expect(checkCatalog()).toEqual([]);
  });
});

describe("original-mode regrade", () => {
  test("grades with the frozen scenario, not today's", () => {
    const stricter = { ...scenario, expect: { ...scenario.expect, spawns: [2, 2] } };
    const dir = sealedCell((cell) => Object.assign(cell, { scenarioSnapshot: stricter, gradingSha: gradingSha("claude") }));
    const original = graded(dir, "--criteria", "original");
    expect([original.exit, original.status, original.verdicts.spawns.verdict]).toEqual([1, "not ok", "fail"]);
    const current = graded(dir);
    expect([current.exit, current.status, current.verdicts.spawns.verdict]).toEqual([0, "ok", "pass"]);
    const same = sealedCell((cell) => Object.assign(cell, { scenarioSnapshot: scenario, gradingSha: gradingSha("claude") }));
    expect(graded(same, "--criteria", "original").status).toBe("ok");
  });

  test("is not-assessable when the grading code changed since the run", () => {
    const dir = sealedCell((cell) => Object.assign(cell, { scenarioSnapshot: scenario, gradingSha: "0".repeat(64) }));
    const result = graded(dir, "--criteria", "original");
    expect([result.exit, result.status, result.ok, result.verdicts]).toEqual([1, "not-assessable", null, {}]);
    expect(result.reason).toContain("grading code changed");
  });

  test("is not-assessable for a cell sealed before snapshots", () => {
    const dir = sealedCell(() => {});
    expect(graded(dir, "--criteria", "original").status).toBe("not-assessable");
    expect(graded(dir).status).toBe("ok");
  });

  test("the grading hash covers the host's parser", () => {
    expect(gradingSha("claude")).toMatch(/^[0-9a-f]{64}$/);
    expect(gradingSha("claude")).not.toBe(gradingSha("pi"));
  });

  test("a cell can be graded again after a grade", () => {
    const dir = sealedCell(() => {});
    expect([cells(["grade", dir]).status, cells(["grade", dir]).status]).toEqual([0, 0]);
  });
});

describe("opencode host", () => {
  test("ablate removes the adapter line from the context hook and nothing else", () => {
    const tree = scratch();
    const plugin = join(tree, ".opencode/plugins/pstack.js");
    cpSync(join(repo, ".opencode"), join(tree, ".opencode"), { recursive: true });
    const before = readFileSync(plugin, "utf8");
    opencode.ablate(tree);
    const after = readFileSync(plugin, "utf8");
    expect(before).toContain("text: adapterLine");
    expect(after).not.toContain("text: adapterLine");
    expect(after).toContain("if (agent) event.system.push({ type: \"text\", text: agent.body })");
    expect(() => opencode.ablate(tree)).toThrow(/no longer pushes the adapter line/);
  });
});

describe("git and gh shims", () => {
  const dir = scratch();
  const log = join(dir, "shims.log");
  const PATH = installShims(join(dir, "bin"), log);
  const run = (cmd: string, ...args: string[]) => {
    const before = existsSync(log) ? readFileSync(log, "utf8") : "";
    const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", env: { PATH } });
    const logged = (existsSync(log) ? readFileSync(log, "utf8") : "").slice(before.length).trim();
    return { exit: r.status, out: r.stdout, err: r.stderr, logged };
  };

  test("git push is logged and refused, other git calls run the real git", () => {
    expect(run("git", "init", "-q", "repo").exit).toBe(0);
    const status = run("git", "-C", "repo", "status", "--porcelain");
    expect([status.exit, status.logged]).toEqual([0, ""]);
    for (const args of [["push"], ["-C", "repo", "push", "origin", "main"], ["-c", "push.default=current", "push"]]) {
      const push = run("git", ...args);
      expect([push.exit, push.logged]).toEqual([128, `git ${args.join(" ")}`]);
      expect(push.err).toContain("No configured push destination");
    }
  });

  test("gh pr and gh api writes are logged and refused, reads pass through", () => {
    for (const args of [
      ["pr", "create", "--fill"],
      ["pr", "merge", "1"],
      ["api", "-X", "POST", "repos/o/r/issues"],
      ["api", "--method=delete", "repos/o/r"],
      ["api", "repos/o/r/issues", "-f", "title=x"],
      ["api", "graphql", "-f", "query=mutation { x }"],
    ]) {
      const write = run("gh", ...args);
      expect([write.exit, write.logged]).toEqual([1, `gh ${args.join(" ")}`]);
    }
    for (const args of [["pr", "view", "--help"], ["api", "--help"], ["--version"]]) expect(run("gh", ...args).logged).toBe("");
    if (Bun.which("gh")) expect(run("gh", "--version").out).toContain("gh version");
  });

  test("gh refuses writes in any command group and passes their read verbs", () => {
    for (const args of [["issue", "create", "--title", "x"], ["release", "create", "v1"], ["repo", "delete", "o/r"], ["workflow", "run", "ci"]]) {
      const write = run("gh", ...args);
      expect([write.exit, write.logged]).toEqual([1, `gh ${args.join(" ")}`]);
    }
    for (const args of [["issue", "view", "--help"], ["repo", "view", "--help"], ["run", "list", "--help"], ["auth", "status", "--help"]]) {
      expect(run("gh", ...args).logged).toBe("");
    }
  });

  test("git send-pack is logged and refused", () => {
    const sendPack = run("git", "send-pack", "origin", "main");
    expect([sendPack.exit, sendPack.logged]).toEqual([128, "git send-pack origin main"]);
  });

  test("without credentials, a push the shims miss never reaches ssh or a gh token", () => {
    // The ssh a user's environment would run records that it was called, so the test sees whether git used it.
    const called = join(dir, "ssh-called");
    const ssh = join(dir, "record-ssh");
    writeFileSync(ssh, `#!/bin/sh\ntouch ${called}\nexit 1\n`, { mode: 0o755 });
    const user: Record<string, string> = { PATH, GH_TOKEN: "secret", GIT_SSH_COMMAND: ssh };
    const offline = { ...user };
    for (const [key, value] of Object.entries(withoutCredentials(join(dir, "gh-config")))) value === undefined ? delete offline[key] : (offline[key] = value);
    const repo = mkdtempSync(join(dir, "alias-"));
    spawnSync("git", ["init", "-q"], { cwd: repo, env: user });
    spawnSync("git", ["-c", "user.email=dev@example.invalid", "-c", "user.name=dev", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo, env: user });
    const push = (env: Record<string, string>) =>
      spawnSync("git", ["-c", "alias.p=push", "p", "ssh://git@example.invalid/o/r.git", "HEAD"], { cwd: repo, encoding: "utf8", env });
    expect(push(user).status).not.toBe(0);
    expect(existsSync(called)).toBe(true);
    rmSync(called);
    expect(push(offline).status).not.toBe(0);
    expect(existsSync(called)).toBe(false);
    expect(offline.GH_TOKEN).toBeUndefined();
  });

  test("noRemoteWrites fails on a logged attempt, passes on an empty log, and is n/a without one", () => {
    const verdict = (files: Record<string, string>) => graded(sealedCell(() => {}, files)).verdicts.noRemoteWrites.verdict;
    expect(verdict({ "shims.log": "git push origin main\n" })).toBe("fail");
    expect(verdict({ "shims.log": "" })).toBe("pass");
    expect(verdict({})).toBe("n/a");
  });

  test("noRemoteWrites fails when a shimmed cell lost its log during the run", () => {
    const dir = sealedCell((cell) => { cell.shims = true; });
    expect(graded(dir).verdicts.noRemoteWrites.verdict).toBe("fail");
  });
});
