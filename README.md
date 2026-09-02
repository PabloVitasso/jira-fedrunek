# jiraFedrunek

Syncs Jira issues + comments and Confluence pages/spaces to local Markdown
files, idempotently, with delta detection. Auth is a one-time browser consent
against Atlassian's hosted MCP server (`mcp.atlassian.com`) via `mcp-remote` —
no OAuth app registration, no personal API token.

## Quick start

```bash
npm install
node src/index.js login                     # one-time browser consent, warms mcp-remote's token cache
node src/index.js sync PROJ-123 PROJ-124     # ad-hoc: syncs just these keys, doesn't persist
node src/index.js track PROJ-123             # permanent: adds PROJ-123 to jiraFedrunek.toml
node src/index.js sync                       # syncs everything in jiraFedrunek.toml's tracked_keys

node src/index.js confluence page 100000001  # fetch one Confluence page by id
node src/index.js confluence dir 100000002   # fetch one tracked folder's descendants
node src/index.js confluence dirs            # fetch every folder in [confluence].watch_dirs
node src/index.js confluence pages           # fetch every page in [confluence].watch_pages
node src/index.js confluence sync            # fetch every page in [confluence].space_keys
```

## Docs

- [docs/architecture.md](./docs/architecture.md) — module map, data flow, file layout
- [docs/development.md](./docs/development.md) — auth, running locally, adding modules
- [docs/jiraFedrunek-spec-v2.md](./docs/jiraFedrunek-spec-v2.md) — source spec this project implements
- [docs/atlassian-mcp-reference.md](./docs/atlassian-mcp-reference.md) — verified facts about Atlassian's hosted MCP server

## Output

```
jiraFedrunek.toml        # cloud_id, tracked_keys, [confluence] targets — commit this, it's team-shared

sync/
  PROJ-123.md
  confluence/
    {spaceKey}/{id}-{slug}.md
    CONTENTS.md
  .sync-state.json        # gitignored — { issues: {...}, confluence: {...} }
```

See spec section 5 for the exact Jira Markdown/frontmatter format.

## Auth storage

No token file in this repo at all. `mcp-remote` (spawned via `npx` per invocation) owns
its own on-disk token cache at `~/.mcp-auth/mcp-remote-v1/*_tokens.json` (`chmod 600`),
shared across every jiraFedrunek command — Jira and Confluence both — after the first
browser consent. See
[docs/features/20260902-mcp-auth-integration-done.md](./docs/features/20260902-mcp-auth-integration-done.md)
for the migration this replaced (jiraFedrunek's own OAuth 3LO app + file-based token
store); the OS-keychain proposal that once targeted that store is superseded.
