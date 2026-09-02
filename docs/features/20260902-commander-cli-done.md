---
name: commander-cli
description: replace the hand-rolled dispatch() router with commander.js as the sole CLI router, extracting dispatch()'s switch into command handlers; keeps jiraFedrunek as the only bin (no rename, no second bin), adds aliases, and a --json mode with a hard stdout/stderr contract
metadata:
  type: done
  status: done — implemented in src/cli.js/src/router.js/src/index.js, see docs/development.md#cli-routing-commanderjs
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/development.md#cli-routing-commanderjs, docs/architecture.md
---

# Commander.js CLI router (done)

**Implementation note (2026-09-02):** shipped materially as designed below, with
one refinement past this proposal's original text — `--json` doesn't just
re-serialize each `dispatch()`-shaped result as-is, it wraps every command's
output in a uniform `{ ok: true, command, data }` / `{ ok: false, command, error:
{ code, message } }` envelope (a failing command under `--json` now emits that
envelope to `stdout` instead of throwing, `process.exitCode` set to `1`), and the
stdout/stderr redirect is implemented as a temporary `console.log`→`console.error`
reassignment in `router.js`'s `withJsonRedirect()`, not a `step()` logger
abstraction (no such abstraction was introduced — every module's existing raw
`console.log` calls are unaffected). See
[docs/development.md — CLI routing (commander.js)](../development.md#cli-routing-commanderjs)
for the authoritative, current description; treat the rest of this document as
the historical design record.

## Executive summary

Replace `node src/index.js <command>` with an executable CLI powered by
`commander.js`: short aliases (`jiraFedrunek cf s` vs. `confluence sync`), a
real `bin` entry so global/local installs resolve without `node src/...`
path noise, and a `--json` flag that emits exactly one JSON document on
`stdout` for CI/CD and LLM/agent callers that currently have to scrape the
step-logged `console.log` output documented in
`docs/development.md#coding-style`.

**Revision note (2026-09-02):** an earlier draft of this proposal renamed
the binary to `jfed`/`jira-fedrunek`, which contradicted the standing
`CLAUDE.md` naming rule, and left `dispatch()`'s `switch` in place under a
Commander adapter (double routing). Both are resolved below, per external
review — see "Decisions" and "Architecture" sections.

## Decisions

1. **Do not rename the binary, and no second `jfed` bin either.** `jiraFedrunek`
   is the only `bin` entry; `package.json`'s `name` stays `jirafedrunek`. The
   naming conflict this proposal originally raised against `CLAUDE.md` is
   resolved by not introducing any alternate binary name at all — aliases
   live inside Commander's command tree, not in the binary name:
   ```json
   "bin": { "jiraFedrunek": "src/index.js" }
   ```
2. **Commander is the sole router.** `dispatch()`'s `switch` in `src/cli.js`
   is not kept as a second routing layer underneath Commander — see
   "Architecture" for what happens to its logic instead.
3. **`--json` emits exactly one JSON document to `stdout`, never a stream.**
   "Streams a plain payload" in the original draft was imprecise — this is a
   single serialized result per invocation (`{ status, results: [...] }`
   shape, matching what `dispatch()` already returns), not NDJSON/JSON Lines.
   Incremental/streaming output for long-running syncs is out of scope here;
   if ever wanted, it's a distinct opt-in protocol, not an extension of
   `--json`.
4. **`sync`/`s` and `cf sync`/`cf s` are not a collision.** Commander scopes
   subcommand aliases to their parent (`cf s` only resolves under `cf`), so
   both the top-level `s` and `cf`'s `s` coexist unambiguously. Keep both;
   nothing to disambiguate.

## Architecture

```text
CLI entry (src/index.js)
   │
   ├─ parse argv (Commander: command tree, aliases, --json, --yes)
   ├─ create dependencies (JiraClient/ConfluenceClient/SyncState/...)
   ├─ connect McpSession (if the selected command needs it)
   ├─ execute the selected command handler
   ├─ serialize result (human trace, or --json → one JSON document)
   └─ finally: close McpSession, regardless of success/failure
```

`dispatch()`'s `switch` in `src/cli.js` does not survive as a second router
underneath Commander's command tree — that would leave two routing layers
(`Commander → dispatch() → switch → operation`) for no benefit once
Commander owns the command tree. Instead, extract each `switch` case's body
into its own named command-handler function (one per verb: `loginCommand`,
`trackCommand`, `syncCommand`, `confluencePageCommand`, etc.), and wire
Commander's `.action()` directly to that handler:

```js
program
  .command('sync [keys...]')
  .alias('s')
  .action(async (keys, options) => run(syncCommand, { keys, ...options }));
```

`run()` is the one lifecycle wrapper — connect, execute, serialize, and
`finally`-close — shared by every command, so cleanup-on-failure is
guaranteed in exactly one place instead of duplicated per handler or
re-derived from `src/index.js:158-191`'s current connect-then-dispatch-close
lifecycle.

**Output boundary — stdout/stderr is a hard contract, not per-method
awareness:**

```text
Human mode:  stdout → human result + existing step-logs
             stderr → (unused)

JSON mode:   stdout → exactly one JSON document, nothing else
             stderr → existing step-logs (diagnostics), unchanged
```

No underlying method (`JiraClient`, `SyncEngine`, etc.) becomes aware of
`--json` — that would leak a presentation concern into the application
layer. Only the CLI boundary (`run()`'s serialize step, and the existing
`step()` logger from `docs/development.md#coding-style`) needs to know
whether `--json` was passed, by redirecting `step()`'s writes to `stderr`
when it's on. `console.log`'s existing step-logging convention doesn't stop
under `--json` — it moves to `stderr`, so `2> debug.log` still gives a full
trace while `1> result.json` stays parseable.

## Current state (verified against the repo, 2026-09-02)

- `src/index.js` is a thin entry point: parses `.env`, builds dependencies,
  connects `McpSession` if needed, and calls `dispatch(command, args, deps)`
  from `src/cli.js`. Per "Architecture" above, `dispatch()`'s switch cases
  become individual exported command handlers that Commander's `.action()`
  calls directly — not a second layer kept for compatibility.
- Existing verbs (`src/cli.js`) already match this proposal's structure:
  `login`, `track <key>`, `sync [keys...]`, and `confluence <verb>` where
  verb is one of `page <id>`, `dir <id>`, `dirs`, `pages`, `sync`. No verbs
  need inventing, only re-routing into handlers per "Architecture."
- No CLI argument-parsing library is currently a dependency —
  `commander` would be new. Current dispatch does no flag parsing at all
  beyond a manual `args.includes('--yes')` check in `src/index.js:173`.
- Every non-trivial method in this codebase logs one `console.log` per
  step (`docs/development.md#coding-style`) — under `--json` these move to
  `stderr` (see "Architecture"), they are never suppressed.

## Key technical objectives

- **Token reduction:** alias routing shortens command invocations for
  automated/agent callers (`jiraFedrunek cf s` vs. the current
  `confluence sync`).
- **Binary distribution:** a real `bin` entry for global/local resolution,
  replacing `node src/index.js`. `jiraFedrunek` is the only binary (see
  "Decisions" #1) — no alternate/short binary name.
- **Deterministic output:** a `--json` flag that emits exactly one JSON
  document to `stdout`, diagnostics unconditionally on `stderr`, for
  script/LLM consumers.

## Proposed command structure

Full verb names are never removed — aliases are additive shortcuts, modeled
as Commander subcommand aliases, not as a flat alias list. `cf`'s own
sub-aliases are scoped under it (a hierarchy, not independent alias
strings):

```text
jiraFedrunek
 ├── login        (l)
 ├── track <key>  (t)
 ├── sync [keys]  (s)
 └── cf           (alias for `confluence`)
      ├── page <id>  (p)
      ├── dir <id>   (d)
      ├── dirs       (ds)
      ├── pages      (ps)
      └── sync       (s)   — scoped under cf, no collision with top-level `s`
```

| Legacy invocation | Proposed command | Alias |
| --- | --- | --- |
| `node src/index.js login` | `jiraFedrunek login` | `l` |
| `node src/index.js track <key>` | `jiraFedrunek track <key>` | `t` |
| `node src/index.js sync [keys...]` | `jiraFedrunek sync [keys...]` | `s` |
| `node src/index.js confluence page <id>` | `jiraFedrunek cf page <id>` | `cf p` |
| `node src/index.js confluence dir <id>` | `jiraFedrunek cf dir <id>` | `cf d` |
| `node src/index.js confluence dirs` | `jiraFedrunek cf dirs` | `cf ds` |
| `node src/index.js confluence pages` | `jiraFedrunek cf pages` | `cf ps` |
| `node src/index.js confluence sync` | `jiraFedrunek cf sync` | `cf s` |

## Machine-readable mode (`--json`)

A global `--json` flag switches the CLI boundary's serialize step (see
"Architecture") to emit exactly one JSON document to `stdout` — matching
what each command handler already returns (e.g.
`{ status: 'synced', results: [...] }`), instead of the human-readable
step-log trace. Step-logs move to `stderr`, never suppressed.

**Canonical placement:** support `--json` both before and after the
subcommand —

```bash
jiraFedrunek --json cf page 100000001
jiraFedrunek cf page 100000001 --json
```

— by declaring it once on the root `program` with Commander's option
inheritance (`.option()` on `program`, not redeclared per subcommand), so
every nested command sees it regardless of position. Document both forms
work; treat `jiraFedrunek <command> --json` (option after the command) as
the canonical form shown in docs/help text, since that reads left-to-right
as "command, then how to format it."

```bash
jiraFedrunek cf page 100000001 --json
```

Usage in scripts:

```bash
result=$(jiraFedrunek sync --json 2>debug.log)
jq empty <<< "$result"   # exactly one valid JSON document, no log lines mixed in
```

## Scope

- New dependency: `commander`
- `src/cli.js` — extract each `dispatch()` switch case into its own exported
  command-handler function (one per verb); `dispatch()` itself is removed
  once nothing calls it
- `src/index.js` (or a new `src/router.js`) — Commander program + command
  tree per the table above, `.action()` wired directly to the extracted
  handlers via the one shared `run()` lifecycle wrapper (connect → execute →
  serialize → `finally`-close)
- `package.json` — `bin.jiraFedrunek` unchanged, no other `bin` entries added
- `docs/development.md` — document the new invocation form, the `--json`
  stdout/stderr contract, and that `dispatch()` no longer exists
  post-migration

## Out of scope (this pass)

- Shell completion scripts
- Interactive/TTY-only affordances beyond the existing
  `confirmPrompt`/`--yes` bulk-confirm flow in `src/index.js`
- NDJSON/streaming output (see "Decisions" #3) — `--json` is one document

## Acceptance

- `npm run lint`, `npm run format:check`, `npm test` all pass
- Every command in the table above is reachable both by its full name and
  its alias, verified by a CLI-level test per command, asserting
  **full command and alias produce identical results for identical
  arguments** (not just "both are reachable")
- `--json` mode, for every command:
  - `stdout` is exactly one JSON document — `jq empty <<< "$result"` succeeds
  - `stdout` contains **no** step-log lines (stdout purity)
  - `stderr` still contains the full step-log diagnostic trace
  - both `jiraFedrunek --json <cmd>` and `jiraFedrunek <cmd> --json`
    placements work identically
- Exit codes:
  - non-zero exit on command failure
  - non-zero exit on unknown command
  - non-zero exit on unknown option
- Resource lifecycle: `McpSession` closes on both success and failure paths
  (test by forcing a handler to throw and asserting `close()` still ran)
- `--yes` bulk-confirm flow remains functional, unchanged behavior
- `docs/development.md` and `README.md` updated with the new invocation
  form and the `--json` contract
