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
scripts/check-base.sh
```

Needs `git`, `bun`, and `node`. The 31 statechart tests that need TLC are skipped without Java and `TLA2TOOLS`.
