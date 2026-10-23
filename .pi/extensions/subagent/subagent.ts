#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assistantText,
	discardRun,
	effectiveRunState,
	getRunsDir,
	inboxDir,
	launchRun,
	listRuns,
	readLatestAssistant,
	readMetadata,
	removeRunDir,
	runDisplayName,
	isValidRunName,
	type InboxMessage,
	type RunMetadata,
	tmuxSessionExists,
	updateMetadata,
	waitForRunShutdown,
	writeMetadata,
} from "./shared.ts";

const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const extensionPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const agentsDir = join(packageRoot, "pstack/agents");

function fail(message: string): never {
	throw new Error(message);
}

function usage(): never {
	fail(`Usage:
  pstack-subagent spawn [--name <name>] [--agent <name>] [--worktree <ref>]
    [--provider <provider>] [--model <model>] [--thinking <level>]
    [--cwd <dir>] [--tools <names>] [--no-extensions] [--no-skills]
    [--no-prompt-templates] [--no-context-files] (--prompt <text> | --file <path>)...
  pstack-subagent status <handle>
  pstack-subagent rename <handle> <name>
  pstack-subagent send <handle> [--follow-up] <message>
  pstack-subagent wait <handle> [--timeout <seconds>]
  pstack-subagent stop <handle>
  pstack-subagent list`);
}

function valueAfter(args: string[], index: number, option: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) fail(`${option} requires a value`);
	return value;
}

function normalizeRunName(value: string): string {
	const name = value.trim();
	if (!isValidRunName(name)) fail("Subagent name must be a single line of 1 to 64 characters");
	return name;
}

function runDirForHandle(handle: string): string {
	if (!/^[a-z0-9]+$/.test(handle)) fail(`Invalid subagent handle: ${handle}`);
	return join(getRunsDir(), handle);
}

function getRun(handle: string): RunMetadata {
	const metadata = readMetadata(runDirForHandle(handle));
	if (!metadata) fail(`Unknown subagent: ${handle}`);
	return metadata;
}

function generateHandle(): string {
	mkdirSync(getRunsDir(), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 100; attempt++) {
		const handle = randomBytes(3).toString("hex");
		if (!existsSync(runDirForHandle(handle))) return handle;
	}
	fail("Could not allocate a unique subagent handle");
}

