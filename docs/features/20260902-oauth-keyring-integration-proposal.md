---
name: oauth-keyring-integration
description: back TokenStore with the OS keychain (@napi-rs/keyring) instead of a plaintext file, falling back to the current file-based store when unavailable
metadata:
  type: proposal
  status: proposal
  spec_ref: docs/jiraFedrunek-spec-v2.md
---

# OS-keychain token storage (proposal)

## Why

`TokenStore` currently writes tokens to `~/.config/jiraFedrunek/oauth-tokens.json`
(mode `0600`, outside the repo — see `docs/architecture.md`'s spec §5.5/§7.2
deviation note). That's the file-based tier of industry practice. The stronger
tier — what `gh`, `aws-cli`, and most credential managers do — is the OS keychain
(macOS Keychain, Windows Credential Manager, Linux Secret Service), which never
puts the token on disk as plaintext at all.

## Scope

Add `KeyringTokenStore` as a second implementation of the same interface
`TokenStore` already exposes (`load()`, `save(tokens)`, `isExpired()`) — a
drop-in swap per the project's DIP convention (spec §7.2), not a rewrite of
`AuthSession`/`index.js`'s call sites.

```
src/auth/
  TokenStore.js          existing file-based store, unchanged
  KeyringTokenStore.js   new — same interface, backed by @napi-rs/keyring
```

- `KeyringTokenStore.load()` — reads one keychain entry (service: `jiraFedrunek`,
  account: `oauth-tokens`) containing the same JSON shape (`access_token`,
  `refresh_token`, `expires_at`, `cloud_id`); returns `null` if absent
- `KeyringTokenStore.save(tokens)` — `JSON.stringify` then set the keychain entry
- `KeyringTokenStore.isExpired()` — same date-math as `TokenStore`, no behavior change
- `index.js` picks the backend at startup: try `KeyringTokenStore`, catch and fall
  back to `TokenStore` (file-based) — covers Linux boxes with no Secret Service
  daemon (common in containers/CI), which is why this can't be the only backend

## Out of scope (this pass)

- Migrating existing `~/.config/jiraFedrunek/oauth-tokens.json` tokens into the
  keychain automatically — first `login` after upgrading just re-authenticates
- A `--auth-backend` CLI flag — the try/fallback above is automatic, no user
  choice needed for v1

## Dependency

`@napi-rs/keyring` — exact-pinned per `docs/development.md#dependency-pinning`
(check real published versions with `npm view @napi-rs/keyring versions --json`
before adding; do not guess a version). Ships prebuilt native bindings per
platform, no `node-gyp` build step.

## Acceptance

- `KeyringTokenStore` passes the same test shape as `TS-AUTH-TOKENSTORE`
  (load/save round-trip, `isExpired()` true/false/absent) run against a real
  keychain entry (TDD, no mocking the keyring itself — see
  `docs/testing.md#test-approach`)
- `index.js` falls back to `TokenStore` when keyring access throws (e.g. no
  Secret Service daemon), logged via the project's step-logging convention
- `npm test` covers both backends; existing `TS-AUTH-TOKENSTORE` suite is
  unchanged
