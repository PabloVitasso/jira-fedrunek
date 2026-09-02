---
name: architecture
description: module map, data flow, file layout, and invariants for jiraFedrunek
metadata:
  type: reference
  spec_ref: docs/jiraFedrunek-spec-v2.md
---

# Architecture

## Contents

- [Layer overview](#layer-overview)
- [Data flow](#data-flow)
- [File layout](#file-layout)
- [Module ownership](#module-ownership)
- [Non-negotiable invariants](#non-negotiable-invariants)
- [Sync algorithm](#sync-algorithm)

## Layer overview

```
src/mcp/        McpSession — owns the MCP Client/StdioClientTransport lifecycle
                (npx mcp-remote, one subprocess per invocation), retry policy,
                shutdown cleanup. Shared by JiraClient and ConfluenceClient —
                this is the one auth/session boundary for the whole tool.
src/jira/       JiraClient — Jira access via searchJiraIssuesUsingJql, auth-
                agnostic via injected mcpSession.callTool
src/confluence/ ConfluenceClient, FolderWalker, ConfluenceSyncEngine —
                Confluence page/space/folder access + orchestration, ported
                from the sibling confluence-fetch tool
src/markdown/   MarkdownFormatter, CommentBlockParser — pure, no I/O
src/sync/       SyncState, FileWriter, SyncEngine, TrackedKeysConfig,
                ProjectConfig — orchestration + persistence
```

Per [docs/features/20260902-mcp-auth-integration-done.md](features/20260902-mcp-auth-integration-done.md)
(adopted): jiraFedrunek's own OAuth 3LO app + Jira REST v2 client were
replaced by Atlassian's hosted MCP server (`https://mcp.atlassian.com/v1/mcp`),
and the sibling `confluence-fetch` tool's logic was ported into
`src/confluence/`. One MCP session per invocation, shared by both Jira and
Confluence calls — no separate OAuth app registration step, no second tool.

## Data flow

**Jira:**
```
McpSession.connect() (browser auth on first run, cached token after)
        |
        v
JiraClient.getIssue  — searchJiraIssuesUsingJql, fields.comment.comments inline
        |
        v
CommentBlockParser.mergeComments (diff against existing file)
        |
        v
MarkdownFormatter.buildFrontmatter/buildIssueBody/formatComment
        |
        v
FileWriter.write + SyncState.setIssue/save
```

**Confluence:**
```
McpSession.connect()
        |
        v
ConfluenceClient.getPage/getSpaces/getPagesInSpace/searchByCql
        |
        v
FolderWalker.walkDescendants (dir mode only — CQL ancestor pagination)
        |
        v
MarkdownFormatter.buildPageFrontmatter/buildToc
        |
        v
ConfluenceSyncEngine (diff vs SyncState's confluence section, confirmBulk
        guard, orphan cleanup, CONTENTS.md rebuild)
        |
        v
FileWriter.write + SyncState.setPage/save
```

Both products land in the same shape (Markdown text) through the same MCP
transport — `description`/comment bodies (Jira) and `getConfluencePage`
output (Confluence) are already Markdown, no wiki-markup conversion step.

## File layout

```
src/
  mcp/
    constants.js              MCP_URL, AUTH_TIMEOUT_S, CALL_TIMEOUT_MS, retry/concurrency knobs
    McpSession.js              connect()/callTool(name,args)/close()
  jira/
    JiraClient.js               getIssue(key) — DEFAULT_JIRA_FIELDS, 0/1/>1 semantics
  confluence/
    ConfluenceClient.js          getPage/getSpaces/getPagesInSpace/searchByCql — MCP calls only
    FolderWalker.js               CQL-ancestor descendant pagination, pure orchestration
    ConfluenceSyncEngine.js        page/dir/dirs/pages/sync modes, manifest diffing, confirmBulk,
                                   CONTENTS.md rebuild
    timestamp.js                   normalizeTimestamp(ts) — canonical ISO string, shared by
                                   FolderWalker (CQL lastModified) and ConfluenceSyncEngine (CQL
                                   lastModified + REST version.createdAt) so a page's staleness
                                   key compares equal regardless of which API populated it
    webui.js                       spaceKeyFromWebui(webui) — shared by FolderWalker and
                                   ConfluenceSyncEngine.syncPage, was duplicated verbatim before
  markdown/
    MarkdownFormatter.js         buildFrontmatter, buildIssueBody, formatComment, buildMarkdown,
                                 buildPageFrontmatter, buildToc — description/comment bodies are
                                 already Markdown from MCP, no conversion step
    CommentBlockParser.js        parseCommentBlocks, mergeComments — diffs existing file's HTML-comment blocks
  sync/
    SyncState.js                 { issues: {...}, confluence: {...} } — getIssue/setIssue,
                                 getPage/setPage/deletePage/allPages, one save()
    FileWriter.js                filesystem boundary, mockable
    SyncEngine.js                 syncIssue(key), syncAll(keys) — orchestrator
    TrackedKeysConfig.js          jiraFedrunek.toml's [jira].tracked_keys — load/add
    ProjectConfig.js              jiraFedrunek.toml's cloud_id + [confluence] targets — load
  log.js                       step(color, text) — ANSI-if-TTY, shared by mcp/confluence modules
  cli.js                        dispatch(command, args, deps) — testable CLI logic, no process.* calls
  index.js                      thin shell: parses argv/.env, constructs the real McpSession/
                                clients/engines graph, calls cli.js dispatch(), owns process.exit

jiraFedrunek.toml             cloud_id, [jira].tracked_keys, [confluence] targets — gitignored (real ids);
                               jiraFedrunek.toml.example is the committed template

sync/
  {ISSUE_KEY}.md              one file per issue, frontmatter + body (spec 5.1-5.3)
  confluence/
    {spaceKey}/{id}-{slug}.md    one file per Confluence page
    {spaceKey}/{folderId}-{slug}/{id}-{slug}.md   pages fetched via a tracked folder
    CONTENTS.md                  generated index, grouped by space then subfolder
  .sync-state.json             { issues: {...}, confluence: {...} } — delta-detection state

tests/
  node/                       node:test specs, one file per Test Suite — see docs/testing.md
```

**Deviation from spec §5.2/5.3:** the comment metadata block includes an extra
`<!-- updated_at: ... -->` line beyond what the spec's example shows. Without it,
`CommentBlockParser.mergeComments` has no stored value to compare a fresh comment's
`updated` field against, so "changed" vs. "unchanged" (spec §6 step 4) would be
undetectable. `formatComment` writes it; `parseCommentBlocks` reads it back.

**Deviation from spec §7.11:** `SyncEngine`'s constructor takes an optional 4th
`options` argument (`{ now, pathForKey }`) beyond the spec's `(jiraClient, syncState,
fileWriter)`, purely for test injection (fake clock, fake path) — defaults to
`Date.now`-based ISO timestamps and `sync/{key}.md` when omitted, so production call
sites are unaffected.

**Superseded by the MCP migration:** `AtlassianOAuthClient`/`TokenStore`/
`CallbackServer`/`AuthSession` (spec §7.2-§7.4's OAuth 3LO design) and
`wikiToMarkdown`/`j2m` are gone entirely — `McpSession` replaces the auth
stack, and MCP already returns Markdown text so there is nothing left to
convert. The OS-keychain proposal
([20260902-oauth-keyring-integration-proposal.md](features/20260902-oauth-keyring-integration-proposal.md))
is superseded for the same reason: there is no local token file to protect,
`mcp-remote` owns its own cache (`~/.mcp-auth/mcp-remote-v1/*_tokens.json`,
`chmod 600`, outside this repo, not app-managed).

**`TrackedKeysConfig`/`ProjectConfig` split and the `track` command (not in
spec §7):** both parse the same `jiraFedrunek.toml` independently by design —
`TrackedKeysConfig` owns `[jira].tracked_keys` (existing ad-hoc-vs-permanent
distinction: `sync <keys>` is ad-hoc, `track <keys>` persists,
bare `sync` loads `[jira].tracked_keys`), `ProjectConfig` owns `cloud_id` and
`[confluence]` targets. Two focused parsers over one shared file, rather
than a single generic config schema — same "no forced-generic schema"
precedent as `SyncState`'s `{ issues, confluence }` split below.

**`SyncState`'s `{ issues, confluence }` split:** one file, two independently-shaped
sections — `issues` keeps the per-issue-key shape (`issue_updated_at` + `comment_ids`),
`confluence` keeps a per-page-id shape (`lastModified`/`path`/`title`). Deliberately not
one generic schema across both resource types: Jira's diffing needs per-comment-id
tracking, Confluence's needs a flat `lastModified` — forcing both into one invented shape
would be more code for no behavioral benefit. Precedent: Terraform state (`resources`
list, each entry typed) and `package-lock.json` (per-package entries, not a single
generic dependency schema).

**`cli.js` vs `index.js` split (not in spec §7, added for testability):** `cli.js`
exports a pure `dispatch(command, args, deps)` that takes already-built collaborators
(`mcpSession`, `syncEngine`, `trackedKeysConfig`, `confluenceSyncEngine`, plus the
`watchDirs`/`watchPages`/`spaceKeys` lists) and returns a result object or throws — no
`process.argv`, `process.exit`, or `.env` parsing. `index.js` is the thin, untested-by-design
shell: it loads `.env`, constructs the real `McpSession`/`JiraClient`/`ConfluenceClient`/
`FolderWalker`/`SyncState`/`FileWriter`/`SyncEngine`/`ConfluenceSyncEngine`/
`TrackedKeysConfig`/`ProjectConfig` graph, and calls `dispatch()`.

**CLI surface:** `login`, `sync [keys...]`, `track <keys...>` (Jira, unchanged), plus
`confluence <page|dir|dirs|pages|sync> [args...]` — one dispatcher, Confluence nested
under one noun (`gh <noun> <verb>` pattern) rather than a flat, growing set of top-level
commands. `login` now connects `McpSession` (triggering the one-time browser consent if
no cached token) and closes, instead of running a full OAuth 3LO exchange.

**Architecture-audit fixes (2026-09-02):** see
[20260902-architecture-audit-findings-done.md](features/20260902-architecture-audit-findings-done.md)
for the full record. In brief: `SyncState.save()` now writes atomically
(temp file + rename); `SyncState.load()` backs up corrupt state instead of
silently discarding it; `McpSession`'s SIGINT/SIGTERM handlers await cleanup
before exiting; `mcpSession.connect()` runs inside `index.js`'s try/finally;
`CommentBlockParser.mergeComments` no longer duplicates `deleted_at`
markers; page `lastModified` values are normalized to one canonical ISO
string across CQL/REST sources (`timestamp.js`); `JiraClient`/
`ConfluenceSyncEngine`/`FolderWalker` validate key/id format before
interpolating into JQL/CQL; `spaceKeyFromWebui` was de-duplicated
(`webui.js`); `jiraFedrunek.toml` is parsed once per invocation and shared
between `ProjectConfig`/`TrackedKeysConfig`.

**Tooling (2026-09-02):** ESLint (flat config, `eslint.config.js`) and
Prettier (`.prettierrc.json`) were added, config adapted from the sibling
`szkrabok` project with its Playwright/chromium-specific boundary rules
(no direct `chromium.launch*`, no stealth imports, immutability
restrictions) dropped as not applicable here. `npm run lint` / `lint:fix` /
`format` / `format:check`. `sessions/` (gitignored Firefox-profile research
artifacts) and `sync/` are excluded from both.

## Module ownership

Per spec §7, each module has exactly one responsibility (SRP) and depends only on
abstractions passed via constructor injection (DIP) — never reaches for global state
or another module's internals directly:

| Module | Responsibility | Depends on |
|---|---|---|
| `McpSession` | MCP Client/transport lifecycle, retry, cleanup | `@modelcontextprotocol/sdk`, `p-retry` |
| `JiraClient` | Jira access via `searchJiraIssuesUsingJql` | injected `{ callTool }` (an `McpSession`-shaped object), not `McpSession` directly |
| `ConfluenceClient` | Confluence MCP calls only | injected `{ callTool }`, mirrors `JiraClient`'s shape |
| `FolderWalker` | CQL-ancestor descendant pagination | `ConfluenceClient`, `timestamp.js`, `webui.js` |
| `ConfluenceSyncEngine` | Confluence orchestrator (page/dir/dirs/pages/sync modes) | `ConfluenceClient`, `FolderWalker`, `SyncState`, `FileWriter`, `timestamp.js`, `webui.js` |
| `MarkdownFormatter` | pure formatting, no I/O | nothing (description/comment/page bodies are already Markdown) |
| `CommentBlockParser` | parse/merge existing file's comment blocks | `MarkdownFormatter.formatComment` (pure string ops otherwise) |
| `SyncState` | `.sync-state.json` persistence, `{ issues, confluence }` | filesystem |
| `FileWriter` | filesystem boundary | filesystem |
| `SyncEngine` | Jira orchestrator | `JiraClient`, `SyncState`, `FileWriter` (constructor injection) |
| `TrackedKeysConfig` | `jiraFedrunek.toml`'s `[jira].tracked_keys` | filesystem, `smol-toml` |
| `ProjectConfig` | `jiraFedrunek.toml`'s `cloud_id` + `[confluence]` targets | filesystem, `smol-toml` |
| `cli.js` (`dispatch`) | command routing, no process/env access | all of the above, passed in as `deps` |

## Non-negotiable invariants

1. `JiraClient`/`ConfluenceClient` never import `McpSession` directly — only the
   `{ callTool }` shape passed at construction (DIP boundary)
2. `MarkdownFormatter` and `CommentBlockParser` do no I/O — no `fs`, no network — testable
   as pure functions
3. `SyncEngine`/`ConfluenceSyncEngine` never call the MCP transport or touch the
   filesystem directly — only through the injected client and `FileWriter`
4. Comment metadata lives in HTML comments in the body, never in YAML frontmatter —
   frontmatter is file-scoped only (spec §5.3)
5. `sync/.sync-state.json` is gitignored — never committed. `mcp-remote`'s own token
   cache (`~/.mcp-auth/mcp-remote-v1/*_tokens.json`) lives outside this repo entirely and
   is not app-managed

## Sync algorithm

**Jira** (spec §6, summary):
1. `McpSession.connect()` — reuse cached token, or one-time browser consent
2. `JiraClient.getIssue(key)`; compare `fields.updated` vs stored `issue_updated_at` —
   skip body regen if unchanged
3. Comments come back inline on `fields.comment.comments` — new `id` appended, changed
   `updated` replaces the block, missing ids marked `<!-- deleted_at -->`
4. Write file via `gray-matter` stringify, update `.sync-state.json`'s `issues` section

**Confluence** (`page`/`dir`/`dirs`/`pages`/`sync` modes):
1. Resolve target(s): a single page id, a folder's descendants (`FolderWalker`), the
   configured watch lists, or every page in the configured spaces
2. Diff against `.sync-state.json`'s `confluence` section by `lastModified`; for more
   than one stale page, `confirmBulk` gates the download (TTY prompt, or `--yes`)
3. Fetch stale pages concurrently (`p-limit`), write via `gray-matter` stringify with a
   generated table of contents (`buildToc`)
4. Remove orphaned manifest entries no longer present remotely, rebuild `CONTENTS.md`
