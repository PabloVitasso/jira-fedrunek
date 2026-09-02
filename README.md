# jiraFedrunek

> Save your Jira issues and Confluence pages as local Markdown files.

Running it again is safe — it only re-downloads what changed.

## Why use it

* **No complex setup** — no Jira API token, no OAuth app registration.
* **Easy login** — log in once through your browser (via Atlassian's own
  `mcp.atlassian.com` server), then every command reuses that login.
* **Script friendly** — `--json` gets you a clean, single JSON document for
  CI or agent callers.
* **Saves AI tokens** — your coding agent reads plain files instead of
  calling Jira/Confluence live. See [Why it saves AI tokens](#why-it-saves-ai-tokens) below.

## Quick start

```bash
npm install
jiraFedrunek login                     # one-time browser consent, warms mcp-remote's token cache
```

### Jira

```bash
jiraFedrunek sync PROJ-123 PROJ-124     # ad-hoc: syncs just these keys, doesn't persist
jiraFedrunek track PROJ-123             # permanent: adds PROJ-123 to jiraFedrunek.toml
jiraFedrunek sync                       # syncs everything in jiraFedrunek.toml's [jira].tracked_keys
```

### Confluence

```bash
jiraFedrunek cf page 100000001          # fetch one Confluence page by id
jiraFedrunek cf dir 100000002           # fetch one folder and every page inside it
jiraFedrunek cf dirs                    # fetch every folder in [confluence].watch_dirs
jiraFedrunek cf pages                   # fetch every page in [confluence].watch_pages
jiraFedrunek cf sync                    # fetch every page in [confluence].space_keys
```

Every command has a short alias (`l`, `t`, `s`, `cf`, and `cf`'s own `p`/`d`/`ds`/`ps`/`s`) —
run `jiraFedrunek --help` for the full command tree. `npx --no-install` or
`node src/index.js <command>` both still work if the package isn't installed as a
global/local `bin`.

### Configuration

Copy `jiraFedrunek.toml.example` to `jiraFedrunek.toml` to set up tracked Jira
keys and watched Confluence spaces/folders/pages (see [Output](#output) below).

### Scripting / `--json`

Add `--json` (before or after the subcommand) for scripts, CI, or agent callers.
It prints exactly one JSON result to `stdout`, and moves all the normal log
lines to `stderr` so they don't get mixed in:

```bash
result=$(jiraFedrunek sync --json 2>debug.log)
jq empty <<< "$result"   # exactly one valid JSON document, no log lines mixed in
```

Every command returns the same shape of result. The `command` field names
which command ran (`login`, `track`, `sync`, `confluence.page`,
`confluence.dir`, `confluence.dirs`, `confluence.pages`, `confluence.sync`):

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
- [docs/testing.md](./docs/testing.md) — test plan and status per module
- [docs/bugs/](./docs/bugs/) — known issues, repro steps, workarounds

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

## Why it saves AI tokens

If your AI agent talks to Jira/Confluence directly, it pays a token cost
every time: the full list of available tools loaded into its memory, plus
a JSON reply for every question — even the same question twice.

jiraFedrunek skips all of that. It downloads issues and pages once, as
plain text files. Your agent just reads those files. No tool list, no
JSON, no repeat downloads.

**How to use it this way:** run `jiraFedrunek sync` (or `cf sync`) before
your coding session, then point your agent at the `sync/` folder instead
of connecting it to Jira/Confluence MCP.

## Auth storage

No token file is stored in this repo. `mcp-remote` (started fresh by `npx`
each time you run a command) keeps its own token file at
`~/.mcp-auth/mcp-remote-v1/*_tokens.json` (locked down with `chmod 600`).
Every jiraFedrunek command — Jira or Confluence — reuses that same file once
you've logged in once.
