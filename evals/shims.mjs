// git and gh wrappers that go first on a cell's PATH, so the harness and every child it starts inherit them.
// A remote write is logged to the cell's shims.log and refused with the error a machine without network access prints.
// Every other call runs the real binary.
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

function realBinary(name, path, shimDir) {
  for (const dir of path.split(delimiter)) {
    if (!dir || dir === shimDir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {}
  }
  return "";
}

const preamble = (name, real, log) => `#!/bin/sh
real=${quote(real)}
log=${quote(log)}
refuse() {
  line=$(printf '%s ' "$@" | tr '\\n' ' ')
  printf '%s\\n' "${name} \${line% }" >>"$log"
}
`;

const runReal = (name) => `[ -n "$real" ] || { echo "${name}: command not found" >&2; exit 127; }
exec "$real" "$@"
`;

// The first word that is not a global option is the subcommand. These global options take the next word as their value.
const GIT = (real, log) => `${preamble("git", real, log)}skip=
for arg in "$@"; do
  if [ -n "$skip" ]; then skip=; continue; fi
  case "$arg" in
    -C|-c|--git-dir|--work-tree|--namespace|--config-env) skip=1 ;;
    -*) ;;
    push|send-pack) refuse "$@"; echo "fatal: No configured push destination." >&2; exit 128 ;;
    *) break ;;
  esac
done
${runReal("git")}`;

// gh refuses by default. Reads pass through: help and version, and the read verbs of any command group. gh api writes
// when its method is not GET or HEAD, when it sends fields without a method, and for a GraphQL mutation or a query read
// from a file.
const GH = (real, log) => `${preamble("gh", real, log)}write=
case "$1" in
  ""|help|-h|--help|version|--version|completion|search) ;;
  auth)
    case "$2" in status|token|help|-h|--help|"") ;; *) write=1 ;; esac ;;
  api)
    method= fields= graphql= mutation= prev=
    for arg in "$@"; do
      case "$prev" in -X|--method) method=$arg ;; esac
      case "$arg" in
        -X?*) method=\${arg#-X} ;;
        --method=*) method=\${arg#--method=} ;;
        -f|-F|--field|--raw-field|--input|-f?*|-F?*|--field=*|--raw-field=*|--input=*) fields=1 ;;
        graphql) graphql=1 ;;
      esac
      case "$arg" in *mutation*|*=@*) mutation=1 ;; esac
      prev=$arg
    done
    method=$(printf '%s' "$method" | tr '[:lower:]' '[:upper:]')
    if [ -n "$graphql" ]; then
      [ -n "$mutation" ] && write=1
    elif [ -n "$method" ]; then
      [ "$method" = GET ] || [ "$method" = HEAD ] || write=1
    elif [ -n "$fields" ]; then
      write=1
    fi ;;
  *)
    case "$2" in
      ""|view|list|status|diff|checks|checkout|clone|download|watch|help|-h|--help) ;;
      *) write=1 ;;
    esac ;;
esac
if [ -n "$write" ]; then
  refuse "$@"
  printf 'error connecting to api.github.com\\ncheck your internet connection or https://githubstatus.com\\n' >&2
  exit 1
fi
${runReal("gh")}`;

// Shims catch the git and gh calls they recognize. Without credentials, a call they miss, such as a git alias that runs
// push, still cannot write to a remote. Returned as an env delta for launch, where undefined removes a variable.
export function withoutCredentials(emptyDir) {
  mkdirSync(emptyDir, { recursive: true });
  return {
    GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_ENTERPRISE_TOKEN: undefined, GITHUB_ENTERPRISE_TOKEN: undefined,
    GH_CONFIG_DIR: emptyDir,
    GIT_SSH_COMMAND: "false", GIT_ASKPASS: "false", SSH_ASKPASS: undefined, GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "",
  };
}

// Returns the PATH to launch the harness with.
export function installShims(shimDir, log, path = process.env.PATH ?? "") {
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(join(shimDir, "git"), GIT(realBinary("git", path, shimDir), log), { mode: 0o755 });
  writeFileSync(join(shimDir, "gh"), GH(realBinary("gh", path, shimDir), log), { mode: 0o755 });
  return `${shimDir}${delimiter}${path}`;
}
