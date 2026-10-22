#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(join(ROOT, "pstack/plugin.json"), "utf8"));

// docs/specs/<harness>.md records the verified behavior behind each row.
const HARNESSES = [
  {
    harness: "grok-cli",
    file: "plugin.json",
    render: () => ({ ...base, skills: "./pstack/skills/", agents: "./pstack/agents/" }),
  },
  {
    harness: "cursor, grok-bot",
    file: ".cursor-plugin/marketplace.json",
    render: () => ({
      name: "pstack-all",
      owner: { name: "Dragos Musetescu" },
      metadata: { description: "pstack, unchanged, packaged for more harnesses" },
      plugins: [{ name: base.name, source: "pstack", description: base.description }],
    }),
  },
];

const check = process.argv.includes("--check");
let drift = 0;
for (const { harness, file, render } of HARNESSES) {
  const path = join(ROOT, file);
  const want = `${JSON.stringify(render(), null, 2)}\n`;
  const have = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (want === have) {
    console.log(`manifests: ok ${file} (${harness})`);
  } else if (check) {
    console.log(`manifests: DRIFT ${file} (${harness}) ${have === undefined ? "is missing" : "differs from pstack/plugin.json"}`);
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
