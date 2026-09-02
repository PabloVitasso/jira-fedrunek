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

## Test items

The 13 modules listed in `docs/architecture.md#module-ownership`: `AtlassianOAuthClient`,
`TokenStore`, `CallbackServer`, `AuthSession`, `JiraClient`, `wikiToMarkdown`,
`MarkdownFormatter`, `CommentBlockParser`, `SyncState`, `FileWriter`, `SyncEngine`,
`TrackedKeysConfig`, `cli.js` (`dispatch`).

## Features to be tested

- Pure formatting/parsing logic (`markdown/*`) — frontmatter shape, body rendering,
  comment block parsing/merging (new / changed / unchanged / deleted comment)
- Persistence boundaries (`sync/*`) — read/write round-trip, delta comparison
- Auth orchestration (`auth/*`) — load-or-refresh-or-login branching, token expiry math
- Orchestration (`SyncEngine`, `JiraClient`) — constructor-injected fakes stand in for
  network and filesystem; no real HTTP call in a unit test

## Features not to be tested

- Live Jira REST v2 / Atlassian OAuth endpoints — no unit test makes a real network call
  (would need a manual/e2e pass against a real Jira instance; out of scope until an
  `e2e` suite is added)
- `j2m`'s own wiki-to-markdown correctness — only jiraFedrunek's wrapper is tested, not
  `j2m` internals

## Test approach

TDD (red → green → refactor) per the project's `test-driven-development` rule — see
[docs/development.md — Adding a new module](./development.md#adding-a-new-module).
Pure modules get real inputs/outputs, no mocks. I/O-touching modules take
constructor-injected fakes (in-memory `FileWriter`/`TokenStore`, stub `JiraClient`).

**Debug logging in tests:** every test emits `console.log` per step it performs, same
convention as production code (`docs/development.md#coding-style`) — a failing test's
log trail should make the failure obvious without re-running under a debugger.

## Naming convention

- **Test Suite ID:** `TS-<AREA>-<MODULE>` — one suite per module, one file per suite
- **Test Case ID:** `TC-<AREA>-<MODULE>-<NNN>` — zero-padded 3-digit sequence per suite
- Areas: `AUTH`, `JIRA`, `MD` (markdown), `SYNC`, `CLI`

Each `node:test` `test()` name is prefixed with its Test Case ID, e.g.:

```js
test('TC-MD-FORMATTER-001: buildFrontmatter returns all required fields', () => { ... });
```

## Test suites

| Suite ID | Module | Test file | Status |
|---|---|---|---|
| `TS-MD-WIKITOMARKDOWN` | `wikiToMarkdown` | `tests/node/markdown-wiki-to-markdown.test.js` | done |
| `TS-MD-FORMATTER` | `MarkdownFormatter` | `tests/node/markdown-formatter.test.js` | done |
| `TS-MD-COMMENTPARSER` | `CommentBlockParser` | `tests/node/markdown-comment-block-parser.test.js` | done |
| `TS-SYNC-STATE` | `SyncState` | `tests/node/sync-state.test.js` | done |
| `TS-SYNC-FILEWRITER` | `FileWriter` | `tests/node/sync-file-writer.test.js` | done |
| `TS-SYNC-ENGINE` | `SyncEngine` | `tests/node/sync-engine.test.js` | done |
| `TS-SYNC-TRACKEDKEYS` | `TrackedKeysConfig` | `tests/node/sync-tracked-keys-config.test.js` | done |
| `TS-JIRA-CLIENT` | `JiraClient` | `tests/node/jira-client.test.js` | done |
| `TS-AUTH-OAUTHCLIENT` | `AtlassianOAuthClient` | `tests/node/auth-oauth-client.test.js` | done |
| `TS-AUTH-TOKENSTORE` | `TokenStore` | `tests/node/auth-token-store.test.js` | done |
| `TS-AUTH-CALLBACKSERVER` | `CallbackServer` | `tests/node/auth-callback-server.test.js` | done |
| `TS-AUTH-SESSION` | `AuthSession` | `tests/node/auth-session.test.js` | done |
| `TS-CLI-DISPATCH` | `cli.js` (`dispatch`) | `tests/node/cli-dispatch.test.js` | done |

Update the Status column (`not started` / `in progress` / `done`) as each suite lands —
this table is the single source of truth for "what's tested" until a CI badge replaces it.

## Pass/fail criteria

- **Suite pass:** every `TC-*` in the file passes, zero `test.todo()` left in it
- **Suite fail:** any assertion fails, or the suite still contains `test.todo()` placeholders
- **Plan exit criteria:** all 13 suites at `done` and `npm test` exits 0

## Environmental needs

`node --test tests/node/*.test.js` (see `npm test` in `package.json`) — no external
services, no network, no real Jira instance. Node >=20 (per `engines.node`).
