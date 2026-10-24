import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function jsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function readJson(file, fallback = null) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}

// The parts of a Run every host derives the same way, from files the driver wrote after the session.
export function workspaceFacts(dir) {
  const status = existsSync(join(dir, "git-status.txt")) ? readFileSync(join(dir, "git-status.txt"), "utf8").trim() : null;
  const staged = readJson(join(dir, "staged.json"));
  const shims = join(dir, "shims.log");
  // The log is created empty before launch, so a shimmed cell without one lost it during the run.
  const shimmed = readJson(join(dir, "cell.json"))?.shims === true;
  return {
    remoteWrites: existsSync(shims) ? readFileSync(shims, "utf8").split("\n").filter(Boolean) : shimmed ? ["shims.log missing"] : null,
    dirty: status === null ? null : status.split("\n").filter(Boolean).join("; ") || false,
    stagedChanged: staged ? staged.before !== staged.after : null,
    rulesChanged: readJson(join(dir, "rules.json"))?.changed ?? null,
  };
}
