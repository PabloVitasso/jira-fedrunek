---
name: development
description: OAuth app registration, running locally, adding modules, coding style for jiraFedrunek
metadata:
  type: reference
  spec_ref: docs/jiraFedrunek-spec-v2.md
---

# Development

## Contents

- [Doc frontmatter convention](#doc-frontmatter-convention)
- [Dependency pinning](#dependency-pinning)
  - [Auditing and patching transitive vulnerabilities](#auditing-and-patching-transitive-vulnerabilities)
- [Auth](#auth)
- [Running locally](#running-locally)
- [Adding a new module](#adding-a-new-module)
- [Coding style](#coding-style)
- [Linting and formatting](#linting-and-formatting)
- [Open items](#open-items)

## Doc frontmatter convention

Every doc under `docs/` (except the spec itself) starts with YAML frontmatter:

```yaml
---
name: kebab-case-slug            # matches the filename, minus dates/suffixes
description: one-line summary    # what this doc is for, specific enough to skim
metadata:
  type: reference | proposal | done | bug   # reference = architecture/development;
                                             # proposal/done = docs/features/* lifecycle
  status: proposal | active | done          # feature docs only
  spec_ref: docs/jiraFedrunek-spec-v2.md    # section this doc derives from, if any
---
```

**Why:** keeps every doc machine-parseable (grep/parse frontmatter to find "what's
still a proposal" or "what references spec §7") without needing a separate index file.

**How to apply:** when adding a new doc, copy this block and fill in `name`/`description`/
`metadata.type` before writing content. Feature docs additionally track `status` -
flip `proposal` -> `active` -> `done` as work progresses (rename the file's `-proposal`
suffix to `-done` to match, same as szkrabok's convention).

## Dependency pinning

All dependencies in `package.json` are pinned to exact versions - no `^`, `~`, `>=`,
or `*`. This is a deliberate security measure, not an oversight.

**Why:** a semver range (`^1.2.3`) silently installs newer patch/minor releases
without review - one `npm install` on a different day can pull in a different
(potentially compromised or breaking) tarball. An exact pin plus a committed
`package-lock.json` means every install everywhere resolves to the identical
tarball, so the dependency tree is reproducible and auditable.

**How to apply:**
- Never add a dependency with `^`/`~`/`*` in `package.json` - always the exact
  resolved version (e.g. `"j2m": "1.1.0"`, not `"^1.1.0"`)
- `engines.node` and any future `peerDependencies` may use ranges - those express
  compatibility, not a resolved install, and are exempt
- After any `npm install` that touches `package.json`, verify no range crept back in:
  ```bash
  grep -E '"\^|"~|"\*|">="' package.json
  ```
  should print nothing except the `engines.node` line
- Before adding a new dependency, check its real published versions first
  (`npm view <pkg> versions --json`) - don't guess a version number, it may not exist
  (this happened once with `j2m@2.4.0`, which was never published; the real latest
  is `1.1.0`)

### Auditing and patching transitive vulnerabilities

`npm audit` (run in CI, see below) flags vulnerable *transitive* deps - packages
pulled in by something we depend on directly, not something we chose. The fix is
almost never "bump the direct dependency" (that could jump a major version we
haven't reviewed, or simply not exist upstream yet) - it's `overrides` in
`package.json`, pinned exactly the same way direct dependencies are.

**Why:** this happened for real with `mcp-remote@0.8.3` - it bundles its own
`express@4.22.1` -> `body-parser@1.20.4` -> `qs@6.14.2`, all three vulnerable
(moderate/low DoS advisories), while `@modelcontextprotocol/sdk` already carries
a patched `express@5.2.1` tree side by side in the same `node_modules`. Bumping
`mcp-remote` itself wasn't an option (0.8.3 is latest); the vulnerability lives
one level deeper, in packages `mcp-remote` doesn't control either.

**How to apply**, in order, whenever `npm audit` (or Dependabot, see below)
reports something:

1. **Find exactly what's pulling in the vulnerable version** - don't guess or
   run `npm audit fix --force` blind, it can silently rewrite a pinned direct
   dependency to a version you never reviewed:
   ```bash
   npm ls <vulnerable-pkg>            # who resolves to the flagged version, and via what chain
   npm explain <vulnerable-pkg>       # same thing, one dependency-path per resolved version
   npm audit --json                  # machine-readable: .vulnerabilities[<pkg>].range = patched range
   ```
2. **Add a scoped override** - key it to the specific direct dependency that
   drags the vulnerable package in (`"pkg@version"`), not a bare package name,
   so the override can't silently apply somewhere else in the tree it was never
   audited for:
   ```json
   "overrides": {
     "mcp-remote@0.8.3": {
       "body-parser": "1.20.6",
       "qs": "6.16.0"
     }
   }
   ```
3. **Reinstall and confirm**:
   ```bash
   npm install
   npm audit                          # must report 0 vulnerabilities
   npm ls <vulnerable-pkg>            # confirm "overridden" / deduped to the patched version
   ```
4. **Re-run the real thing before trusting it** - an override changes what code
   actually executes inside the overridden package; a clean `npm audit` alone
   doesn't prove `mcp-remote` still works with a body-parser/qs it wasn't tested
   against upstream. Run `npm test`, `npm run login`, and one real `sync <key>`.
5. Commit `package.json` + `package-lock.json` together, same as any other
   dependency change.

This is the same reasoning as exact-pinning direct dependencies above, one
level deeper: don't let a `^`/`~` range - or a vulnerability fix - resolve to
an unreviewed tarball anywhere in the tree, direct or transitive.

**CI enforcement:** `.github/workflows/audit.yml` runs `npm audit --audit-level=moderate`
on every push/PR to `main` and weekly on a schedule, so a newly-disclosed
advisory in an existing (already-pinned) tree gets caught even with no local
`npm install` triggering it. It also re-checks that no `^`/`~`/`*`/`>=` range
crept back into `package.json`. A red run means: follow the four steps above,
don't just re-run the workflow. `.github/dependabot.yml` opens weekly npm and
GitHub Actions update PRs (`versioning-strategy: increase`, so it proposes the
next exact pin rather than widening a range) - review and test each one the
same way (steps 3-4), don't auto-merge.

## Auth

No app registration step. jiraFedrunek talks to Atlassian's hosted MCP server
(`https://mcp.atlassian.com/v1/mcp`) via `npx --no-install mcp-remote` (pinned
exact version in `package.json`, see [Dependency pinning](#dependency-pinning)),
which owns its own OAuth client — the first `McpSession.connect()` in any run opens a browser for
a one-time consent (Jira + Confluence both covered by that single consent).
`mcp-remote` caches the resulting token at
`~/.mcp-auth/mcp-remote-v1/*_tokens.json` (`chmod 600`, outside this repo, not
app-managed) and reuses it silently on subsequent runs, including non-TTY/cron
runs, within the token's lifetime (observed ~7.9h) — see
[docs/atlassian-mcp-reference.md#auth](atlassian-mcp-reference.md#auth) and
[docs/features/20260902-mcp-auth-integration-done.md](features/20260902-mcp-auth-integration-done.md)
for the underlying investigation. Behavior past `expires_at` in a headless
context is unconfirmed — see that proposal's "Open issues #1/#2".

`mcp-remote`'s own child process prints an uncaught `DOMException [AbortError]`
to stderr on every clean shutdown, after all real work is done — cosmetic,
already swallowed on jiraFedrunek's side, see
[docs/bugs/20260902-mcp-remote-close-domexception-bug.md](bugs/20260902-mcp-remote-close-domexception-bug.md).

## Running locally

```bash
npm install
node src/index.js login                    # one-time browser consent, warms mcp-remote's token cache
node src/index.js sync PROJ-123 PROJ-124
node src/index.js confluence page 100000001
```

Re-running `sync` is idempotent — unchanged issues are skipped (spec §6 step 3), only
new/changed comments are written.

`sync PROJ-123` is ad-hoc (syncs just that key, nothing persisted). To keep an issue
synced going forward: `node src/index.js track PROJ-123` (adds it to `[jira].tracked_keys` in
`jiraFedrunek.toml`), then `node src/index.js sync` with no keys syncs everything
tracked — wire that bare `sync` into cron/a systemd timer for "permanent" sync.

## Adding a new module

1. Pick the layer it belongs to (`src/mcp`, `src/jira`, `src/confluence`, `src/markdown`,
   `src/sync`) per [docs/architecture.md — module ownership](./architecture.md#module-ownership)
2. Keep it single-responsibility — if it needs both I/O and formatting logic, split it
3. Wire it into `SyncEngine`/`ConfluenceSyncEngine` via constructor injection, never via a
   module-level singleton import. `JiraClient`/`ConfluenceClient` depend on a
   `{ callTool }` shape, not the `McpSession` class directly
4. Add a `tests/node/<name>.test.js` — pure modules (`markdown/*`) need no mocks;
   I/O modules (`sync/*`, `mcp/*`, `jira/*`, `confluence/*`) take injected fakes

## Coding style

- **No repeated string literals for dispatch.** If a string controls branching in more
  than one place, put it in a registry/map keyed by that string
- **Fail fast — no silent fallbacks.** Don't substitute `?? {}` / `?? []` for data that
  should always be present (e.g. `fields.updated` on an issue). Let it throw
- **Early exit only — no late exit.** Guard the exceptional/short-circuit case first
  and return, instead of wrapping the main-path logic in `if (normalCase) { ... }`.
  The body after the guard should read as the unindented happy path, not a nested
  branch — see `syncDir`/`syncSpaces` in `src/confluence/ConfluenceSyncEngine.js`,
  which guard on `stats.aborted` and return before the main-path logic instead of
  nesting it inside `if (!stats.aborted)`
- **No boolean flag parameters.** A parameter like `function sync(keys, force)` where
  `force` selects between two internal code paths is a hidden late-exit branch in
  disguise. Split into two named functions (or a strategy picked by the caller) instead
  of threading a boolean through — see `alwaysConfirmBulk`/`promptConfirmBulk` in
  `src/index.js` replacing the old `makeConfirmBulk(yes)`
- **Extract-and-check untrusted external data, even without aborting.** When a value
  comes from Jira/Confluence API responses and downstream code depends on it being
  present (used as a directory name, a comparison key, etc.), don't let it decay
  silently through a chained `a?.b?.c ?? fallback` buried inside a larger expression.
  Pull it into a named variable near the top, check it, and `console.log` when it's
  missing — even if the fallback itself is fine and the function should keep going.
  This makes the gap between "field present" and "field silently defaulted" visible
  in the debug log instead of only showing up as unexplained downstream behavior.
  See `spaceKeyFromWebui` (`src/confluence/webui.js`) and the `createdAt` extraction
  in `ConfluenceSyncEngine.syncSpaces`
- **Bounded loops.** Any loop driven by external state (e.g. a server-provided
  pagination cursor) must have a hard iteration cap, not just an implicit "server
  will eventually stop sending a cursor" assumption — a looping/buggy cursor would
  otherwise hang a cron-run sync forever with no operator visibility. See
  `MAX_PAGINATION_LOOPS` in `FolderWalker.walkDescendants` and
  `ConfluenceSyncEngine.syncSpaces`, which throw past 1000 pagination loops
- **Function length cap.** No function longer than ~60 lines (JPL "Power of Ten" rule
  4 — fits on one printed page). Enforced by `max-lines-per-function` in
  `eslint.config.js`, scoped to `src/**` only (test bodies legitimately run longer)
- **Constructor injection over imports.** Any module that talks to the network or
  filesystem takes its dependencies as constructor args (see spec §7) — this is what
  makes `SyncEngine`/`McpSession` testable without a live Jira/Confluence instance
- **Every method logs its steps.** Each non-trivial method emits one `console.log`
  per logical step (`[ClassName.methodName] step N: ...`), not just entry/exit. This
  is how a sync run is debugged after the fact — there is no other logging layer

## Linting and formatting

```bash
npm run lint          # eslint .
npm run lint:fix       # eslint . --fix
npm run format         # prettier --write "{src,tests}/**/*.js" "*.js"
npm run format:check   # prettier --check "{src,tests}/**/*.js" "*.js"
```

`eslint.config.js` (flat config) and `.prettierrc.json` were adapted from the
sibling `szkrabok` project on 2026-09-02 — its Playwright/chromium-specific
boundary rules (no direct `chromium.launch*`, no stealth imports, the
immutability restrictions on `.push()`/`.splice()`/`delete`) were dropped,
since they encode `szkrabok`'s own architecture, not this project's. `sessions/`
(gitignored Firefox-profile research artifacts, unrelated to jiraFedrunek's
own code) and `sync/` (runtime output) are excluded from both tools. Run
`npm run lint && npm test` before considering any change done, per the
project's [Workflow Rules](../CLAUDE.md#workflow-rules).

## Open items

Carried over from spec §10, minus what the MCP migration already resolved:

- Confirm the Atlassian-hosted MCP server's Jira/Confluence tool surface isn't slated
  for deprecation on the target tenant (`v1/mcp` vs `v2/mcp` — see
  [docs/atlassian-mcp-reference.md](atlassian-mcp-reference.md#auth))
- Attachment/image handling is out of scope for v2; Markdown fidelity for
  images/attachments/macros/mentions is unconfirmed — see
  [docs/atlassian-mcp-reference.md — Markdown fidelity](atlassian-mcp-reference.md#markdown-fidelity-confluence--markdown)
- `mcp-remote` is pinned as a local dependency (`package.json`, exact version) and
  invoked via `npx --no-install mcp-remote` so it resolves the locally installed,
  lockfile-verified copy instead of an ad-hoc registry fetch — see the proposal's
  "Open issues #6" for the prior unpinned state and rationale
- Token behavior at/after `expires_at` in a headless context is unconfirmed
