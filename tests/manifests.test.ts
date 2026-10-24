import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"

setDefaultTimeout(30_000)

const root = resolve(import.meta.dir, "..")
const work = mkdtempSync(join(tmpdir(), "pstack-manifests-"))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const sync = (dir: string, ...args: string[]) =>
  spawnSync("node", ["scripts/sync-manifests.mjs", ...args], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } })

function copyRepo(): string {
  const dir = join(work, "repo")
  const files = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).stdout.split("\0").filter(Boolean)
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    cpSync(join(root, file), join(dir, file))
  }
  return dir
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8")
const json = (dir: string, file: string) => JSON.parse(read(dir, file))

describe("sync-manifests", () => {
  test("--check passes on the repo", () => {
    const run = sync(root, "--check")
    expect(run.status, run.stdout).toBe(0)
  })

  test("a pstack/plugin.json edit fails --check until the generator renders it into every entry file", () => {
    const dir = copyRepo()
    const description = "a description only this test writes"
    const base = json(dir, "pstack/plugin.json")
    writeFileSync(join(dir, "pstack/plugin.json"), `${JSON.stringify({ ...base, description }, null, 2)}\n`)

    const entries = ["plugin.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", ".cursor-plugin/marketplace.json", "package.json"]
    const before = entries.map((file) => read(dir, file))
    expect(sync(dir, "--check").status).not.toBe(0)
    expect(entries.map((file) => read(dir, file))).toEqual(before)

    expect(sync(dir).status).toBe(0)
    const check = sync(dir, "--check")
    expect(check.status, check.stdout).toBe(0)
    expect(json(dir, "plugin.json").description).toBe(description)
    expect(json(dir, ".claude-plugin/plugin.json").description).toBe(description)
    expect(json(dir, "package.json").description).toBe(description)
    expect(json(dir, ".claude-plugin/marketplace.json").plugins[0].description).toBe(description)
    expect(json(dir, ".cursor-plugin/marketplace.json").plugins[0].description).toBe(description)
  })
})
