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

## Index of operations

Durable how/why content lives in `docs/` and `README.md`, not here — this file
points to it so it can't drift out of sync with a second copy.

| Topic | Where |
|---|---|
| Auth flow, token cache, `mcp-remote` invocation | [docs/development.md#auth](./docs/development.md#auth), [docs/atlassian-mcp-reference.md#auth](./docs/atlassian-mcp-reference.md#auth), [README.md#auth-storage](./README.md#auth-storage) |
| `sync`/`track` ad-hoc vs. permanent semantics | [README.md#quick-start](./README.md#quick-start), [docs/architecture.md](./docs/architecture.md) — `TrackedKeysConfig`/`ProjectConfig` split |
| Dependency pinning, auditing transitive vulnerabilities | [docs/development.md#dependency-pinning](./docs/development.md#dependency-pinning) |
| Coding style, logging convention | [docs/development.md#coding-style](./docs/development.md#coding-style) |
| Known bugs, workarounds | [docs/bugs/](./docs/bugs/) |
| Module map, data flow, invariants | [docs/architecture.md](./docs/architecture.md) |
| Test plan, status per module | [docs/testing.md](./docs/testing.md) |
