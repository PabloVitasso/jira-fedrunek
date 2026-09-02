---
name: initial-sync-engine
description: implement OAuth login, Jira fetch, markdown conversion, and idempotent delta sync end to end
metadata:
  type: proposal
  status: proposal
  spec_ref: docs/jiraFedrunek-spec-v2.md
---

# Initial sync engine (proposal)

## Goal

Implement the v2 spec end to end: OAuth 2.0 (3LO) login, Jira REST v2 issue +
comment fetch, wiki-markup -> Markdown conversion, idempotent delta-synced
`sync/{ISSUE_KEY}.md` files.

## Scope

- `src/auth/*` — `AtlassianOAuthClient`, `TokenStore`, `CallbackServer`, `AuthSession` (spec §7.1-7.4)
- `src/jira/JiraClient.js` (spec §7.5)
- `src/markdown/*` — `wikiToMarkdown`, `MarkdownFormatter`, `CommentBlockParser` (spec §7.6-7.8)
- `src/sync/*` — `SyncState`, `FileWriter`, `SyncEngine` (spec §7.9-7.11)
- `src/index.js` — CLI: `login`, `sync <keys...>`

## Out of scope (this pass)

- Attachment/image download (spec §10 — needs `AttachmentDownloader` later)
- Multi-column table fidelity verification for `j2m` (spec §10 — needs manual check against a real instance)

## Acceptance

- `npm run login` completes a real OAuth round trip and writes `sync/.oauth-tokens.json`
- `node src/index.js sync <key>` on a fresh `sync/` dir creates `{key}.md` with correct
  frontmatter + body (spec §5.1-5.2)
- Re-running `sync` on an unchanged issue does not rewrite the file (spec §6 step 3)
- A new comment appends a block; an edited comment replaces its block in place; a
  removed comment is marked `<!-- deleted_at -->` (spec §6 step 4)
