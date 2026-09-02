# Claude Code - jiraFedrunek

## Docs

- [README.md](./README.md) - what jiraFedrunek is
- [docs/jiraFedrunek-spec-v2.md](./docs/jiraFedrunek-spec-v2.md) - source spec (auth flow, output format, module design)
- [docs/architecture.md](./docs/architecture.md) - module map, data flow, file layout, invariants
- [docs/development.md](./docs/development.md) - OAuth app registration, running locally, adding modules
- [docs/testing.md](./docs/testing.md) - test plan: test items, suites, cases, status per module
- [docs/atlassian-mcp-reference.md](./docs/atlassian-mcp-reference.md) - verified facts about Atlassian's hosted MCP server (auth, tool surfaces, response shapes, gaps); not tied to jiraFedrunek's actual architecture

## Workflow Rules

- **Always ask before committing or pushing.** Never commit or push without explicit user approval
- **Test after every change.** Run the relevant test before considering work done. If a test cannot be run, say so explicitly and ask how to proceed
- **`git reset --hard` is FORBIDDEN.** Never run `git reset --hard` (or any destructive variant: `git checkout .`, `git restore .`, `git clean -f`). If you need to undo a commit, tell the user what you want to do and ask them to approve first.
- **No `jira.js`** - it targets v3/ADF, this project needs v2 wiki-markup output. Do not add it as a dependency.
- **Project name is `jiraFedrunek`** everywhere in docs/CLI - not `jira-md-sync` (an earlier working name that only survives in git history). npm package name is lowercased to `jirafedrunek` per npm rules; bin command is `jiraFedrunek`.
- **Every non-trivial method logs its steps.** One `console.log` per logical step, format `[ClassName.methodName] step N: ...` - see [docs/development.md - Coding style](./docs/development.md#coding-style). This is the only debugging layer for this project, don't skip it.
- **No memory system for this project.** Durable instructions belong in this file or `docs/`, not in Claude's cross-session memory.

## Run Tests

```bash
npm test              # node:test over tests/node/*.test.js
```

## Auth

`sync/.sync-state.json` is runtime state, gitignored. OAuth tokens live at `~/.config/jiraFedrunek/oauth-tokens.json` — outside the repo entirely (not gitignore-dependent), written with `chmod 0600`. Never commit real tokens. `npm run login` drives the one-time browser OAuth flow; subsequent runs refresh silently via `AuthSession`. See `docs/features/20260902-oauth-keyring-integration-proposal.md` for the planned OS-keychain upgrade.

## Ad-hoc vs. permanent sync

`sync <keys...>` is ad-hoc — syncs exactly the given keys, nothing persisted. `track <keys...>` adds keys to `tracked_keys` in `jiraFedrunek.toml` (repo root, committed — not a secret, safe to share). `sync` with **no** keys loads `tracked_keys` and syncs all of them — that's "permanent," triggered manually or via cron/systemd timer (no daemon built in).
