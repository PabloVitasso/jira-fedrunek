---
name: mcpc-oauth-keyring-hardening
description: replace npx mcp-remote's plaintext OAuth token cache with @apify/mcpc's OS-keychain-backed persistent session + local proxy, closing the gap the superseded oauth-keyring-integration proposal couldn't reach
metadata:
  type: proposal
  status: decision pending
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/features/20260902-mcp-auth-integration-done.md, docs/features/20260902-oauth-keyring-integration-proposal.md, docs/bugs/20260902-mcp-remote-close-domexception-bug.md, docs/development.md#auth
---

# Harden MCP auth: `mcpc` OS-keychain proxy in place of `mcp-remote` (proposal)

## Why

`docs/features/20260902-mcp-auth-integration-done.md` replaced jiraFedrunek's own
OAuth 3LO app with `npx -y mcp-remote`, which is what `McpSession.js` spawns as a
child process on every `connect()`. `mcp-remote` **always** writes the resulting
OAuth token to a plaintext JSON file — `~/.mcp-auth/mcp-remote-v1/*_tokens.json`,
`chmod 600` — with no keychain option. That's a deliberate, documented limitation
of `mcp-remote` itself, not a gap in jiraFedrunek's code.

`docs/features/20260902-oauth-keyring-integration-proposal.md` (superseded) tried
to attach OS-keychain storage to jiraFedrunek's *own* token file, back when
jiraFedrunek owned `TokenStore`. Once the MCP migration landed, jiraFedrunek
stopped owning any token file at all — there was "nothing left to protect" on
our side, which is why that proposal was marked superseded rather than revived.

