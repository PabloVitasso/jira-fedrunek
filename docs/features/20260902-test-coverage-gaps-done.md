---
name: test-coverage-gaps
description: branch/loop/error-path coverage gaps found by a manual audit of every test suite against its source module on 2026-09-02, after fixing a real TrackedKeysConfig.add() data-loss bug found the same way; prioritized list, not yet implemented
metadata:
  type: proposal
  status: implemented — every gap below (high, medium, and the SyncState low-priority one) now has a regression test; only the index.js extraction remains undone
  spec_ref: docs/testing.md
  see_also: docs/architecture.md#module-ownership
---

# Test coverage gaps (proposal)

**Status: implemented.** All suites in
[docs/testing.md — Test suites](../testing.md#test-suites) are marked `done`,
meaning every `TC-*` passes with no `test.todo()` left — but "done" measures
whether the suite is finished, not whether every branch in the source module
is exercised. This doc records a manual line-by-line audit (no coverage tool
is configured in this project) of each test file against its source file,
done in two passes on 2026-09-02.

## Why this doc exists

The audit started narrow — "is `jiraFedrunek.toml` coverage complete?" — and
found a real bug, not just a gap: `TrackedKeysConfig.add()` was writing
`stringify({ tracked_keys: merged })` as the **entire file**, silently
deleting `cloud_id` and `[confluence]` (`space_keys`, `watch_pages`,
`watch_dirs`) every time `track <key>` ran. Fixed same day (re-parses the
full TOML, spreads `...data` before overwriting `tracked_keys`), with a
regression test (`TC-SYNC-TRACKEDKEYS-006`) proving unrelated top-level keys
survive. That fix is what prompted auditing the rest of `ProjectConfig`/
`TrackedKeysConfig` for gaps (6 tests added, see `TC-PROJECT-CONFIG-004..006`
and `TC-SYNC-TRACKEDKEYS-007..009`), then extending the same method to every
other suite in the project. **Landed already — this doc's "not started"
status is about everything below, the two files above are done.**

## Audit method

For each `src/*.js` file: read it in full, read its paired test file in
full, and check for untested `if`/`else`, `??`/`||` fallbacks, ternaries,
early returns, loop 0/1/many-item variants, `try`/`catch` and rejected-promise
paths, and string/data-parsing edge cases. No coverage tool is wired into
`package.json` — this was manual, so treat it as a floor, not an exhaustive
guarantee. No second bug on the scale of the `TrackedKeysConfig` clobber was
found in the remaining modules.

## Findings, by priority

All items below are now covered by a regression test (`TC-*` ids noted
inline); each was verified against the source before writing the assertion,
no bugs found beyond the one already fixed in `TrackedKeysConfig.add()`.

### High — real reliability/orchestration surface, currently unexercised

**`ConfluenceSyncEngine`** (`tests/node/confluence-sync-engine.test.js`) —
biggest gap, most branches of any file audited:
- `syncDirs`/`syncPages` (batch verbs) have no direct test, only indirect
  coverage via `cli-dispatch.test.js`'s trivial fakes — covered by
  `TC-CONFLUENCE-SYNC-011`/`012`
- `#fetchStale`'s partial-failure path — one page write rejecting inside the
  `Promise.allSettled` batch — is never exercised, so the `failed` array's
  behavior is unverified — covered by `TC-CONFLUENCE-SYNC-014`
- `syncSpaces`'s cursor-pagination loop is only tested for a single page of
  results; multi-page cursor-follow at the outer space-loop level is
  untested (`FolderWalker`'s own cursor loop is tested — this is a separate,
  outer loop) — covered by `TC-CONFLUENCE-SYNC-013`
- `syncDir`'s "no pages found" branch untested — covered by
  `TC-CONFLUENCE-SYNC-010`
- `syncPage`'s "updated" status branch untested (only 'created' and
  'unchanged' are covered) — covered by `TC-CONFLUENCE-SYNC-008`
- `meta.title`/`spaceKey` "unknown" fallback branches (missing
  `content.title`, missing `webui` link) untested — covered by
  `TC-CONFLUENCE-SYNC-009`

