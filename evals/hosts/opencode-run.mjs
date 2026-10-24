#!/usr/bin/env node
// Runs one opencode session the way the TUI does: `opencode serve` on localhost, a /pstack:<name> command posted to the
// session, then every session it started exported as JSON lines on stdout. `opencode run "/x"` sends the text as is.
//   node opencode-run.mjs '{"opencode", "project", "home", "tree", "command", "text", "config", "timeout"}'
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const spec = JSON.parse(process.argv[2]);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + spec.timeout * 1000;

const freePort = () =>
  new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// Every XDG dir lives under the cell's own folder, so the session sees only the cell's tree and none of the user's config.
const xdg = { HOME: spec.home, XDG_CONFIG_HOME: join(spec.home, ".config"), XDG_DATA_HOME: join(spec.home, ".local/share"), XDG_STATE_HOME: join(spec.home, ".local/state"), XDG_CACHE_HOME: join(spec.home, ".cache") };
for (const dir of Object.values(xdg)) mkdirSync(dir, { recursive: true });
mkdirSync(join(xdg.XDG_CONFIG_HOME, "opencode"), { recursive: true });
// Headless Claude has no question tool either, and web tools stay off as in every other cell.
const denied = ["question", "webfetch", "websearch"].map((action) => ({ action, resource: "*", effect: "deny" }));
writeFileSync(join(xdg.XDG_CONFIG_HOME, "opencode/opencode.json"), JSON.stringify({ plugins: [spec.tree], permissions: denied, ...spec.config }, null, 2));

const password = randomBytes(12).toString("hex");
const port = await freePort();
const server = spawn(spec.opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: spec.project,
  env: { ...process.env, ...xdg, OPENCODE_SERVER_PASSWORD: password, OPENCODE_DISABLE_AUTOUPDATE: "1" },
  stdio: ["ignore", "ignore", "inherit"],
});
const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
const location = `location%5Bdirectory%5D=${encodeURIComponent(spec.project)}`;
async function api(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}${path.includes("?") ? "&" : "?"}${location}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

let status = 0;
try {
  // Plugins load after the server answers, so poll until pstack is listed. A tree without the plugin never lists it.
  let plugin = null;
  const pluginDeadline = Math.min(deadline, Date.now() + 20000);
  while (!plugin && Date.now() < pluginDeadline) {
    plugin = (await api("/api/plugin").catch(() => null))?.data?.find((p) => p.id === "pstack" && p.state?.status !== "loading") ?? null;
    if (!plugin) await sleep(200);
  }
  emit({ type: "plugin", plugin });
  const root = (await api("/api/session", {})).data.id;
  await api(`/api/session/${root}/command`, { name: spec.command, text: spec.text });

  // The run is over when nothing is running and the root has nothing queued, three polls in a row.
  // An ask that the config did not settle is rejected, as headless Claude denies a tool outside its allowlist.
  let quiet = 0;
  while (quiet < 3) {
    if (Date.now() > deadline) {
      emit({ type: "timeout" });
      status = 1;
      break;
    }
    for (const request of (await api("/api/permission/request")).data) {
      emit({ type: "permission", request });
      await api(`/api/session/${request.sessionID}/permission/${request.id}/reply`, { decision: "reject" });
    }
    const active = Object.keys((await api("/api/session/active")).data);
    const inbox = (await api(`/api/session/${root}/inbox`)).data ?? [];
    const messages = (await api(`/api/experimental/session/${root}/export`)).data.messages;
    quiet = active.length === 0 && inbox.length === 0 && messages.at(-1)?.type === "idle" ? quiet + 1 : 0;
    await sleep(300);
  }

  const sessions = (await api("/api/session")).data;
  const tree = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of sessions) if (s.parentID && tree.has(s.parentID) && !tree.has(s.id)) (tree.add(s.id), (grew = true));
  }
  for (const id of tree) {
    const session = sessions.find((s) => s.id === id);
    emit({ type: "session", id, parentID: session?.parentID ?? null, export: (await api(`/api/experimental/session/${id}/export`)).data });
  }
} catch (error) {
  emit({ type: "error", message: error.message });
  status = 1;
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    const killer = setTimeout(() => server.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(killer);
  }
}
process.exit(status);