/** The body of pstack/agents/<name>.md, without its frontmatter. */
function readAgent(name: string): string {
	if (!/^[a-z0-9-]+$/.test(name)) fail(`Invalid agent name: ${name}`);
	const file = join(agentsDir, `${name}.md`);
	if (!existsSync(file)) fail(`Unknown agent: ${name}. Agents live in ${agentsDir}`);
	return readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

function gitOutput(cwd: string, args: string[]): string {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	if (result.status !== 0) fail(result.stderr.trim() || `git ${args.join(" ")} failed`);
	return result.stdout.trim();
}

function spawnSubagent(args: string[]): void {
	if (process.env.PSTACK_SUBAGENT_RUN_DIR) fail("Nested subagents are disabled");
	let name: string | undefined;
	let agent: string | undefined;
	let worktreeRef: string | undefined;
	let provider = process.env.PI_PROVIDER;
	let model = process.env.PI_MODEL;
	let thinking = process.env.PI_REASONING_LEVEL || "medium";
	const requested: NonNullable<RunMetadata["requested"]> = {};
	let cwd = process.cwd();
	let tools: string | undefined;
	let noExtensions = false;
	let noSkills = false;
	let noPromptTemplates = false;
	let noContextFiles = false;
	const prompts: string[] = [];
	const files: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--name":
				name = normalizeRunName(valueAfter(args, i, arg));
				i++;
				break;
			case "--agent":
				agent = valueAfter(args, i, arg);
				i++;
				break;
			case "--worktree":
				worktreeRef = valueAfter(args, i, arg);
				i++;
				break;
			case "--provider":
				provider = requested.provider = valueAfter(args, i, arg);
				i++;
				break;
			case "--model":
				model = requested.model = valueAfter(args, i, arg);
				i++;
				break;
			case "--thinking":
				thinking = requested.thinking = valueAfter(args, i, arg);
				i++;
				break;
			case "--cwd":
				cwd = resolve(valueAfter(args, i, arg));
				i++;
				break;
			case "--tools":
				tools = valueAfter(args, i, arg);
				i++;
				break;
			case "--no-extensions":
				noExtensions = true;
				break;
			case "--no-skills":
				noSkills = true;
				break;
			case "--no-prompt-templates":
				noPromptTemplates = true;
				break;
			case "--no-context-files":
				noContextFiles = true;
				break;
			case "--prompt":
				prompts.push(valueAfter(args, i, arg));
				i++;
				break;
			case "--file": {
				const file = resolve(valueAfter(args, i, arg));
				if (!existsSync(file)) fail(`File not found: ${file}`);
				files.push(file);
				i++;
				break;
			}
			default:
				fail(`Unknown spawn argument: ${arg}`);
		}
	}

	if (!provider) fail("No provider specified and PI_PROVIDER is not set");
	if (!model) fail("No model specified and PI_MODEL is not set");
	if (!VALID_THINKING_LEVELS.has(thinking)) fail(`Invalid thinking level: ${thinking}`);
	if (tools !== undefined && !tools.split(",").some((name) => name.trim()))
		fail("--tools requires at least one tool name");
	if (prompts.length === 0 && files.length === 0) fail("spawn requires at least one --prompt or --file");
	if (!existsSync(cwd)) fail(`Working directory not found: ${cwd}`);
	const agentPrompt = agent === undefined ? undefined : readAgent(agent);
	const repo = worktreeRef === undefined ? undefined : gitOutput(cwd, ["rev-parse", "--show-toplevel"]);

	const handle = generateHandle();
	const runDir = runDirForHandle(handle);
	const sessionFile = join(runDir, "session.jsonl");
	const tmuxSession = `pstack-subagent-${handle}`;
	mkdirSync(inboxDir(runDir), { recursive: true, mode: 0o700 });
	writeFileSync(sessionFile, "", { mode: 0o600 });

	let worktree: RunMetadata["worktree"];
	if (repo !== undefined && worktreeRef !== undefined) {
		// Inside the repo's git dir the checkout inherits the repo's saved project trust, which an interactive child could
		// not grant itself, and git status ignores it.
		const gitDir = resolve(repo, gitOutput(repo, ["rev-parse", "--git-common-dir"]));
		worktree = { repo, path: join(gitDir, "pstack-worktrees", handle), branch: `pstack-subagent/${handle}` };
		try {
			gitOutput(repo, ["worktree", "add", "-b", worktree.branch, worktree.path, worktreeRef]);
		} catch (error) {
			removeRunDir(runDir);
			throw error;
		}
		cwd = worktree.path;
	}

	const launchArgs: string[] = [];
	if (agentPrompt !== undefined) {
		const agentFile = join(runDir, "agent.md");
		writeFileSync(agentFile, `${agentPrompt}\n`, { mode: 0o600 });
		launchArgs.push("--append-system-prompt", agentFile);
	}
	if (tools) launchArgs.push("--tools", tools);
	// A project-local install is a path relative to the project, so a child in a worktree or another --cwd would lose the
	// bridge that wait depends on. Pi loads a package given twice only once.
	if (noExtensions) launchArgs.push("--no-extensions", "--extension", extensionPath);
	else launchArgs.push("--extension", packageRoot);
	if (noSkills) launchArgs.push("--no-skills");
	if (noPromptTemplates) launchArgs.push("--no-prompt-templates");
	if (noContextFiles) launchArgs.push("--no-context-files");

	const now = new Date().toISOString();
	const metadata: RunMetadata = {
		version: 1,
		handle,
		name,
		agent,
		requested,
		worktree,
		parentSessionId: process.env.PI_SESSION_ID || undefined,
		parentSessionFile: process.env.PI_SESSION_FILE || undefined,
		tmuxSession,
		runDir,
		sessionFile,
		cwd,
		provider,
		model,
		thinking,
		launchArgs,
		state: "starting",
		hasStarted: false,
		createdAt: now,
		updatedAt: now,
	};
	writeMetadata(metadata);

	const initialArgs = files.map((file) => `@${file}`);
	if (prompts.length > 0) {
		// tmux refuses long command lines, so the brief travels as a file Pi inlines into the first turn.
		const taskFile = join(runDir, "task.md");
		writeFileSync(taskFile, `Task:\n${prompts.join("\n\n")}\n`, { mode: 0o600 });
		initialArgs.push(`@${taskFile}`);
	}
	try {
		launchRun(metadata, initialArgs);
	} catch (error) {
		discardRun(metadata);
		throw error;
	}

	const worktreeLine = worktree ? `Worktree: ${worktree.path} on branch ${worktree.branch}\n` : "";
	const source = requested.model ? "requested" : "inherited from the session, not chosen with --model";
	process.stdout.write(
		`Spawned ${runDisplayName(metadata)}\nState: busy\nModel: ${provider}/${model} ${thinking}, ${source}\n${worktreeLine}Attach: tmux attach -t ${tmuxSession}\n`,
	);
}

function statusSubagent(args: string[]): void {
	if (args.length !== 1) usage();
	const metadata = getRun(args[0]);
	process.stdout.write(
		`${runDisplayName(metadata)}: ${effectiveRunState(metadata)} (${metadata.provider}/${metadata.model}, ${metadata.thinking})\nAttach: tmux attach -t ${metadata.tmuxSession}\n`,
	);
}

