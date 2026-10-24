import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCatalog, gradingSha } from "../evals/cells.mjs";
import { SCENARIOS, armsFor } from "../evals/scenarios.mjs";

const repo = join(import.meta.dir, "..");
const cells = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(Bun.which("node")!, [join(repo, "evals/cells.mjs"), ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
const scratch = () => mkdtempSync(join(tmpdir(), "evals-"));

describe("baseline arm", () => {
  const base = SCENARIOS.find((s) => s.id === "how-simple")!;

  test("ab runs the baseline commit and the working tree", () => {
    expect(armsFor({ ...base, baseline_ref: "be1ebc5" }, ["ab"])).toEqual(["ref:be1ebc5", "post"]);
    expect(armsFor({ ...base, baseline_ref: "be1ebc5" }, ["ab", "ablate", "post"])).toEqual(["ref:be1ebc5", "post", "ablate"]);
    expect(armsFor(base, ["post", "ablate"])).toEqual(["post", "ablate"]);
  });

  test("ab refuses a scenario with no baseline", () => {
    expect(() => armsFor(base, ["ab"])).toThrow(/how-simple has none/);
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
    expect(checkCatalog([{ ...base, baseline_ref: "no-such-ref" }])).toContain("how-simple: baseline_ref no-such-ref is not a commit");
    expect(checkCatalog([{ ...base, baseline_ref: head }])).toEqual([]);
    expect(checkCatalog()).toEqual([]);
  });
});

describe("original-mode regrade", () => {
  const golden = join(repo, "evals/golden/claude-how-simple");
  const scenario = SCENARIOS.find((s) => s.id === "how-simple")!;

  // A copy of a real Claude transcript, sealed the way a cell run seals it.
  function sealedCell(edit: (cell: Record<string, unknown>) => void) {
    const dir = join(scratch(), "cell");
    cpSync(golden, dir, { recursive: true });
    const cell = JSON.parse(readFileSync(join(dir, "cell.json"), "utf8"));
    edit(cell);
    writeFileSync(join(dir, "cell.json"), JSON.stringify(cell));
    expect(cells(["seal", dir]).status).toBe(0);
    return dir;
  }
  const graded = (dir: string, ...flags: string[]) => {
    const r = cells(["grade", dir, ...flags]);
    return { exit: r.status, ...JSON.parse(readFileSync(join(dir, "grade.json"), "utf8")) };
  };

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
