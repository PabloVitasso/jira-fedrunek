---
name: architecture-audit-findings
description: full-codebase audit (code-review skill, high effort) run on 2026-09-02 against the working tree, covering error handling, state durability, JQL/CQL injection, and duplicated logic; 9 of 10 findings fixed, #2 found to be a false positive
metadata:
  type: proposal
  status: implemented — #1, #3-#10 fixed with regression tests; #2 investigated and found not to reproduce (Promise.race handles the loser internally); ESLint+Prettier also added to the project during this pass
  spec_ref: docs/architecture.md
  see_also: docs/testing.md, docs/features/20260902-test-coverage-gaps-done.md
---

# Architecture audit findings (proposal)

A full-codebase audit was run on 2026-09-02 via the `code-review` skill at
`high` effort, targeting the whole tree (`--path .`) rather than a diff —
looking for weak points and architectural weaknesses, not just correctness
bugs in pending changes. This is a companion to
[test-coverage-gaps](./20260902-test-coverage-gaps-done.md), which audited
test coverage against source; this doc audits the source itself. Ten
findings, ordered by severity below.

**Status: implemented, same day.** All ten findings were picked up in the
suggested order below. Nine were real and are now fixed, each with a
red→green regression test (TDD — the test was written and watched fail
before the fix landed). One (#2) turned out not to reproduce; see its
section for the investigation. Test suite grew from 105 to 114 tests across
this pass. ESLint + Prettier were also added to the project in the same
session (config adapted from `szkrabok`, trimmed of its Playwright/chromium-
specific rules) — unrelated to the audit itself, but the whole tree was
reformatted and the two lint findings that surfaced (a stray Firefox-profile
fixture under `sessions/`, an unclear regex in
`tests/node/markdown-formatter.test.js`) were fixed alongside.

## High — error handling / state durability

### 1. `mcpSession.connect()` runs outside the try/finally

**`src/index.js:127`** — `await deps.mcpSession.connect()` is called before
the surrounding `try` block starts. A connection failure (auth timeout,
`npx`/`mcp-remote` spawn error, network failure) skips the clean
`console.error(err.message); process.exitCode = 1` path used for every other
error and becomes an unhandled promise rejection instead, since the
top-level `main()` call is not awaited. `mcpSession.close()` in the `finally`
block never runs.

**Failure scenario**: user runs `jiraFedrunek sync PROJ-123`, doesn't approve
the browser OAuth prompt within 90s. `connect()` rejects with "Authorization
timed out" before the try block, producing a raw stack trace instead of a
clean message.

**Fixed** — `await deps.mcpSession.connect()` moved inside the `try` block in
`src/index.js`. A connect failure now goes through the same
`console.error(err.message); process.exitCode = 1` path as every other error,
and `close()` still runs in `finally`. No new test: `index.js` is documented
as the "thin, untested-by-design shell" (`docs/architecture.md` —
[`cli.js` vs `index.js` split](../architecture.md#file-layout)), so this is a
structural fix verified by reading the diff, not a unit test.

### 2. `Promise.race` in `McpSession.connect()` doesn't cancel the loser

**`src/mcp/McpSession.js:36`** — races `client.connect(transport)` against a
90s auth-timeout promise, but never cancels whichever one loses. If the real
`connect()` rejects after the timeout has already fired and been handled,
that becomes a second, separate unhandled rejection.

**Failure scenario**: browser auth takes longer than 90s, timeout wins the
race and throws "Authorization timed out". Seconds later the real
`client.connect(transport)` call settles with its own rejection (e.g.
transport error after the user clicks through late) — unattached, reported
as a second unhandled rejection, confusing diagnosis and potentially fatal
on Node versions where unhandled rejections crash the process.

**Does not reproduce — false positive.** `Promise.race` attaches an internal
rejection handler to *every* promise passed to it (it effectively calls
`.then(resolve, reject)` on each), so a losing promise that rejects later is
already "handled" from V8's perspective — it never surfaces as
`unhandledRejection`, regardless of how much later it settles. Verified two
ways: a standalone Node repro (`Promise.race([p1, p2])`, reject `p2` after
`p1` wins, listen for `process.on('unhandledRejection', ...)` — never fires)
and `TC-MCP-SESSION-009`, which sets up exactly this project's race + a late
rejection and asserts no `unhandledRejection` fires — it passes unmodified
against the pre-existing code, with no fix applied. Kept as a permanent
regression-guard test even though it isn't tied to a code change.

### 3. SIGINT/SIGTERM handler doesn't wait for cleanup

**`src/mcp/McpSession.js:76`** — the signal handlers call `this.#cleanup()`
(which fires an un-awaited `this.client?.close()`) and then immediately call
`process.exit()` synchronously, without waiting for the close to complete.

**Failure scenario**: user presses Ctrl-C mid-sync. `process.exit(130)` runs
before `client.close()`'s promise settles, tearing down the event loop first.
The underlying `npx mcp-remote` child process (spawned by
`StdioClientTransport`) may not receive a clean shutdown signal, risking an
orphaned process after the CLI exits.

**Fixed** — `#cleanup()` in `src/mcp/McpSession.js` now returns the
`client.close()` promise instead of firing it and forgetting; the SIGINT/
SIGTERM handlers are `async` and `await this.#cleanup()` before calling
`process.exit()`. The `exit` handler stays synchronous/fire-and-forget —
Node does not wait for async work in `exit` listeners, so there is nothing
to await there. `TC-MCP-SESSION-010` grabs the registered SIGINT listener
directly, invokes it with a slow fake `close()`, and asserts `close()`
resolved before `process.exit(130)` was called — failed red (exit called
before `closeResolved` flipped) before the fix.

### 4. `SyncState.save()` writes are not atomic

**`src/sync/SyncState.js:58`** — writes the state file directly via
`fs.writeFileSync`, no temp-file + rename. A crash or power loss mid-write
leaves a truncated/corrupt JSON file.

**Failure scenario**: process killed (OOM, Ctrl-C during the write syscall,
machine sleep) while flushing `sync/.sync-state.json`. File is left
half-written.

**Fixed** — `save()` now writes to `<path>.tmp-<uuid>` and `fs.renameSync`s
it over the target, which is atomic on the same filesystem. `TC-SYNC-STATE-007`
asserts the target directory contains only the final file after `save()`,
no leftover temp artifact.

### 5. `SyncState.load()` silently discards corrupt state

**`src/sync/SyncState.js:21`** — on any JSON parse error, silently resets to
`{issues:{}, confluence:{}}`, no backup of the corrupted file, only a
`console.log` (not surfaced to the user as a warning).

**Failure scenario**: compounds with #4 — a truncated file from a killed
write is silently treated as "no history" on the next run. Every
`stored.issue_updated_at` / `stored.lastModified` comparison becomes
`undefined !== value`, forcing a full re-download and re-write of every
tracked issue/page, with no indication to the user that tracking history was
wiped.

**Fixed** — on a `JSON.parse` failure, `load()` now `fs.renameSync`s the
corrupt file to `<path>.corrupt-<timestamp>` (preserving it for inspection
instead of overwriting it silently on the next `save()`) and emits a
`console.error` warning naming the backup path and noting tracked history
was lost, in addition to resetting in-memory state to empty. `TC-SYNC-STATE-008`
asserts the backup file exists with the original corrupt content and that
`console.error` was called exactly once.

## Medium — data correctness

### 6. `deleted_at` marker duplicates without bound

**`src/markdown/CommentBlockParser.js:53`** — `mergeComments` appends a new
`<!-- deleted_at: ... -->` marker every sync without checking whether the
existing block was already marked deleted.

**Failure scenario**: a Jira comment is deleted upstream. First sync after
that appends one `<!-- deleted_at: T1 -->` line. `seen` is only populated
from `freshComments`, and there is no check like
`existing.block.includes('<!-- deleted_at')` before pushing another marker —
so every subsequent sync (comment still absent) appends another marker,
growing the block unboundedly over the tracked issue's lifetime.
`TC-MD-COMMENTPARSER-007` only exercises a single run, so this path is
untested.

**Fixed** — `mergeComments` now checks `existing.block.includes('<!-- deleted_at:')`
before appending another marker; if already marked, the existing block is
kept as-is. `TC-MD-COMMENTPARSER-008` simulates two syncs after deletion and
reproduced the duplicate (two `deleted_at` lines) red before the fix; now
asserts exactly one marker survives, with the *original* deletion timestamp
preserved (not overwritten by the second sync's `downloadedAt`).

### 7. Two different fields feed the same `SyncState` staleness key

**`src/confluence/ConfluenceSyncEngine.js:191`** — `syncSpaces` stamps
`lastModified` from `p.version?.createdAt` (REST
`getPagesInConfluenceSpace`), while `syncPage`/`syncDir` stamp it from
`meta.lastModified` / `r.lastModified` (CQL search) — two different sources
write the same `SyncState.confluence[id].lastModified` key used for the
equality check in `#fetchStale` (line 60).

**Failure scenario**: a page reachable both via a `watch_dirs` folder
(`FolderWalker`, CQL `lastModified`) and via a `space_keys` space sync
(`version.createdAt`) gets its `SyncState` entry overwritten by whichever
sync ran last, with differently-sourced/possibly differently-formatted
timestamps. Running `confluence dirs` then `confluence sync` alternately can
cause the equality check to perpetually disagree (needless re-fetches every
time) — or, if formats happen to coincide, mask a real update.

**Fixed** — added `normalizeTimestamp()` in the new
`src/confluence/timestamp.js` (`ts ? new Date(ts).toISOString() : ''`),
applied at all three places a page's `lastModified` is produced:
`ConfluenceSyncEngine.syncPage` (CQL `meta.lastModified`),
`ConfluenceSyncEngine.syncSpaces` (REST `p.version?.createdAt`), and
`FolderWalker.walkDescendants` (CQL `r.lastModified`). Whichever API/path
populated a `SyncState` entry, the stored value is now the same canonical
ISO string for the same real-world instant, so equality checks stay valid
across syncs. `TC-CONFLUENCE-SYNC-015` tracks a page via `syncDir` (CQL,
millisecond-precision timestamp), then revisits it via `syncSpaces` (REST,
same instant *without* milliseconds) and asserts it's recognized as
unchanged — reproduced the spurious re-fetch red before the fix.

## Medium — security-adjacent

### 8. Unescaped key interpolation into JQL/CQL

**`src/jira/JiraClient.js:22`** (and similarly
`src/confluence/ConfluenceSyncEngine.js:112`,
`src/confluence/FolderWalker.js:26`) — issue keys, page/folder ids are
interpolated directly into JQL/CQL query strings with no validation.

**Failure scenario**: `jiraFedrunek.toml`'s `tracked_keys` is documented in
`CLAUDE.md` as "committed — not a secret, safe to share" across a team. A
careless or malicious PR adds a tracked key containing JQL-breaking content
(e.g. embedded `" OR ... OR key="`); `key = ${key}`, `id = "${id}"`, and
`ancestor = "${folderId}" AND type = page` all interpolate it unsanitized
into the query sent to Atlassian's MCP server, potentially matching
unintended issues/pages or breaking the query outright.

**Fixed** — added format validation before interpolation at all three sites:
`JiraClient.getIssue` rejects keys not matching `^[A-Z][A-Z0-9]*-\d+$`;
`ConfluenceSyncEngine.syncPage` and `FolderWalker.walkDescendants` reject
ids/folderIds not matching `^\d+$`. Each throws `invalid Jira issue key: ...`
/ `invalid Confluence page id: ...` / `invalid Confluence folder id: ...`
before touching the MCP client. `TC-JIRA-CLIENT-006`, `TC-CONFLUENCE-SYNC-016`,
and `TC-FOLDER-WALKER-006` each assert the underlying `callTool`/`searchByCql`
is never reached for an injection-shaped value.

## Low — architectural duplication

### 9. spaceKey-from-webui-link extraction duplicated

**`src/confluence/FolderWalker.js:29`** — the
`_links?.webui?.split('/')?.[2] ?? 'unknown'` extraction is duplicated
verbatim between `FolderWalker.walkDescendants` and
`ConfluenceSyncEngine.syncPage` instead of one shared helper.

**Failure scenario**: if Atlassian changes the webui link shape, the fix has
to land in two places; missing one leaves one sync path silently filing
pages under `spaceKey: 'unknown'` while the other still resolves correctly —
inconsistent `CONTENTS.md` groupings depending on which sync mechanism ran.

**Fixed** — extracted `spaceKeyFromWebui(webui)` to the new
`src/confluence/webui.js`, used by both `FolderWalker.walkDescendants` and
`ConfluenceSyncEngine.syncPage`. Pure refactor under existing coverage
(`TC-FOLDER-WALKER-*`, `TC-CONFLUENCE-SYNC-*` already exercised both call
sites, including the `'unknown'` fallback) — no new test needed, suite stayed
green throughout.

### 10. `jiraFedrunek.toml` parsed twice per invocation

**`src/index.js:72`** — `buildDependencies()` has `ProjectConfig` and
`TrackedKeysConfig` independently `fs.readFileSync` + TOML-parse the same
`jiraFedrunek.toml` on every run instead of sharing one parsed
representation.

**Failure scenario**: not a bug today, but a sign config ownership isn't
centralized — beyond the wasted I/O, a future edit to one class's assumed
TOML shape can silently diverge from the other's expectations of the same
file's structure.

**Fixed** — `ProjectConfig.load()` and `TrackedKeysConfig.load()` both now
accept an optional pre-parsed `data` argument, falling back to their
original disk-read-and-parse behavior when omitted (so every existing
caller/test is unaffected). `src/index.js`'s `buildDependencies()` adds a
`loadTomlOnce()` helper that reads + parses `jiraFedrunek.toml` once and
passes the same parsed object to both configs. `TC-PROJECT-CONFIG-005` and
`TC-SYNC-TRACKEDKEYS-010` prove the new overload: pass a pre-parsed object
different from what's on disk and assert it — not a fresh read — is what
gets used.

## Order followed (all landed same day, 2026-09-02)

1. #4 + #5 together (atomic write + corrupt-state backup/warning) — done
2. #1 (move `connect()` inside try/finally) — done
3. #6 (`deleted_at` duplication) — done
4. #2 + #3 (`McpSession` race/signal cleanup) — #3 done, #2 investigated and
   found to be a false positive (see its section above)
5. #7, #8, #9, #10 — done, in order

Each step ran full TDD (red test written and watched fail, then the minimal
fix, then `npm run lint && npm test`) before moving to the next finding.
