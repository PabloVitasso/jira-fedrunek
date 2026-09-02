---
name: typescript-migration
description: evaluate migrating jiraFedrunek from plain JS to TypeScript — no blocker found that rules it out, but the payoff is narrower than usual since the data this project most needs typed (MCP tool JSON responses) is validated at a runtime boundary anyway, not at compile time
metadata:
  type: proposal
  status: rejected
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/development.md#coding-style, docs/architecture.md
---

# Evaluate migrating from JS to TypeScript (proposal)

## Why this doc exists

Asked directly: why is this project plain JS rather than modern TS? There is no
prior decision recorded anywhere in `CLAUDE.md`, `docs/`, or git history that
rejects TypeScript — the honest answer is "never adopted," not "ruled out."
This proposal exists to make that gap explicit and lay out what adopting it
would actually cost, rather than leaving it as an unexamined default.

## Current state (verified against the repo, 2026-09-02)

- `package.json`: `"type": "module"`, `"engines": { "node": ">=20.0.0" }`,
  `"bin": { "jiraFedrunek": "src/index.js" }` — the bin entry runs the source
  file directly with `node`, no build step anywhere in `scripts`.
- No `tsconfig.json`, no `@types/*`, no `ts-node`/`tsx`/`esbuild` — TS was
  never partially adopted and abandoned.
- `eslint.config.js` (added this session) is flat-config JS-only; no
  `@typescript-eslint` parser/plugin.
- 17 source files, all plain ESM `.js`, constructor-injected (no framework),
  tested via `node --test` with hand-written fakes (`docs/development.md#adding-a-new-module`).
- The single biggest data-shape risk in the codebase is untyped external
  input: `McpSession.callTool()` returns MCP tool results that
  `JiraClient`/`ConfluenceClient` parse via `JSON.parse(textOf(result))`
  with no schema — see `docs/atlassian-mcp-reference.md`, which explicitly
  flags several response-shape details as "not independently verified."
  This session's coding-style additions (`docs/development.md#coding-style`
  — early-exit, extract-and-check untrusted data, no boolean flag params)
  exist specifically to harden against that same untyped-boundary risk at
  runtime.

## What TS would actually buy here

- Compile-time shape checking for internal function signatures (e.g. the
  `{ folderId, total, fetched, failed, skipped }` stats objects threaded
  through `ConfluenceSyncEngine`) — real value, catches typos/renames across
  files that `eslint`'s `no-unused-vars` can't.
- **Does not** validate `McpSession.callTool()` responses — those are
  `JSON.parse`d strings from an external MCP server at runtime; a
  `type ConfluencePage = { version: { createdAt: string } }` annotation
  describes an assumption, it doesn't check it. The project would still need
  the same extract-and-check-and-log discipline this session added by hand
  (`spaceKeyFromWebui`, the `createdAt`/`title` extractions in
  `ConfluenceSyncEngine`) — a runtime schema validator (e.g. `zod`) at the
  `McpSession` boundary would close that gap, but that's a separate proposal
  from "switch the language," and pulls in a new runtime dependency subject
  to `docs/development.md#dependency-pinning`.
- Editor/IDE autocomplete and refactor-safety — real but not repo-verifiable
  from static analysis of this repo.

## Migration shape, if adopted

1. `tsconfig.json` targeting `NodeNext`/ESM, `strict: true`.
2. Rename `.js` → `.ts` under `src/`, add types incrementally starting from
   the outermost boundary (`McpSession`) inward, since that's where the
   untyped-data risk this session focused on actually lives.
