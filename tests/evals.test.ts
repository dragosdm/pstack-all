import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCatalog } from "../evals/cells.mjs";
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
