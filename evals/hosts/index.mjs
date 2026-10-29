import { claude } from "./claude.mjs";
import { cursor } from "./cursor.mjs";
import { grokHost } from "./grok.mjs";
import { opencode } from "./opencode.mjs";
import { pi } from "./pi.mjs";

export const HOSTS = { claude, pi, cursor, grok: grokHost, opencode };
