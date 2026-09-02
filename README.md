# jiraFedrunek

Syncs Jira issues + comments to local Markdown files, idempotently, with delta
detection. Auth is OAuth 2.0 (3LO) — browser login + consent, not a personal
API token.

## Quick start

```bash
npm install
cp .env.example .env   # fill in JIRA_CLIENT_ID / JIRA_CLIENT_SECRET
npm run login          # one-time browser OAuth flow, stores tokens in ~/.config/jiraFedrunek/oauth-tokens.json
node src/index.js sync PROJ-123 PROJ-124   # ad-hoc: syncs just these keys, doesn't persist
node src/index.js track PROJ-123           # permanent: adds PROJ-123 to jiraFedrunek.toml
node src/index.js sync                     # syncs everything in jiraFedrunek.toml's tracked_keys
```

## Docs

- [docs/architecture.md](./docs/architecture.md) — module map, data flow, file layout
- [docs/development.md](./docs/development.md) — OAuth app registration, running, adding modules
- [docs/jiraFedrunek-spec-v2.md](./docs/jiraFedrunek-spec-v2.md) — source spec this project implements

## Output

```
jiraFedrunek.toml        # tracked_keys = [...] — commit this, it's a team-shared list

sync/
  PROJ-123.md
  .sync-state.json

~/.config/jiraFedrunek/
  oauth-tokens.json      # chmod 0600, outside the repo — never committed
```

See spec section 5 for the exact Markdown/frontmatter format.

## Auth storage

Tokens are file-based today (`~/.config/jiraFedrunek/oauth-tokens.json`, mode `0600`),
kept out of the repo on purpose rather than relying on `.gitignore` alone. An OS-keychain
backend (no plaintext file at all) is planned — see
[docs/features/20260902-oauth-keyring-integration-proposal.md](./docs/features/20260902-oauth-keyring-integration-proposal.md).