**`McpSession`** (`tests/node/mcp-session.test.js`) — guards real retry/
timeout behavior, not just branch coverage:
- `callTool`'s retry path (`onFailedAttempt`) is entirely untested — no test
  makes the fake client fail once then succeed, or exhausts `RETRY_COUNT` —
  covered by `TC-MCP-SESSION-006`/`007`, using `node:test`'s built-in fake
  `setTimeout` (`t.mock.timers`) to skip the real backoff delay
- `connect()`'s auth-timeout race (`Promise.race` against the timeout) is
  untested — the one documented failure mode users actually hit ("browser
  open, didn't authorize in time"); harder to test without fake timers but
  worth doing given it's a real support scenario — covered by
  `TC-MCP-SESSION-008`, same fake-timer approach (skips the real 90s wait)

### Medium — quick, low-risk additions, same shape as the TrackedKeysConfig fix

- **`ConfluenceClient`**: non-JSON response body passthrough in
  `pageBody()`'s catch branch; `getSpaces`'s `data.results ?? []` fallback
  when the key is absent; `searchByCql`'s cursor-forwarding and non-default
  `limit` args (only default-args call is tested) — covered by
  `TC-CONFLUENCE-CLIENT-006`/`007`/`008`
- **`FolderWalker`**: `decodeHtmlEntities`'s title fallback
  (`content.title` missing → falls back to `r.title`); "unknown" `spaceKey`
  fallback when the `webui` link is absent — covered by
  `TC-FOLDER-WALKER-004`/`005`
- **`cli.js`**: the "dir id not found in `watchDirs`" fallback
  (`?? { folderId, label: folderId }`) is untested — only the "found" case
  is covered; no dispatch-level test exists for the "confluence pages" verb
  at all (page/dir/dirs/sync all have one) — covered by
  `TC-CLI-DISPATCH-007B`/`009B`
- **`MarkdownFormatter`**: `buildToc`'s duplicate-anchor disambiguation
  branch (`seen[anchor] > 1`) — no test has two headings that slugify to the
  same anchor — covered by `TC-MD-FORMATTER-013`

### Low — same fallback shape already proven elsewhere, skip unless doing a full sweep

- **`SyncState`**: valid JSON present but missing `issues`/`confluence` keys
  — exercises `parsed.issues ?? {}` / `parsed.confluence ?? {}` independently
  of the already-tested "file missing" and "invalid JSON" cases — covered by
  `TC-SYNC-STATE-005B`

### No gaps found

`SyncEngine`, `JiraClient`, `CommentBlockParser`, `FileWriter` — branches,
loops (0/1/many), and error paths are all exercised by their existing suites.

### Untested files with no suite at all — mostly fine as-is

- **`src/log.js`** — one `process.stdout.isTTY` ternary. Skip; too trivial
  to warrant a suite.
- **`src/mcp/constants.js`** — pure constants, no logic. Skip.
- **`src/index.js`** — the composition root (`buildDependencies`, `main`) is
  reasonably left untested as wiring, consistent with
  [docs/testing.md — Features not to be tested](../testing.md#features-not-to-be-tested).
  But two things *inside* it are real untested logic, not wiring:
  - `loadEnvFile` — `KEY=VALUE` parsing, comment-skipping, and the
    "don't override an already-set env var" precedence rule
  - `confirmBulk`/`confirmPrompt` — `--yes` bypass, non-TTY rejection,
    y/yes answer parsing
  Both would need extracting into a testable module (or injecting stdin) to
  cover under the project's constructor-injected-fake pattern; worth doing
  only if the bulk-download confirmation path is considered risk-bearing
  enough to justify the refactor. Not proposed here as urgent.

## Suggested order if this is picked up

1. `ConfluenceSyncEngine` gaps (biggest surface, most branches, closest
   analog to the bug class already found once in this codebase)
2. `McpSession.callTool` retry logic (real reliability behavior, not just
   branch coverage)
3. The medium-priority fallback-branch gaps (`ConfluenceClient`,
   `FolderWalker`, `cli.js`, `MarkdownFormatter`) — quick, low-risk, same
   shape as the `TrackedKeysConfig`/`ProjectConfig` tests already landed
4. `SyncState`'s low-priority gap and the `index.js` extraction — only if
   doing a completionist pass; neither is guarding a known risk today
