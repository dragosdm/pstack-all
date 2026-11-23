import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

    const entries = [
      "plugin.json",
      ".codex-plugin/plugin.json",
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      ".cursor-plugin/marketplace.json",
      "package.json",
    ]
    const before = entries.map((file) => read(dir, file))
    expect(sync(dir, "--check").status).not.toBe(0)
    expect(entries.map((file) => read(dir, file))).toEqual(before)

    expect(sync(dir).status).toBe(0)
    const check = sync(dir, "--check")
    expect(check.status, check.stdout).toBe(0)
    expect(json(dir, "plugin.json").description).toBe(description)
    expect(json(dir, ".claude-plugin/plugin.json").description).toBe(description)
    expect(json(dir, ".codex-plugin/plugin.json").description).toBe(description)
    expect(json(dir, ".codex-plugin/plugin.json").interface.shortDescription).toBe(description)
    expect(json(dir, "package.json").description).toBe(description)
    expect(json(dir, ".claude-plugin/marketplace.json").plugins[0].description).toBe(description)
    expect(json(dir, ".cursor-plugin/marketplace.json").plugins[0].description).toBe(description)
  })

  test("the root plugin.json has no $schema, so Codex reads .codex-plugin/plugin.json and its skills", () => {
    expect(json(root, "pstack/plugin.json").$schema).toStartWith("https://agent-plugins.org/schemas/")
    expect(json(root, "plugin.json")).not.toHaveProperty("$schema")
    expect(json(root, ".codex-plugin/plugin.json").skills).toBe("./pstack/skills/")
  })

  test("the Codex adapter hook is not at hooks/hooks.json, which Claude Code also loads from the plugin root", () => {
    expect(json(root, ".codex-plugin/plugin.json").hooks).toBe("./.codex-plugin/hooks.json")
    expect(existsSync(join(root, "hooks/hooks.json"))).toBe(false)
  })

  test("each Antigravity agent keeps upstream's body and name and description, with no model and every write tool", () => {
    const split = (text: string) => {
      const match = /^---\n([\s\S]*?)\n---\n/.exec(text)!
      return { meta: Bun.YAML.parse(match[1]) as Record<string, unknown>, body: text.slice(match[0].length) }
    }
    const names = readdirSync(join(root, "pstack/agents")).filter((name) => name.endsWith(".md"))
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const upstream = split(read(root, `pstack/agents/${name}`))
      const agy = split(read(root, `.agy/agents/${name}`))
      expect(agy.body).toBe(upstream.body)
      expect(agy.meta).toEqual({
        name: upstream.meta.name,
        description: upstream.meta.description,
        mainAgent: false,
        tools: ["read_file", "write_file", "edit_file", "run_command", "search_web", "ask_question", "invoke_subagent",
          "send_message", "manage_subagents", "manage_task"],
      })
    }
  })
})
