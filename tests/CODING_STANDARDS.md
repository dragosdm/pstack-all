# Test coding standards

Criteria for `tests/**`, on top of the root `CODING_STANDARDS.md`. The suite is the `bun run test` lane. `AGENTS.md` "Where each check belongs" says which checks go here and which go in a `scripts/check.sh` layer or an eval cell.

## Suite mechanics

- Tests are `bun:test` files named `tests/*.test.ts`. `bun run test` runs `bun test ./tests`. The `./tests` path keeps bun out of the suites under `pstack/`, which `scripts/check-base.sh` runs and counts.
- The suite runs in one bun process with no harness binary, login or network. A test never runs `claude`, `grok`, `pi`, `opencode` or `cursor-agent`. It may run `node` on a script in this repo, or `git` on a throwaway repo.
- A test drives the module its harness loads through the interface that harness uses, with a mock in place of the harness. `tests/opencode-plugin.test.ts` imports `index.js` and calls `setup` with a mock `ctx`. `tests/pi-extension.test.ts` imports `.pi/extensions/pstack.ts` and passes a mock `pi`.
- No test depends on another test's state or order. Each test builds its own fixture, such as a fresh mock `pi` or a fresh sealed cell, and process-wide state is reset in `beforeEach`. `tests/pi-extension.test.ts` clears the extension's `globalThis` mark before each test.
- A file that runs subprocesses sets a file-level `setDefaultTimeout`, as `tests/manifests.test.ts` does.

## Isolation

- A test writes only inside its own `mkdtempSync` folder under the OS temp dir, and removes it when done, as `tests/manifests.test.ts` does in `afterAll`. It never writes this checkout. To change repo files, copy them into the temp folder first, as `copyRepo` in `tests/manifests.test.ts` copies `git ls-files`.
- A test never reads or writes the user's home config, such as `~/.claude`, `~/.pi/agent` or `~/.config/opencode`.
- A child process gets only the environment it needs. `tests/manifests.test.ts` passes only `PATH`. A test of remote-write safety also strips credentials, as `withoutCredentials` in `evals/shims.mjs` does.
- A fixture repo sets the commit identity on the command line, as `tests/evals.test.ts` does with `-c user.email=... -c user.name=...`.

## Guards that can fail

- Each test is shown failing before it lands. Break the code it guards with a one-line change, run the test, watch it fail, and say so in the commit or the decision row. The first 16 unit tests were checked against 22 one-line mutations, and each new eval test was shown failing under its own break (`decisions.tsv`, 2026-10-24T06:19:37Z and 2026-10-24T06:35:03Z).
- For a test that guards a contract a reviewer is likely to break again, also add a `run "<name>" unit "<break>"` line to `scripts/selftest-check.sh`.
- Expected values come from the requirement or from an independent parse of the source files, never from the output of the code under test. `tests/pi-extension.test.ts` reads each skill's description with `Bun.YAML.parse`, while the extension has its own frontmatter parser. A golden case's `expected.json` is written from the requirement, not from the run (`evals/README.md`).
- Assert what the harness observes: the commands registered, the message sent with its options, the lines added to the system prompt. Do not assert private state that the harness never sees.
- A needle matches only the thing it pins. It must not also match the prompt, a negation or the text next to it.

## Eval tests

- A test of the graders regrades a sealed copy of a golden cell, with no model call. `sealedCell` in `tests/evals.test.ts` copies `evals/golden/claude-how-simple/`, edits it and seals it again.
- A grade for a write or a decision checks an artifact the model cannot write: the shim log, the git state, or the harness's own records. A model's narration alone never passes a grade.
- A missing artifact never grades as a pass. A shimmed cell that lost `shims.log` fails `noRemoteWrites`, and a cell sealed without shims grades it `n/a`.
