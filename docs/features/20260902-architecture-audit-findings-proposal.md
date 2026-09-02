---
name: architecture-audit-findings
description: full-codebase audit (code-review skill, high effort) run on 2026-09-02 against the working tree, covering error handling, state durability, JQL/CQL injection, and duplicated logic; 10 findings, none fixed yet
metadata:
  type: proposal
  status: not started — findings only, no fixes applied
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
findings, ordered by severity below. None have been fixed yet — this is the
record, not the fix.

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

### 3. SIGINT/SIGTERM handler doesn't wait for cleanup

**`src/mcp/McpSession.js:76`** — the signal handlers call `this.#cleanup()`
(which fires an un-awaited `this.client?.close()`) and then immediately call
`process.exit()` synchronously, without waiting for the close to complete.

**Failure scenario**: user presses Ctrl-C mid-sync. `process.exit(130)` runs
before `client.close()`'s promise settles, tearing down the event loop first.
The underlying `npx mcp-remote` child process (spawned by
`StdioClientTransport`) may not receive a clean shutdown signal, risking an
orphaned process after the CLI exits.

### 4. `SyncState.save()` writes are not atomic

**`src/sync/SyncState.js:58`** — writes the state file directly via
`fs.writeFileSync`, no temp-file + rename. A crash or power loss mid-write
leaves a truncated/corrupt JSON file.

**Failure scenario**: process killed (OOM, Ctrl-C during the write syscall,
machine sleep) while flushing `sync/.sync-state.json`. File is left
half-written.

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

### 10. `jiraFedrunek.toml` parsed twice per invocation

**`src/index.js:72`** — `buildDependencies()` has `ProjectConfig` and
`TrackedKeysConfig` independently `fs.readFileSync` + TOML-parse the same
`jiraFedrunek.toml` on every run instead of sharing one parsed
representation.

**Failure scenario**: not a bug today, but a sign config ownership isn't
centralized — beyond the wasted I/O, a future edit to one class's assumed
TOML shape can silently diverge from the other's expectations of the same
file's structure.

## Suggested order if this is picked up

1. #4 + #5 together (atomic write + corrupt-state backup/warning) — same
   root cause, prevents silent history loss
2. #1 (move `connect()` inside try/finally) — smallest fix, worst current
   user experience (raw stack trace on a common failure mode)
3. #6 (`deleted_at` duplication) — unbounded growth in tracked files, easy
   regression test to add
4. #2 + #3 (`McpSession` race/signal cleanup) — real but lower-frequency;
   needs fake-timer tests similar to `TC-MCP-SESSION-008`
5. #7, #8, #9, #10 — correctness/hardening/cleanup, no known incident yet
