---
name: mcp-remote-close-domexception
description: mcp-remote throws an uncaught DOMException [AbortError] from its StreamableHTTPClientTransport.close() on every clean shutdown, after the MCP client's own work has completed
metadata:
  type: bug
  status: mitigated — swallowed by design; confirmed not a version regression, not yet filed upstream
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/atlassian-mcp-reference.md, docs/development.md#auth
---

# BUG-20260902-01: mcp-remote close-time DOMException [AbortError]

## Summary

`npx mcp-remote` logs an uncaught `DOMException [AbortError]: This operation
was aborted` to stderr during its own shutdown sequence, every time
`McpSession.close()` runs — including on a fully successful sync with no
errors of any kind upstream of it.

## Severity / Priority

- **Severity:** Cosmetic (no data loss, no incorrect output, no non-zero
  process exit code observed)
- **Priority:** Low — already mitigated in code, tracked here for visibility
  only

## Environment

| Component | Version |
|---|---|
| Node.js | v24.13.1 |
| `mcp-remote` (via `npx -y mcp-remote`, unpinned) | 0.8.3 |
| `@modelcontextprotocol/sdk` | 1.30.0 |
| MCP endpoint | `https://mcp.atlassian.com/v1/mcp` |
| jiraFedrunek | `src/mcp/McpSession.js` (this repo) |
| OS | Linux 6.11.0-19-generic |

## Preconditions

- `mcp-remote`'s token cache already warm (`~/.mcp-auth/mcp-remote-v1/*_tokens.json`)
  — reproduces on both a fresh browser-consent connect and a cached-token
  connect, so auth state is not a factor
- **At least one `callTool()` must happen between `connect()` and `close()`.**
  `npm run login` (bare `connect()` + immediate `close()`, no tool call) does
  **not** reproduce — 4/4 clean runs. `sync <key>` (connect → callTool →
  close) reproduces 3/3. See "Verification" below.

## Steps to reproduce

1. `node src/index.js sync PROJ-123` (or any valid tracked/ad-hoc key)
2. Let the command run to completion — issue fetch, comment merge, and file
   write all succeed
3. Observe stderr as `McpSession.close()` → `client.close()` runs

## Expected result

Process exits cleanly after `[McpSession.close] step 1: closing MCP client`
with no further output.

## Actual result

`mcp-remote`'s child process prints:

```
[McpSession.close] step 1: closing MCP client
[<pid>]
Shutting down...
[<pid>] Error from remote server: DOMException [AbortError]: This operation was aborted
    at new DOMException (node:internal/per_context/domexception:76:18)
    at AbortController.abort (node:internal/abort_controller:506:18)
    at StreamableHTTPClientTransport.close (.../mcp-remote/dist/chunk-6QT6R6YJ.js:28318:28)
    at cleanup (.../mcp-remote/dist/proxy.js:214:29)
    at Socket.<anonymous> (.../mcp-remote/dist/chunk-6QT6R6YJ.js:30113:11)
    ...
    at async StreamableHTTPClientTransport._startOrAuthSse (.../mcp-remote/dist/chunk-6QT6R6YJ.js:28162:24)
```

Reproduced twice in this session — once after `sync PROJ-123` (2026-09-02
14:22 UTC run) and once after `confluence page 100000001` (same session) —
identical stack both times, always fired after the real work had already
completed and its results already written to disk.

## Root cause (as far as traced)

`mcp-remote`'s `StreamableHTTPClientTransport.close()` calls
`AbortController.abort()` on a socket that's already mid-teardown from the
proxy's own `cleanup()` handler; the resulting `DOMException` is thrown from
inside `undici`'s fetch machinery and is uncaught inside `mcp-remote` itself
— not something jiraFedrunek's `McpSession.close()` call triggers or can
catch, since it originates in the detached child process's own event loop,
after `client.close()` has already been awaited/resolved on our side.

## Workaround (in place)

`McpSession.js` (`#cleanup()`) already treats this as expected noise:

```js
// mcp-remote's StreamableHTTPClientTransport throws an uncaught
// DOMException from close() on an already-closing socket — cosmetic,
// fires after real work is done, swallow deliberately.
this.client?.close().catch(() => {});
```

This swallows the promise rejection on jiraFedrunek's side of the pipe; the
`console.error`-style print above comes from `mcp-remote`'s own process
(spawned via `npx`), which is why it still appears on stderr despite the
catch — there is no hook to suppress the child process's own logging
without patching `mcp-remote` itself.

## Verification (2026-09-02)

A version-regression hypothesis was raised — `0.8.3` was published ~2 days
before this bug was first observed, so it was worth checking whether an
older `mcp-remote` avoids the error. Tested by temporarily pinning
`McpSession.js`'s `defaultTransportFactory` npx arg to `mcp-remote@0.8.2`,
running `sync <tracked-key>` three times, then reverting the pin (no net diff).

| Command | `mcp-remote` | Runs | AbortError |
|---|---|---|---|
| `npm run login` (connect → close, no tool call) | 0.8.3 (unpinned) | 4 | 0/4 |
| `sync <tracked-key>` (connect → callTool → close) | 0.8.3 (unpinned) | 3 | 3/3 |
| `sync <tracked-key>` (connect → callTool → close) | 0.8.2 (pinned) | 3 | 3/3 |

**Conclusion:** not a `0.8.3` regression — `0.8.2` reproduces identically.
The real trigger condition is whether a tool call happened before shutdown,
not the package version. This is consistent with the AbortController/socket
teardown theory in "Root cause" below: `close()` only has something to abort
when a request has actually gone out over the transport.

## Impact on correctness

None observed. Every field/file-write assertion in `npm test` and in the
live smoke tests (`docs/features/20260902-mcp-auth-integration-done.md`)
passed with this exception present; it fires strictly after
`dispatch complete` in every observed run.

## Status

Not filed upstream against `mcp-remote` (no confirmed maintainer bug tracker
checked as of this writing). Confirmed via the "Verification" section above
that this is **not** a `0.8.3`-specific regression — `0.8.2` reproduces
identically, so pinning to an older version is not a viable workaround.
Left as a known, swallowed, cosmetic issue, gated on whether a tool call
happened before shutdown rather than on package version. Revisit if
`mcp-remote` is ever pinned as a direct dependency (see
`docs/development.md#open-items` — "mcp-remote is invoked unpinned") and a
newer version's changelog mentions this class of shutdown fix.
