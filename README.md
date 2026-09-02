# jiraFedrunek

Syncs Jira issues + comments and Confluence pages/spaces to local Markdown
files, idempotently, with delta detection. Auth is a one-time browser consent
against Atlassian's hosted MCP server (`mcp.atlassian.com`) via `mcp-remote` —
no OAuth app registration, no personal API token.

## Quick start

```bash
npm install
jiraFedrunek login                     # one-time browser consent, warms mcp-remote's token cache
jiraFedrunek sync PROJ-123 PROJ-124     # ad-hoc: syncs just these keys, doesn't persist
jiraFedrunek track PROJ-123             # permanent: adds PROJ-123 to jiraFedrunek.toml
jiraFedrunek sync                       # syncs everything in jiraFedrunek.toml's [jira].tracked_keys

jiraFedrunek cf page 100000001          # fetch one Confluence page by id
jiraFedrunek cf dir 100000002           # fetch one tracked folder's descendants
jiraFedrunek cf dirs                    # fetch every folder in [confluence].watch_dirs
jiraFedrunek cf pages                   # fetch every page in [confluence].watch_pages
jiraFedrunek cf sync                    # fetch every page in [confluence].space_keys
```

Every command has a short alias (`l`, `t`, `s`, `cf`, and `cf`'s own `p`/`d`/`ds`/`ps`/`s`) —
run `jiraFedrunek --help` for the full command tree. `npx --no-install` or
`node src/index.js <command>` both still work if the package isn't installed as a
global/local `bin`.

### Scripting / `--json`

Add `--json` (before or after the subcommand) for scripts, CI, or agent callers —
it's a machine-readable output *protocol*, not a quiet mode. It gets you exactly
one JSON document on `stdout`, with all step-log diagnostics moved to `stderr`
instead of being interleaved:

```bash
result=$(jiraFedrunek sync --json 2>debug.log)
jq empty <<< "$result"   # exactly one valid JSON document, no log lines mixed in
```

Every command's output is wrapped in the same envelope, `command` naming the verb
that ran (`login`, `track`, `sync`, `confluence.page`, `confluence.dir`,
`confluence.dirs`, `confluence.pages`, `confluence.sync`):

```jsonc
{"ok":true,"command":"sync","data":{"status":"synced","results":[...]}}

// a failing command still emits one document, exit code 1, nothing thrown
{"ok":false,"command":"sync","error":{"code":"COMMAND_FAILED","message":"..."}}
```

## Docs

- [docs/architecture.md](./docs/architecture.md) — module map, data flow, file layout
- [docs/development.md](./docs/development.md) — auth, running locally, adding modules
- [docs/jiraFedrunek-spec-v2.md](./docs/jiraFedrunek-spec-v2.md) — source spec this project implements
- [docs/atlassian-mcp-reference.md](./docs/atlassian-mcp-reference.md) — verified facts about Atlassian's hosted MCP server

## Output

```
jiraFedrunek.toml        # cloud_id, [jira].tracked_keys, [confluence] targets — gitignored, can contain
                          # real project/space/page ids; copy from jiraFedrunek.toml.example (committed template)

sync/
  PROJ/PROJ-123.md
  confluence/
    {spaceKey}/{id}-{slug}.md
    CONTENTS.md
  .sync-state.json        # gitignored — { issues: {...}, confluence: {...} }
```

See spec section 5 for the exact Jira Markdown/frontmatter format.

## Auth storage

No token file in this repo is stored.

 `mcp-remote` (spawned via `npx` per invocation) owns its own on-disk token cache at `~/.mcp-auth/mcp-remote-v1/*_tokens.json` (`chmod 600`),
shared across every jiraFedrunek command — Jira and Confluence both — after the first browser consent.
