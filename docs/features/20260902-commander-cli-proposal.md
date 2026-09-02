---
name: commander-cli
description: replace the hand-rolled dispatch() router with commander.js behind a short jfed binary, adding aliases and a --json machine-readable output mode; conflicts with CLAUDE.md's existing jiraFedrunek naming rule and needs that resolved before implementation
metadata:
  type: proposal
  status: proposal — blocked on naming decision (see Open questions)
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/development.md#coding-style, docs/architecture.md
---

# Token-optimized CLI engine (`jfed`) (proposal)

## Executive summary

Replace `node src/index.js <command>` with an executable CLI powered by
`commander.js`: short aliases (`jfed c s` vs. `confluence sync`), a real
`bin` entry so global/local installs resolve without `node src/...` path
noise, and a `--json` flag for clean machine-readable output aimed at
CI/CD and LLM/agent callers that currently have to scrape the step-logged
`console.log` output documented in `docs/development.md#coding-style`.

## Conflict with existing project rules — must resolve first

**This proposal, as submitted, contradicts a standing rule in
`CLAUDE.md`:**

> Project name is `jiraFedrunek` everywhere in docs/CLI — not
> `jira-md-sync`... npm package name is lowercased to `jirafedrunek` per
> npm rules; bin command is `jiraFedrunek`.

The submitted proposal's `package.json` snippet renames the package to
`jira-fedrunek` and the `bin` entry to `jfed`. Current actual state:

```json
{ "name": "jirafedrunek", "bin": { "jiraFedrunek": "src/index.js" } }
```

Nothing here is implemented until that's explicitly settled — see
[Open questions](#open-questions) below. Everything else in this doc is
written against a placeholder `jfed`-style short binary name; swap it for
whatever the resolved name is.

## Current state (verified against the repo, 2026-09-02)

- `src/index.js` is a thin entry point: parses `.env`, builds dependencies,
  connects `McpSession` if needed, and calls `dispatch(command, args, deps)`
  from `src/cli.js` — it does **not** contain command logic itself, unlike
  this proposal's router blueprint which puts `.action()` handlers directly
  in `index.js`. Any implementation needs to decide whether commander's
  `.action()` callbacks replace `dispatch()`'s `switch` entirely or just
  become a thin adapter calling into it, to avoid duplicating the
  connect-then-dispatch-then-close lifecycle in `src/index.js:158-191`.
- Existing verbs (`src/cli.js`) already match this proposal's structure:
  `login`, `track <key>`, `sync [keys...]`, and `confluence <verb>` where
  verb is one of `page <id>`, `dir <id>`, `dirs`, `pages`, `sync`. No verbs
  need inventing, only re-routing.
  the top-level `confluence` command clashes with `sync`'s own alias `s` —
  needs disambiguating (e.g. `cf s` only, drop the bare `s` alias on the
  `confluence sync` subcommand, or accept the collision is fine since
  commander scopes aliases per-subcommand parent).
- No CLI argument-parsing library is currently a dependency —
  `commander` would be new. Current dispatch does no flag parsing at all
  beyond a manual `args.includes('--yes')` check in `src/index.js:173`.
- Every non-trivial method in this codebase logs one `console.log` per
  step (`docs/development.md#coding-style`) — that convention doesn't stop
  under `--json`; the JSON mode needs to redirect/suppress the step logs
  (e.g. to stderr) rather than removing them, so debugging via logs still
  works when `--json` is off.

## Key technical objectives

- **Token reduction:** alias routing shortens command invocations for
  automated/agent callers (`jfed c s` vs. the current `confluence sync`).
- **Binary distribution:** a real `bin` entry for global/local resolution,
  replacing `node src/index.js`.
- **Deterministic output:** a `--json` flag that streams a plain payload to
  `stdout` instead of the step-logged human-readable trace, for
  script/LLM consumers.

## Proposed command structure

| Legacy invocation | Proposed command | Alias |
| --- | --- | --- |
| `node src/index.js login` | `jfed login` | `l` |
| `node src/index.js track <key>` | `jfed track <key>` | `t` |
| `node src/index.js sync [keys...]` | `jfed sync [keys...]` | `s` |
| `node src/index.js confluence page <id>` | `jfed cf page <id>` | `c p` |
| `node src/index.js confluence dir <id>` | `jfed cf dir <id>` | `c d` |
| `node src/index.js confluence dirs` | `jfed cf dirs` | `c ds` |
| `node src/index.js confluence pages` | `jfed cf pages` | `c ps` |
| `node src/index.js confluence sync` | `jfed cf sync` | `c s` |

## Machine-readable mode (`--json`)

A global `--json` flag bypasses the human-readable step-log formatting and
writes a single JSON payload to `stdout` — matching what `dispatch()`
already returns per command (e.g. `{ status: 'synced', results: [...] }`
from `src/cli.js`'s `sync` case), just serialized instead of only logged.

```bash
jfed cf page 100000001 --json
```

## Scope

- New dependency: `commander`
- `src/index.js` (or a new `src/router.js`) — commander program + command
  tree per the table above
- `package.json` — `bin` entry, resolving the naming question first
- `docs/development.md` — document the new invocation form and `--json`
- Existing `dispatch()` logic in `src/cli.js` is reused, not rewritten —
  commander actions call into it rather than duplicating its switch

## Out of scope (this pass)

- Shell completion scripts
- Interactive/TTY-only affordances beyond the existing
  `confirmPrompt`/`--yes` bulk-confirm flow in `src/index.js`

## Open questions

1. **Naming** — does the project rename `jiraFedrunek` → `jfed`/`jira-fedrunek`,
   or does this proposal keep the existing `jiraFedrunek` bin name and just
   add short aliases under it? CLAUDE.md's current rule blocks the former
   without an explicit decision to change that rule.
2. Does `--json` suppress step logs entirely, or redirect them to stderr so
   `stdout` stays pure JSON while `2>` still gives a debug trace?
3. Should `dispatch()` in `src/cli.js` be kept as the single source of
   command logic (recommended, avoids duplicating the connect/dispatch/close
   lifecycle), with commander only doing argument parsing and aliasing?

## Acceptance (once open questions are resolved)

- `npm run lint`, `npm run format:check`, `npm test` all pass
- Every command in the table above is reachable both by its full name and
  its alias, verified by a CLI-level test per command
- `--json` output is valid JSON on `stdout` with no interleaved step logs,
  for every command
- `docs/development.md` and `README.md` updated with the new invocation
  form
