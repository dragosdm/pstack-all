# my take on runing pstack on multiple harnesses

Goal: run pstack unchanged on Cursor, Claude Code, Grok, pi and opencode.

## Layout

- `pstack/` is a verbatim copy of upstream pstack. See `base/pstack.lock` for the repo, commit, and tree hash.
- `base/` records the base: the upstream lock, the upstream file listing, and the test baseline.
- `scripts/check-base.sh` is the check that the base is intact.
- Harness support lives outside `pstack/`.

## What must stay unchanged

- Every file under `pstack/`, byte for byte and mode for mode, equals upstream `eb4db2b:pstack` (tree `d08bf3a`).
- Skill behavior. pstack's own suites keep the counts in `base/test-baseline.tsv`.
- Repo-relative paths. Playbooks reference `pstack/skills/...` from the repo root, so `pstack/` stays at the root.

Updating the base is a deliberate step. Copy the new upstream tree, rewrite `base/pstack.lock` and `base/pstack.ls-tree`, then run `scripts/check-base.sh --record`.

## Check

```
PSTACK_UPSTREAM_DIR=<cursor/plugins clone> scripts/check-base.sh
```

Without `PSTACK_UPSTREAM_DIR` the lock is trusted as written. Needs `git`, `bun`, `node`, and `column`. The baseline was recorded with bun 1.3.10 and node v26.8.2. The 31 statechart tests that need TLC are skipped without Java and `TLA2TOOLS`. `.audit/base-selftest.txt` shows the check failing on four deliberate breaks.
