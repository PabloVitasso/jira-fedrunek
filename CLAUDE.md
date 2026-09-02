# Claude Code - jiraFedrunek

## Docs

- [README.md](./README.md) - what jiraFedrunek is
- [docs/jiraFedrunek-spec-v2.md](./docs/jiraFedrunek-spec-v2.md) - source spec (auth flow, output format, module design)
- [docs/architecture.md](./docs/architecture.md) - module map, data flow, file layout, invariants
- [docs/development.md](./docs/development.md) - auth, running locally, adding modules
- [docs/testing.md](./docs/testing.md) - test plan: test items, suites, cases, status per module
- [docs/atlassian-mcp-reference.md](./docs/atlassian-mcp-reference.md) - verified facts about Atlassian's hosted MCP server (auth, tool surfaces, response shapes, gaps); not tied to jiraFedrunek's actual architecture
- [docs/bugs/](./docs/bugs/) - ISTQB-style bug reports for known issues (repro steps, environment, root cause, workaround)

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

`sync/.sync-state.json` is runtime state, gitignored. Auth is a one-time browser consent against Atlassian's hosted MCP server (`https://mcp.atlassian.com/v1/mcp`), brokered by `npx mcp-remote` — no OAuth app registration, no client id/secret. `mcp-remote` owns its own token cache at `~/.mcp-auth/mcp-remote-v1/*_tokens.json` (`chmod 600`, outside the repo, not app-managed) and reuses it silently across runs. `npm run login` (`McpSession.connect()` + `close()`) just warms that cache. See `docs/features/20260902-mcp-auth-integration-done.md` and `docs/atlassian-mcp-reference.md#auth` for the details. The OS-keychain proposal at `docs/features/20260902-oauth-keyring-integration-proposal.md` is superseded — there's no local token file left for it to protect. A newer proposal, `docs/features/20260902-mcpc-oauth-keyring-hardening-proposal.md`, targets the token file `mcp-remote` itself still owns by swapping it for `@apify/mcpc` (real OS-keychain storage, verified against its current README) — decision pending, not adopted.

## Ad-hoc vs. permanent sync

`sync <keys...>` is ad-hoc — syncs exactly the given keys, nothing persisted. `track <keys...>` adds keys to `[jira].tracked_keys` in `jiraFedrunek.toml` (repo root, gitignored — it holds real project/space/page ids, so treat it as local-only; `jiraFedrunek.toml.example` is the committed template). `sync` with **no** keys loads `[jira].tracked_keys` and syncs all of them — that's "permanent," triggered manually or via cron/systemd timer (no daemon built in).
