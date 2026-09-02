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
src/auth/       AtlassianOAuthClient, TokenStore, CallbackServer, AuthSession
                — OAuth 2.0 (3LO) flow, token persistence, zero Jira-domain knowledge
src/jira/       JiraClient — API access only, auth-agnostic via injected token getter
src/markdown/   wikiToMarkdown, MarkdownFormatter, CommentBlockParser — pure, no I/O
src/sync/       SyncState, FileWriter, SyncEngine, TrackedKeysConfig — orchestration + persistence
```

## Data flow

```
AuthSession.getAccessToken/getCloudId
        |
        v
JiraClient.getIssue/getComments
        |
        v
MarkdownConverter (wikiToMarkdown, per-field)
        |
        v
CommentBlockParser.mergeComments (diff against existing file)
        |
        v
MarkdownFormatter.buildMarkdown (gray-matter stringify)
        |
        v
FileWriter.write + SyncState.set/save
```

## File layout

```
src/
  auth/
    AtlassianOAuthClient.js   buildAuthorizeUrl, exchangeCodeForToken, refreshToken, getAccessibleResources
    TokenStore.js             load/save/isExpired — ~/.config/jiraFedrunek/oauth-tokens.json, chmod 0600
    CallbackServer.js         local HTTP listener, waitForCode(port)
    AuthSession.js            orchestrates load/refresh/full-flow — DIP boundary for SyncEngine
  jira/
    JiraClient.js             getIssue(key), getComments(key) — baseUrl scoped by injected cloudId getter
  markdown/
    wikiToMarkdown.js         wraps j2m.toM (j2m@1.1.0's real export — spec's `to_markdown` name doesn't exist), stateless
    MarkdownFormatter.js      buildFrontmatter, buildIssueBody, formatComment, buildMarkdown (gray-matter stringify)
    CommentBlockParser.js     parseCommentBlocks, mergeComments — diffs existing file's HTML-comment blocks
  sync/
    SyncState.js              load/get/set/save — sync/.sync-state.json
    FileWriter.js             read/write — filesystem boundary, mockable
    SyncEngine.js             syncIssue(key), syncAll(keys) — orchestrator, constructor-injected deps
    TrackedKeysConfig.js      load/add — jiraFedrunek.toml (committed, not gitignored)
  cli.js                      dispatch(command, args, { authSession, syncEngine, trackedKeysConfig }) — testable CLI logic, no process.* calls
  index.js                    thin shell: parses argv/.env, constructs real AuthSession/SyncEngine/TrackedKeysConfig, calls cli.js dispatch(), owns process.exit

jiraFedrunek.toml             tracked_keys = [...] — committed, team-shared list of "sync with no args" issue keys

sync/
  {ISSUE_KEY}.md              one file per issue, frontmatter + body (spec 5.1-5.3)
  .sync-state.json            per-issue delta-detection state (spec 5.4)

~/.config/jiraFedrunek/
  oauth-tokens.json           access/refresh tokens + cloud_id (spec 5.5) — outside the repo
                              on purpose, not gitignore-dependent; chmod 0600 on write

tests/
  node/                       node:test specs, one file per Test Suite — see docs/testing.md for the full
                              Test Suite / Test Case map (ISTQB-style test plan)
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

**Deviation from spec §7.4:** `AuthSession`'s constructor takes an optional 4th
`options` argument (`{ openUrl, port }`). The spec's full-flow step ("redirect user to
authorize URL") never specified *how* the URL reaches the user; `openUrl` defaults to
`console.log`-ing it and is overridden with the `open` npm package in `index.js` so
`login` actually launches a browser. `port` defaults to `3000` and is overridden from
`JIRA_REDIRECT_URI`'s port in `index.js`. Caught via a dedicated regression test
(`TC-AUTH-SESSION-006`) after noticing `buildAuthorizeUrl`'s result was being discarded.

**Deviation from spec §5.5/§7.2:** `TokenStore`'s default path (wired in `index.js`) is
`~/.config/jiraFedrunek/oauth-tokens.json`, not `sync/.oauth-tokens.json` inside the repo
as the spec's file layout shows. Relying on `.gitignore` alone to keep tokens out of git
is fragile (a stray `git add -A`, a deleted gitignore line); a user-level config dir
can't be committed to this repo at all. `TokenStore.save()` also `chmod`s the file to
`0600` (owner read/write only) — see `docs/testing.md` `TC-AUTH-TOKENSTORE-006/007`.
This is the file-based tier of the industry-standard options; see
`docs/features/20260902-oauth-keyring-integration-proposal.md` for the OS-keychain tier
(not yet implemented).

**`TrackedKeysConfig` and the `track` command (not in spec §7 — the ad-hoc-vs-permanent
distinction between "sync one issue right now" vs. "keep syncing this issue every run"):**
`jiraFedrunek sync PROJ-123` stays ad-hoc — it syncs exactly the keys given and doesn't
persist them. `jiraFedrunek track PROJ-123` adds `PROJ-123` to `tracked_keys` in
`jiraFedrunek.toml` (repo root, committed — team-shared, not a secret) via `add(keys)`.
`jiraFedrunek sync` with *no* keys loads `tracked_keys` from that file and syncs all of
them — that's "permanent" sync, triggered manually or from cron/a systemd timer (no
daemon/scheduler is built into this project). Uses `smol-toml` (same library as
szkrabok) for parse/stringify, pinned exact per `docs/development.md#dependency-pinning`.

