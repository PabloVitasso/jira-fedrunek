---
name: testing
description: ISTQB-style test plan for jiraFedrunek — test items, suites, cases, and their status
metadata:
  type: reference
  spec_ref: docs/jiraFedrunek-spec-v2.md
---

# Test Plan — TP-JIRAFEDRUNEK-001

## Contents

- [Introduction](#introduction)
- [Test items](#test-items)
- [Features to be tested](#features-to-be-tested)
- [Features not to be tested](#features-not-to-be-tested)
- [Test approach](#test-approach)
- [Naming convention](#naming-convention)
- [Test suites](#test-suites)
- [Pass/fail criteria](#passfail-criteria)
- [Environmental needs](#environmental-needs)

## Introduction

Test plan for jiraFedrunek per [ISTQB](https://www.istqb.org/) terminology (test item /
test suite / test case / entry-exit criteria). Scope is unit-level testing of every
module in [docs/architecture.md — module ownership](./architecture.md#module-ownership),
built test-first per the project's [TDD rule](../CLAUDE.md).

Two audit passes have added cases to existing suites since initial completion:
[test-coverage-gaps](features/20260902-test-coverage-gaps-done.md) (branch/error-path
gaps against source) and
[architecture-audit-findings](features/20260902-architecture-audit-findings-done.md)
(reliability/security fixes, e.g. `TC-SYNC-STATE-007/008`, `TC-MCP-SESSION-009/010`,
`TC-MD-COMMENTPARSER-008`, `TC-CONFLUENCE-SYNC-015/016`, `TC-JIRA-CLIENT-006`,
`TC-FOLDER-WALKER-006`, `TC-PROJECT-CONFIG-005`, `TC-SYNC-TRACKEDKEYS-010`) — no new
suites, all landed within the table below. `timestamp.js`/`webui.js` (extracted during
the second pass) are untested directly, same reasoning as `log.js`/`mcp/constants.js`
in the test-coverage-gaps doc: trivial pure helpers, already exercised indirectly via
`FolderWalker`/`ConfluenceSyncEngine`'s own suites.

## Test items

The modules listed in `docs/architecture.md#module-ownership`: `McpSession`,
`JiraClient`, `ConfluenceClient`, `FolderWalker`, `ConfluenceSyncEngine`,
`MarkdownFormatter`, `CommentBlockParser`, `SyncState`, `FileWriter`, `SyncEngine`,
`TrackedKeysConfig`, `ProjectConfig`, `cli.js` (`dispatch`).

## Features to be tested

- Pure formatting/parsing logic (`markdown/*`) — frontmatter shape (issue and
  Confluence page), body rendering, table-of-contents generation, comment block
  parsing/merging (new / changed / unchanged / deleted comment)
- Persistence boundaries (`sync/*`) — read/write round-trip, delta comparison,
  `{ issues, confluence }` sectioning
- MCP session orchestration (`McpSession`) — retry wrapper, cleanup idempotency, via an
  injected fake `Client`/transport, no real `npx mcp-remote` subprocess
- Orchestration (`SyncEngine`, `JiraClient`, `ConfluenceSyncEngine`, `ConfluenceClient`,
  `FolderWalker`) — constructor-injected fakes stand in for the MCP transport and
  filesystem; no real network call in a unit test

## Features not to be tested

- The live Atlassian-hosted MCP server / real `npx mcp-remote` subprocess — no unit test
  spawns it or makes a real network call (would need a manual/e2e pass against a real
  tenant; out of scope until an `e2e` suite is added)
- Markdown fidelity of MCP's own rendering (images/attachments/macros/mentions) — see
  `docs/atlassian-mcp-reference.md`; jiraFedrunek only tests that it writes what MCP gave it

## Test approach

TDD (red → green → refactor) per the project's `test-driven-development` rule — see
[docs/development.md — Adding a new module](./development.md#adding-a-new-module).
Pure modules get real inputs/outputs, no mocks. I/O-touching modules take
constructor-injected fakes (in-memory `FileWriter`, stub `{ callTool }`, fake MCP
`Client`/transport factories for `McpSession` itself).

**Debug logging in tests:** every test emits `console.log` per step it performs, same
convention as production code (`docs/development.md#coding-style`) — a failing test's
log trail should make the failure obvious without re-running under a debugger.

## Naming convention

- **Test Suite ID:** `TS-<AREA>-<MODULE>` — one suite per module, one file per suite
- **Test Case ID:** `TC-<AREA>-<MODULE>-<NNN>` — zero-padded 3-digit sequence per suite
- Areas: `MCP`, `JIRA`, `CONFLUENCE`, `FOLDER`, `MD` (markdown), `SYNC`, `PROJECT`, `CLI`

Each `node:test` `test()` name is prefixed with its Test Case ID, e.g.:

```js
test('TC-MD-FORMATTER-001: buildFrontmatter returns all required fields', () => { ... });
```

## Test suites

| Suite ID | Module | Test file | Status |
|---|---|---|---|
| `TS-MD-FORMATTER` | `MarkdownFormatter` | `tests/node/markdown-formatter.test.js` | done |
| `TS-MD-COMMENTPARSER` | `CommentBlockParser` | `tests/node/markdown-comment-block-parser.test.js` | done |
| `TS-SYNC-STATE` | `SyncState` | `tests/node/sync-state.test.js` | done |
| `TS-SYNC-FILEWRITER` | `FileWriter` | `tests/node/sync-file-writer.test.js` | done |
| `TS-SYNC-ENGINE` | `SyncEngine` | `tests/node/sync-engine.test.js` | done |
| `TS-SYNC-TRACKEDKEYS` | `TrackedKeysConfig` | `tests/node/sync-tracked-keys-config.test.js` | done |
| `TS-PROJECT-CONFIG` | `ProjectConfig` | `tests/node/sync-project-config.test.js` | done |
| `TS-JIRA-CLIENT` | `JiraClient` | `tests/node/jira-client.test.js` | done |
| `TS-MCP-SESSION` | `McpSession` | `tests/node/mcp-session.test.js` | done |
| `TS-CONFLUENCE-CLIENT` | `ConfluenceClient` | `tests/node/confluence-client.test.js` | done |
| `TS-FOLDER-WALKER` | `FolderWalker` | `tests/node/folder-walker.test.js` | done |
| `TS-CONFLUENCE-SYNC` | `ConfluenceSyncEngine` | `tests/node/confluence-sync-engine.test.js` | done |
| `TS-CLI-DISPATCH` | `cli.js` (`dispatch`) | `tests/node/cli-dispatch.test.js` | done |

Update the Status column (`not started` / `in progress` / `done`) as each suite lands —
this table is the single source of truth for "what's tested" until a CI badge replaces it.

## Pass/fail criteria

- **Suite pass:** every `TC-*` in the file passes, zero `test.todo()` left in it
- **Suite fail:** any assertion fails, or the suite still contains `test.todo()` placeholders
- **Plan exit criteria:** all suites at `done` and `npm test` exits 0

## Environmental needs

`node --test tests/node/*.test.js` (see `npm test` in `package.json`) — no external
services, no network, no real Atlassian tenant, no `npx mcp-remote` subprocess spawned.
Node >=20 (per `engines.node`).
