# Grok Bot

Last verified 2026-10-22 against `cursor/plugins` at `eb4db2b`.

## Entry file

Grok Bot reads the same catalog as Cursor, `.cursor-plugin/marketplace.json`. See [Cursor](cursor.md).

## Visibility

A catalog entry hides itself from a client with `minClientVersions`. Upstream's schema names the client ids `cursor`, `grokbot`, and `sand`. The schema marks `sand` as a deprecated id for Grok Bot. A value of `"never"` hides the plugin from that client.

The `pstack` entry upstream has no `minClientVersions`, so Grok Bot lists it. The entry in this repo has none either.

## Check

`scripts/check-catalog.sh` fails unless the catalog has exactly one `pstack` entry and that entry has no `minClientVersions`.

## Not verified

- Whether Grok Bot can add a marketplace other than `cursor/plugins`. Nothing in the upstream repository or the local tools shows how.
- A Grok Bot install of this repository.
