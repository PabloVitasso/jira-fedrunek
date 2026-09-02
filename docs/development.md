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
- [Registering the OAuth app](#registering-the-oauth-app)
- [Running locally](#running-locally)
- [Adding a new module](#adding-a-new-module)
- [Coding style](#coding-style)
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

## Registering the OAuth app

1. Go to `developer.atlassian.com/console/myapps` and create a new app
2. Enable OAuth 2.0 (3LO)
3. Add scope `read:jira-work` (add `offline_access` too, or `refresh_token` exchange won't work)
4. Set callback URL to match `JIRA_REDIRECT_URI` in `.env` (default `http://localhost:8787/callback`)
5. Copy `client_id` / `client_secret` into `.env` (see `.env.example`)

## Running locally

```bash
npm install
cp .env.example .env      # fill in client id/secret
npm run login              # opens browser, completes OAuth, writes ~/.config/jiraFedrunek/oauth-tokens.json
node src/index.js sync PROJ-123 PROJ-124
```

Re-running `sync` is idempotent — unchanged issues are skipped (spec §6 step 3), only
new/changed comments are written.

`sync PROJ-123` is ad-hoc (syncs just that key, nothing persisted). To keep an issue
synced going forward: `node src/index.js track PROJ-123` (adds it to `tracked_keys` in
`jiraFedrunek.toml`), then `node src/index.js sync` with no keys syncs everything
tracked — wire that bare `sync` into cron/a systemd timer for "permanent" sync.

## Adding a new module

1. Pick the layer it belongs to (`src/auth`, `src/jira`, `src/markdown`, `src/sync`) per
   [docs/architecture.md — module ownership](./architecture.md#module-ownership)
2. Keep it single-responsibility — if it needs both I/O and formatting logic, split it
3. Wire it into `SyncEngine` (or `AuthSession`) via constructor injection, never via a
   module-level singleton import
4. Add a `tests/node/<name>.test.js` — pure modules (`markdown/*`) need no mocks;
   I/O modules (`sync/*`, `auth/*`) take injected fakes

## Coding style

- **No repeated string literals for dispatch.** If a string controls branching in more
  than one place, put it in a registry/map keyed by that string
- **Fail fast — no silent fallbacks.** Don't substitute `?? {}` / `?? []` for data that
  should always be present (e.g. `fields.updated` on an issue). Let it throw
- **Constructor injection over imports.** Any module that talks to the network or
  filesystem takes its dependencies as constructor args (see spec §7) — this is what
  makes `SyncEngine`/`AuthSession` testable without a live Jira instance
- **Every method logs its steps.** Each non-trivial method emits one `console.log`
  per logical step (`[ClassName.methodName] step N: ...`), not just entry/exit. This
  is how a sync run is debugged after the fact — there is no other logging layer

## Open items

Carried over from spec §10:

- Confirm Jira REST v2 `issue`/`comment` endpoints aren't slated for deprecation on the target instance
- `j2m` table conversion — verify multi-column fidelity
- Attachment/image handling is out of scope for v2; add an `AttachmentDownloader` module under `src/markdown/` or `src/jira/` if needed later
- Decide token TTL handling: refresh-on-demand (current default, inside `AuthSession.getAccessToken`) vs refresh-on-startup