**`cli.js` vs `index.js` split (not in spec §7, added for testability):** `cli.js`
exports a pure `dispatch(command, args, deps)` that takes an already-built
`authSession`/`syncEngine` and returns a result object or throws — no `process.argv`,
`process.exit`, or `.env` parsing. `index.js` is the thin, untested-by-design shell:
it loads `.env`, constructs the real `AtlassianOAuthClient`/`TokenStore`/
`CallbackServer`/`AuthSession`/`JiraClient`/`SyncState`/`FileWriter`/`SyncEngine`
graph, and calls `dispatch()`. This mirrors why `SyncEngine`/`AuthSession` take
constructor-injected deps in the first place — `cli.js` is the piece that's actually
unit-testable; `index.js` is glue.

## Module ownership

Per spec §7, each module has exactly one responsibility (SRP) and depends only on
abstractions passed via constructor injection (DIP) — never reaches for global state
or another module's internals directly:

| Module | Responsibility | Depends on |
|---|---|---|
| `AtlassianOAuthClient` | OAuth wire protocol only | nothing (pure HTTP calls) |
| `TokenStore` | persist tokens across runs | filesystem (`~/.config/jiraFedrunek/oauth-tokens.json`, 0600) |
| `CallbackServer` | local HTTP listener for the redirect | nothing |
| `AuthSession` | get-or-refresh-or-login orchestration | `AtlassianOAuthClient`, `TokenStore`, `CallbackServer` |
| `JiraClient` | Jira REST v2 access | injected `getAccessToken()` / `getCloudId()` (not `AuthSession` directly) |
| `wikiToMarkdown` | wiki markup -> Markdown | `j2m` |
| `MarkdownFormatter` | pure formatting, no I/O | `wikiToMarkdown` |
| `CommentBlockParser` | parse/merge existing file's comment blocks | `MarkdownFormatter.formatComment` (pure string ops otherwise) |
| `SyncState` | `.sync-state.json` persistence | filesystem |
| `FileWriter` | filesystem boundary | filesystem |
| `SyncEngine` | orchestrator | `JiraClient`, `SyncState`, `FileWriter` (constructor injection) |
| `TrackedKeysConfig` | `jiraFedrunek.toml` persistence (tracked issue keys) | filesystem, `smol-toml` |
| `cli.js` (`dispatch`) | command routing, no process/env access | `AuthSession`, `SyncEngine`, `TrackedKeysConfig` (all passed in as `deps`) |

## Non-negotiable invariants

1. `JiraClient` never imports `AtlassianOAuthClient` or `TokenStore` directly — only the `getAccessToken`/`getCloudId` function pair passed at construction (DIP boundary from spec §7.5)
2. `MarkdownFormatter` and `CommentBlockParser` do no I/O — no `fs`, no `fetch` — testable as pure functions
3. `SyncEngine` never calls `fetch` or touches the filesystem directly — only through `JiraClient` and `FileWriter`
4. Comment metadata lives in HTML comments in the body, never in YAML frontmatter — frontmatter is file-scoped only (spec §5.3)
5. `sync/.sync-state.json` is gitignored — never committed. `~/.config/jiraFedrunek/oauth-tokens.json`
   lives outside the repo entirely (not gitignore-dependent) and is written with mode `0600`

## Sync algorithm

See spec §6 for the full step-by-step; summary:

1. `AuthSession.getAccessToken()` — load stored token, refresh if expired, else full OAuth flow
2. Fetch issue, compare `fields.updated` vs stored `issue_updated_at` — skip body regen if unchanged
3. Fetch comments — new `id` appended, changed `updated` replaces the block, missing ids marked `<!-- deleted_at -->`
4. Write file via `gray-matter` stringify, update `.sync-state.json`
