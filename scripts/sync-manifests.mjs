#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(join(ROOT, "pstack/plugin.json"), "utf8"));
// Codex reads a root plugin.json with an Agent Plugins $schema ahead of .codex-plugin/plugin.json, then ignores its
// skills key and finds no skills. Grok CLI loads the same inventory without it.
const { $schema, ...meta } = base;
// Claude Code rejects a directory here and wants each agent file.
const agents = readdirSync(join(ROOT, "pstack/agents"))
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => `./pstack/agents/${name}`);
// agy skips an agent whose model is not inherit, flash or pro, and gives an agent with no tools read-only ones. These
// names match agy 1.5.15's own tool declarations; an unknown name can hang a subagent.
const AGY_TOOLS = ["read_file", "write_file", "edit_file", "run_command", "search_web", "ask_question", "invoke_subagent",
  "send_message", "manage_subagents", "manage_task"];
function agyAgent(file) {
  const source = readFileSync(join(ROOT, file), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) throw new Error(`${file}: no frontmatter`);
  const keep = match[1].split("\n").filter((line) => /^(name|description): \S/.test(line));
  if (keep.length !== 2) throw new Error(`${file}: want one single-line name and description, found ${keep.length} lines`);
  const tools = AGY_TOOLS.map((tool) => `  - ${tool}`);
  return `---\n${[...keep, "mainAgent: false", "tools:", ...tools].join("\n")}\n---\n${source.slice(match[0].length)}`;
}
// Upstream writes this line into each SKILL.md of a generated Claude tree; a hook keeps pstack/ unchanged.
const ADAPTER =
  'echo "pstack skills use Cursor names. Before you follow a pstack skill, read ${CLAUDE_PLUGIN_ROOT}/pstack/docs/harness/claude-code.md once per session."';
const CODEX_ADAPTER =
  'echo "pstack skills use Cursor names. Before you follow a pstack skill, read ${PLUGIN_ROOT}/docs/harness/codex.md once per session."';
const catalog = {
  name: "pstack-all",
  owner: { name: "Dragos Musetescu" },
  metadata: { description: "pstack, unchanged, packaged for more harnesses" },
};

// docs/specs/<harness>.md records the verified behavior behind each row.
const HARNESSES = [
  {
    harness: "grok-cli",
    file: "plugin.json",
    render: () => ({ ...meta, skills: "./pstack/skills/", agents: "./pstack/agents/" }),
  },
  {
    // Codex plugins cannot declare agents, so poteto-agent and comment-sicko are not registered.
    harness: "codex",
    file: ".codex-plugin/plugin.json",
    render: () => ({
      ...meta,
      skills: "./pstack/skills/",
      hooks: "./.codex-plugin/hooks.json",
      interface: {
        displayName: base.name,
        shortDescription: base.description,
        developerName: base.author.name,
        category: "Coding",
        websiteURL: base.homepage,
        logo: "./pstack/assets/logo.png",
      },
    }),
  },
  {
    // Not hooks/hooks.json, the default path, which Claude Code would also load from the same plugin root.
    harness: "codex",
    file: ".codex-plugin/hooks.json",
    render: () => ({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: CODEX_ADAPTER }] }] } }),
  },
  {
    harness: "codex",
    file: ".agents/plugins/marketplace.json",
    render: () => ({
      name: catalog.name,
      interface: { displayName: catalog.name },
      plugins: [
        {
          name: base.name,
          source: { source: "local", path: "./" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Coding",
        },
      ],
    }),
  },
  {
    harness: "cursor, grok-bot",
    file: ".cursor-plugin/marketplace.json",
    render: () => ({
      ...catalog,
      plugins: [{ name: base.name, source: "pstack", description: base.description }],
    }),
  },
  {
    harness: "claude-code",
    file: ".claude-plugin/plugin.json",
    render: () => ({
      ...base,
      skills: "./pstack/skills/",
      agents,
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: ADAPTER }] }] },
    }),
  },
  {
    harness: "claude-code",
    file: ".claude-plugin/marketplace.json",
    render: () => ({
      ...catalog,
      plugins: [{ name: base.name, source: "./", description: base.description }],
    }),
  },
  {
    // A Pi package is a package.json with a pi key; the subagent extension reads pstack/agents itself. opencode loads
    // the plugin from main. The ./tests path keeps bun out of pstack/'s own suites, which check-base.sh runs.
    harness: "pi, opencode",
    file: "package.json",
    render: () => ({
      ...meta,
      private: true,
      type: "module",
      main: "index.js",
      scripts: { test: "bun test ./tests" },
      keywords: [...meta.keywords, "pi-package"],
      pi: {
        extensions: ["./.pi/extensions/pstack.ts", "./.pi/extensions/subagent/index.ts"],
        skills: ["./pstack/skills"],
      },
    }),
  },
  {
    harness: "antigravity",
    file: ".agy/plugin.json",
    render: () => ({
      name: "pstack-agy",
      version: base.version,
      description: "Antigravity adapter for pstack: install pstack/ alongside it.",
      author: catalog.owner,
      homepage: "https://github.com/dragosdm/pstack-all",
      repository: "https://github.com/dragosdm/pstack-all",
      license: base.license,
    }),
  },
  ...agents.map((agent) => ({
    harness: "antigravity",
    file: `.agy/agents/${agent.split("/").at(-1)}`,
    render: () => agyAgent(agent),
  })),
];

const check = process.argv.includes("--check");
let drift = 0;
for (const { harness, file, render } of HARNESSES) {
  const path = join(ROOT, file);
  const rendered = render();
  const want = typeof rendered === "string" ? rendered : `${JSON.stringify(rendered, null, 2)}\n`;
  const have = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (want === have) {
    console.log(`manifests: ok ${file} (${harness})`);
  } else if (check) {
    console.log(`manifests: DRIFT ${file} (${harness}) ${have === undefined ? "is missing" : "differs from its pstack/ source"}`);
    drift++;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, want);
    console.log(`manifests: wrote ${file} (${harness})`);
  }
}
if (drift > 0) {
  console.log("manifests: FAIL run `node scripts/sync-manifests.mjs` and commit the result");
  process.exit(1);
}