3. Decide the run/build story for the `bin` entry (see Open issues #1 below)
   — this is the one decision that has to be made before any file is renamed,
   since it changes how `npm run start`/the published `bin` command work.
4. `eslint.config.js` gains `@typescript-eslint` parser + plugin; the
   `max-lines-per-function` rule added this session (`docs/development.md#coding-style`)
   carries over unchanged — it's not TS-specific.
5. `tests/node/*.test.js` — `node --test` needs `.ts` support (same
   run/build decision as #1) or tests stay `.js` importing typed `.ts`
   source, which `NodeNext` module resolution supports directly.

## Open issues (would block adoption until resolved)

1. **No build step exists today, and the `bin` entry runs source directly.**
   TS needs one of: (a) `tsc` compiling to a `dist/` the `bin` field points
   at instead of `src/index.js` — adds a build step to every install/release
   path that doesn't exist today; (b) Node's native type-stripping
   (`--experimental-strip-types`, unflagged from Node 23.6) — but
   `package.json` currently declares `"engines": { "node": ">=20.0.0" }`,
   so relying on it means either bumping the minimum supported Node version
   past what's declared today, or shipping a `--experimental-strip-types`
   flag users must pass manually; (c) a runtime loader (`tsx`) — a new
   runtime dependency for every user of the CLI, not just contributors,
   which is a materially different trade-off than a devDependency-only tool
   like `eslint`/`prettier`. None of these is a "just do it" choice — needs
   an explicit decision, not an implicit one made mid-migration.
2. **Payoff is concentrated at one boundary, not spread evenly.** As shown
   above, the highest-risk untyped data (MCP responses) isn't fixed by
   adding types alone — it needs runtime validation, which is really a
   separate `zod`-at-the-boundary proposal that would deliver most of the
   safety win on its own, without a language migration. Worth deciding
   whether that narrower fix is sufficient before committing to a full
   TS migration.
3. **No CI pipeline referenced anywhere in `docs/`** to gate a `tsc --noEmit`
   type-check step on — confirm whether one exists (not found in this repo)
   before assuming type errors would actually block a bad merge.
4. Cost is proportional to `docs/development.md#adding-a-new-module`'s
   existing per-module test/DI conventions carrying over cleanly — expected
   to be low-friction since the codebase is already small and
   constructor-injected, but not verified by actually attempting the
   migration in this pass.

## Decision: rejected (2026-09-02)

Given this project's explicit priorities — maximum usability for the
published CLI, no hacks — the migration doesn't clear the bar right now:

- The only way to make `.ts` runnable without a build step is to either add
  one (a hack this project doesn't have today) or raise the Node floor past
  23.6, which breaks `npx jiraFedrunek` for anyone still on current-LTS
  Node 20/22 — a real usability regression for a CLI's actual users, not
  just its contributors.
- Native type-stripping (the non-build-step option) only strips syntax; it
  never runs the type checker. Getting the actual safety benefit still
  requires a separate `tsc --noEmit` gate this repo has no CI to hang it on
  (Open issue #3) — so the "gain" doesn't arrive for free even after paying
  the compatibility cost above.
- The highest-risk data in this codebase (`McpSession.callTool()` responses)
  is untyped at a runtime boundary, not a compile-time one — TS types
  describe an assumption about that data, they don't validate it. The actual
  fix is the extract-and-check/fail-fast style already documented in
  `docs/development.md#coding-style`, which applies with or without TS.

Net: no real engineering gain over plain JS for this project's size and risk
profile, at a real usability cost. Revisit only if a concrete trigger
appears — e.g. a CI pipeline gets added (removing Open issue #3), or the
Node LTS floor naturally moves past 23.6 for unrelated reasons.

## Acceptance (if ever revisited)

- Explicit decision recorded here (or in a successor doc) on the
  run/build story from Open issue #1, before any file is renamed
- `npm run lint`, `npm test`, `npm run format:check` all pass against the
  migrated `.ts` tree using the same commands documented in
  `docs/development.md#linting-and-formatting`
- `docs/development.md` and `docs/architecture.md` updated to reflect the
  new file extensions and (if added) build step
- No behavior change — this is a tooling migration, not a rewrite; existing
  `tests/node/*.test.js` assertions pass unmodified in substance