**What changed:** the token file that remains (`mcp-remote`'s) is owned by an
external tool we chose to invoke. Swapping *which* external tool we invoke is
back in scope, and unlike the old `TokenStore`-keyring idea, this one doesn't
require jiraFedrunek to write any keyring integration code itself —
[`@apify/mcpc`](https://github.com/apify/mcpc) (npm `@apify/mcpc`, current
version `0.6.0`, Apache-2.0, Node >=22.12.0) already stores OAuth tokens in the
OS keychain via `@napi-rs/keyring`, and exposes an authenticated upstream MCP
session as a local proxy server that any standard MCP client — including
jiraFedrunek's own `McpSession` — can connect to over plain HTTP.

## What `mcpc` verifiably does (read from `apify/mcpc`'s README + `package.json`
on GitHub, `main` branch, 2026-09-02 — not the vendor's marketing docs)

- **Credential storage** (`README.md` "Security" / "Credential protection"
  table): OAuth tokens, bearer tokens, and client secrets go to the OS
  keychain — Linux via the [Secret Service
  API](https://specifications.freedesktop.org/secret-service/) (GNOME
  Keyring / KWallet, works out of the box on a normal desktop session),
  macOS Keychain, Windows Credential Manager. **Headless/CI systems without a
  Secret Service daemon fall back to `~/.mcpc/credentials.json`, mode
  `0600`** — i.e. the same class of protection `mcp-remote` gives today, not
  worse, not silently insecure.
- **Backing dependency**: `package.json` pins `"@napi-rs/keyring": "^1.3.0"`
  (prebuilt native bindings per platform, same library the superseded
  `oauth-keyring-integration` proposal had already selected independently —
  corroborates that pick).
- **Auth flow**: `mcpc login <server>` — full OAuth 2.1 with PKCE, Client ID
  Metadata Documents (CIMD), and Dynamic Client Registration (DCR) fallback,
  same one-time-browser-consent shape jiraFedrunek already uses via
  `mcp-remote`.
- **Sessions are persistent and named**: `mcpc connect <url> @session` starts
  a background **bridge process** (tracked in `~/.mcpc/sessions.json`, one
  Unix-domain socket per session under `~/.mcpc/bridges/`) that holds the
  connection, auto-refreshes the OAuth token, and auto-reconnects on network
  failure — this is a materially different lifecycle from `mcp-remote`,
  which is spawned fresh and torn down on every jiraFedrunek invocation (see
  "Open issues #1" below).
- **The integration point — `--proxy` mode**: `mcpc connect <url> @session
  --proxy [host:]<port>` exposes that authenticated session as a *new* local
  MCP server (defaults to `127.0.0.1` only) that forwards every request
  upstream **without ever exposing the original OAuth token to whatever
  connects to the proxy**. Optional `--proxy-bearer-token <token>` adds a
  second local auth layer. This is exactly the shape `McpSession` needs: a
  local endpoint to point an MCP client transport at, instead of a spawned
  stdio subprocess.

## Proposed architecture change

```
Today:
  McpSession.connect()
    → spawn `npx -y mcp-remote https://mcp.atlassian.com/v1/mcp` (StdioClientTransport)
    → mcp-remote itself does OAuth + owns ~/.mcp-auth/mcp-remote-v1/*_tokens.json (plaintext, 0600)

Proposed:
  One-time, outside any jiraFedrunek run:
    mcpc login https://mcp.atlassian.com/v1/mcp
    mcpc connect https://mcp.atlassian.com/v1/mcp @jira-atlassian --proxy 8091 --proxy-bearer-token <local-secret>
    # bridge process now runs persistently, OAuth token lives in OS keychain

  McpSession.connect()
    → StreamableHTTPClientTransport(http://127.0.0.1:8091, { Authorization: Bearer <local-secret> })
    → no subprocess spawn, no OAuth token ever touches jiraFedrunek's process or disk
```

- `transportFactory` in `McpSession.js` swaps from `defaultTransportFactory`
  (spawns `mcp-remote`) to one constructing a
  `StreamableHTTPClientTransport` (exported from
  `@modelcontextprotocol/sdk`, exact subpath to confirm against `1.30.0` —
  `mcp-remote`'s own bundle already imports this class internally, per the
  stack trace in `docs/bugs/20260902-mcp-remote-close-domexception-bug.md`,
  so it's confirmed to exist in the SDK version we already depend on).
- `MCP_URL` in `src/mcp/constants.js` becomes the local proxy URL
  (`http://127.0.0.1:8091` by default), not `mcp.atlassian.com` directly —
  the real upstream URL moves to the one-time `mcpc connect` command.
- A new local secret (the `--proxy-bearer-token`) is needed for
  `McpSession`'s HTTP headers — this is **not** the Atlassian OAuth token,
  just a loopback-only shared secret; low sensitivity, but still shouldn't
  be a literal in source. Candidate: read from `MCPC_PROXY_TOKEN` env var
  (`.env`, gitignored, consistent with existing `.env.example` pattern) —
  detailed design out of scope for this proposal.

## What does NOT change

- No new dependency in `package.json` — `mcpc` is an external CLI, invoked
  the same way `mcp-remote` is today (`npx` or a pinned global install),
  never `import`ed. jiraFedrunek's dependency-pinning rule
  (`docs/development.md#dependency-pinning`) doesn't apply to it, same as it
  doesn't apply to `mcp-remote` today.
- No change to `JiraClient`/`ConfluenceClient` — both depend on the
  `{ callTool }` shape `McpSession` already provides (DIP,
  `docs/development.md#adding-a-new-module`); only `McpSession`'s transport
  construction changes.
- No change to `cloud_id`/`jiraFedrunek.toml` or any output format.

## Open issues (must be resolved before this can move to "decision: adopted")

1. **Process lifecycle mismatch.** `mcp-remote` needs zero standing
   infrastructure — it starts and dies with each jiraFedrunek run, which is
   what makes today's `sync` work unattended from cron/a systemd timer
   (`docs/development.md#running-locally`). `mcpc`'s proxy mode requires a
   **long-lived bridge process running independently of jiraFedrunek**,
   which means either: (a) a systemd user service supervising `mcpc connect
   ... --proxy`, started once and outliving individual `sync` invocations,
   or (b) `McpSession.connect()` shelling out to `mcpc connect` lazily if no
   session/proxy is already live, and leaving it running after the command
   exits (non-obvious cleanup story — when does the bridge ever get torn
   down?). Neither is designed yet.
2. **Confirm `StreamableHTTPClientTransport`'s exact import path** against
   `@modelcontextprotocol/sdk@1.30.0` (already in `package.json`) —
   presumed but not directly verified in this pass; verify during
   implementation, not guessed here.
3. **Headless/CI fallback parity.** On a machine with no Secret Service
   daemon (containers, some CI runners), `mcpc` falls back to the same
   `0600`-file class of protection `mcp-remote` already provides — so the
   security win is conditional on running on a desktop session with a
   keyring daemon (true for local dev use, not guaranteed for a cron box).
   Confirm the actual deployment target before treating this as a strict
   security upgrade rather than a "better on my laptop, same everywhere
   else" one.
4. **`mcpc` is young and Apify-maintained**, not an Anthropic/Atlassian
   first-party tool (same trust tier `mcp-remote` itself is in). No CVE
   history reviewed as part of this pass — do that before adoption.
5. Does the `--proxy` server correctly forward `cloudId`-scoped `tools/call`
   arguments and the `2025-11-25` protocol version jiraFedrunek already
   negotiates with `mcp.atlassian.com`? Proxy "serves protocol `2025-11-25`
   to its clients regardless of the protocol version negotiated with the
   upstream server" per its README — should be transparent, but untested
   against the real Atlassian endpoint in this pass.

## Acceptance (once open issues are resolved and this is adopted)

- `McpSession` unit tests (`tests/node/mcp-session.test.js`) updated for an
  injected `transportFactory` producing a fake `StreamableHTTPClientTransport`
  target, no real `mcpc`/network in `npm test` — same pattern as today's
  fake stdio transport
- A documented, reproducible way to start/supervise the `mcpc` bridge
  process outside of jiraFedrunek's own run (systemd unit or equivalent),
  added to `docs/development.md#auth`
- Live smoke test repeated (`sync <key>`, `confluence page <id>`) against
  the real Atlassian endpoint through the `mcpc` proxy, same shape as the
  smoke test already run against `mcp-remote` in this session
- `~/.mcp-auth/mcp-remote-v1/*_tokens.json` no longer created by a normal
  `login`/`sync` run; token instead visible in the OS keychain (verify via
  `secret-tool search` on Linux or equivalent)