function renameSubagent(args: string[]): void {
	if (args.length !== 2) usage();
	const metadata = getRun(args[0]);
	const name = normalizeRunName(args[1]);
	const updated = updateMetadata(metadata.runDir, { name });
	if (!updated) fail(`Could not rename subagent: ${metadata.handle}`);
	process.stdout.write(`Renamed ${runDisplayName(updated)}\n`);
}

function sendSubagent(args: string[]): void {
	const handle = args.shift();
	if (!handle) usage();
	let followUp = false;
	const messageParts: string[] = [];
	for (const arg of args) {
		if (arg === "--follow-up") followUp = true;
		else if (arg.startsWith("--")) fail(`Unknown send argument: ${arg}`);
		else messageParts.push(arg);
	}
	const message = messageParts.join(" ").trim();
	if (!message) fail("send requires a message");
	const metadata = getRun(handle);
	if (!tmuxSessionExists(metadata.tmuxSession)) fail(`${handle} is not running`);

	const queueDir = inboxDir(metadata.runDir);
	mkdirSync(queueDir, { recursive: true, mode: 0o700 });
	const id = `${Date.now()}-${randomBytes(4).toString("hex")}`;
	const target = join(queueDir, `${id}.json`);
	const temporary = `${target}.tmp`;
	const payload: InboxMessage = { message, delivery: followUp ? "followUp" : "auto" };
	writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, target);

	const state = effectiveRunState(metadata);
	const verb = followUp && state === "busy" ? "Queued follow-up for" : state === "idle" ? "Prompted" : "Steered";
	process.stdout.write(`${verb} ${runDisplayName(metadata)}\n`);
}

function parseTimeout(args: string[]): number {
	if (args.length === 0) return 1800;
	if (args.length !== 2 || args[0] !== "--timeout") usage();
	const timeout = Number(args[1]);
	if (!Number.isInteger(timeout) || timeout <= 0) fail("--timeout must be a positive integer");
	return timeout;
}

async function waitSubagent(args: string[]): Promise<void> {
	const handle = args.shift();
	if (!handle) usage();
	const timeoutSeconds = parseTimeout(args);
	const deadline = Date.now() + timeoutSeconds * 1000;

	while (Date.now() < deadline) {
		const metadata = getRun(handle);
		const pending = existsSync(inboxDir(metadata.runDir))
			? readdirSync(inboxDir(metadata.runDir)).some((file) => file.endsWith(".json"))
			: false;
		const state = effectiveRunState(metadata);
		if (state === "error") fail(metadata.error || `${handle} failed`);
		if (state === "exited") fail(`${handle} exited before finishing`);
		if (metadata.hasStarted && state === "idle" && !pending) {
			const message = readLatestAssistant(metadata.sessionFile);
			if (!message) fail(`${handle} finished without an assistant response`);
			process.stdout.write(`${handle} finished\n\n${assistantText(message)}\n`);
			if (message.stopReason === "error" || message.stopReason === "aborted") process.exitCode = 1;
			return;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
	}
	fail(`Timed out after ${timeoutSeconds}s waiting for ${handle}`);
}

async function stopSubagent(args: string[]): Promise<void> {
	if (args.length !== 1) usage();
	const metadata = getRun(args[0]);
	const wasRunning = tmuxSessionExists(metadata.tmuxSession);
	spawnSync("tmux", ["kill-session", "-t", metadata.tmuxSession], { stdio: "ignore" });
	if (wasRunning) await waitForRunShutdown(metadata.runDir);
	discardRun(metadata);
	const kept = metadata.worktree ? `, kept branch ${metadata.worktree.branch}` : "";
	process.stdout.write(`Stopped ${runDisplayName(metadata)}${kept}\n`);
}

function listSubagents(args: string[]): void {
	if (args.length !== 0) usage();
	const runs = listRuns(process.env.PI_SESSION_ID || undefined);
	if (runs.length === 0) {
		process.stdout.write("No subagents\n");
		return;
	}
	for (const metadata of runs) {
		process.stdout.write(
			`${runDisplayName(metadata)}  ${effectiveRunState(metadata).padEnd(8)}  ${metadata.agent ?? "-"}  ${metadata.provider}/${metadata.model}  ${metadata.thinking}\n`,
		);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args.shift();
	switch (command) {
		case "spawn":
			spawnSubagent(args);
			break;
		case "status":
			statusSubagent(args);
			break;
		case "rename":
			renameSubagent(args);
			break;
		case "send":
			sendSubagent(args);
			break;
		case "wait":
			await waitSubagent(args);
			break;
		case "stop":
			await stopSubagent(args);
			break;
		case "list":
			listSubagents(args);
			break;
		default:
			usage();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
