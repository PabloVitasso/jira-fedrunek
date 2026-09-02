---
name: mcp-auth-integration
description: absorb confluence-fetch into jiraFedrunek — one MCP-authenticated tool that fetches both Jira issues and Confluence pages, replacing jiraFedrunek's own OAuth 3LO app and REST v2 fetch, no separate confluence-fetch tool afterward
metadata:
  type: done
  status: done
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/atlassian-mcp-reference.md
---

# Unified Jira + Confluence fetch via MCP (done)

**Status: implemented.** `src/auth/` is deleted, `src/jira/JiraClient.js` is
rewritten against MCP, and `src/confluence/` (`ConfluenceClient`,
`FolderWalker`, `ConfluenceSyncEngine`) is a new port of `confluence-fetch`'s
logic — see [architecture.md](../architecture.md) for the current module map.
One deviation from this doc's original scope: the sibling `../confluence-fetch/`
directory was **not** deleted (left as read-only reference material, per
explicit direction during implementation) — its logic was copied and adapted
into `src/confluence/`, not moved. The remaining "Open issues" below
(pagination past one page, retry/concurrency policy specifics,
markdown-fidelity-for-macros, `mcp-remote` pinning) were accepted as
follow-up risk, not blockers, consistent with this doc's own resolution of
issues #1/#2/#7 below.

## Why

First real-Jira run of jiraFedrunek was blocked on registering our own OAuth 2.0
(3LO) app at `developer.atlassian.com/console/myapps` (client_id/secret, scopes,
callback URL — see `docs/development.md#registering-the-oauth-app`). That's a
manual, per-developer setup step before `npm run login` even works.

The sibling tool `confluence-fetch/` (same repo, `../confluence-fetch`) hits the
same Acme Corp Atlassian tenant (`CLOUD_ID` in `confluence-fetch/constants.js`)
via Atlassian's hosted remote MCP server (`https://mcp.atlassian.com/v1/mcp` —
**still live and working as of 2026-09-02, but Atlassian's current docs
describe `v2/mcp` as the documented endpoint; see "v1 vs v2" in
[atlassian-mcp-reference.md](../atlassian-mcp-reference.md#auth) before
picking an endpoint to build against**), using `mcp-remote` as a local
stdio↔HTTP proxy. Auth is a one-time browser consent
against Atlassian's *own* pre-registered OAuth client — no `developer.atlassian.com`
app registration, no client_id/secret in `.env`, no local callback server. Ran it
(`node cf-fetch.js --page 100000001`) and it worked end to end after one browser
authorization, then reused the same authorization for Jira calls with no second
prompt.

## Decision

**No separation.** jiraFedrunek itself becomes the tool that fetches both Jira
issues and Confluence pages/spaces/folders, over one shared MCP session. This
supersedes the earlier draft of this doc, which only proposed swapping
jiraFedrunek's *internal* auth mechanism while leaving `confluence-fetch/` as a
permanently separate sibling tool — that's explicitly not the goal. Once this
lands, `confluence-fetch/` is deleted from the repo; its logic moves into
`src/confluence/`.

One config file, one output tree, one CLI, one auth session — not two tools
that happen to share a transport.

## Findings that shaped this

Probed the MCP session (via `mcp-remote`, same pattern `confluence-fetch` uses)
for both Confluence and Jira access against the real tenant (`cloudId`
`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, currently only defined in
`confluence-fetch/constants.js`).

1. **One OAuth consent covers both Jira and Confluence.** `tools/list` on a
   single MCP session returns both Confluence tools (`getConfluencePage`,
   `searchConfluenceUsingCql`, `getConfluenceSpaces`, `getPagesInConfluenceSpace`,
   `getConfluencePageFooterComments`, ...) and Jira tools (`getJiraIssue`,
   `searchJiraIssuesUsingJql`, `addCommentToJiraIssue`, `transitionJiraIssue`,
   ...). No second browser prompt calling a Jira tool after a Confluence one —
   this is the technical basis for "no separation": there was never a reason
   for two tools once auth is unified, they're two client modules against the
   same session.
2. **`searchJiraIssuesUsingJql` is the call to standardize on for issues**, not
   `getJiraIssue` — same cost for one key, composable to multiple keys later
   (`sync PROJ-1 PROJ-2`, or the full `tracked_keys` list) without switching
   tools. Confirmed request shape, tested for real against `JIRA-1167`:
   ```json
   {
     "cloudId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
     "jql": "key = JIRA-1167",
     "fields": ["summary","status","issuetype","priority","assignee","reporter",
                "description","comment","labels","fixVersions","components",
                "created","updated","resolutiondate","sprint"],
     "responseContentFormat": "markdown",
     "maxResults": 1
   }
   ```
   `fields` filtering works server-side (only requested fields came back —
   `sprint` was silently omitted since this issue has none, not an error).
   `comment.comments` comes back **inline** in the same call (empty array here,
   this issue has no comments yet) — no separate comments call needed, unlike
   Confluence footer comments.
3. **`description`/`comment.body` come back as flattened Markdown text**
   (`**Story**`, `* bullet`), not Jira wiki markup and not raw ADF — same shape
   whether or not `responseContentFormat: "markdown"` is passed. `self` link
   resolves to `rest/api/3/issue/117120` — MCP talks to Jira's **v3** API
   internally. `getConfluencePage(contentFormat: "markdown")` similarly returns
   ready-to-write Markdown (confirmed via the real `cf-fetch.js` run) — both
   products land in the same output shape (Markdown text) through this one
   transport, which is what makes a shared `MarkdownFormatter`/`FileWriter`
   layer for both viable.

## Scope: absorbing confluence-fetch into jiraFedrunek

```
src/auth/             DELETE — AtlassianOAuthClient.js, TokenStore.js,
                       CallbackServer.js, AuthSession.js all removed
src/mcp/
  McpSession.js        NEW — owns Client/StdioClientTransport lifecycle
                       (connect/cleanup on SIGINT/SIGTERM), mirrors
                       cf-fetch.js's connect block but logged per
                       CLAUDE.md's [ClassName.methodName] step N convention,
                       not confluence-fetch's colored tag logger. Shared by
                       both JiraClient and ConfluenceClient below — this is
                       the one auth/session boundary for the whole tool
src/jira/
  JiraClient.js         REWRITE — getIssue(key) calls
                       McpSession.callTool('searchJiraIssuesUsingJql', {...})
                       with DEFAULT_JIRA_FIELDS (configurable, see below);
                       getComments(key) reads fields.comment.comments from
                       the same response — SyncEngine's two-call pattern
                       (getIssue + getComments) likely collapses to one call;
                       confirm during implementation
src/confluence/        NEW — ports confluence-fetch/cf-fetch.js's logic into
                       proper single-responsibility modules per this
                       project's DIP convention (docs/development.md#adding-a-new-module),
                       instead of one 565-line script:
  ConfluenceClient.js    MCP calls only — getPage(id), getSpaces(keys),
                         getPagesInSpace(spaceId), searchByCql(cql) — auth-
                         agnostic via injected McpSession, mirrors JiraClient's
                         shape
  FolderWalker.js         CQL-ancestor pagination (fetchFolder's descendant
                         walk in cf-fetch.js) — pure orchestration over
                         ConfluenceClient. **Update 2026-09-02: a native
                         depth-parameterized alternative is confirmed to
                         exist, but only on `v2/mcp`, not `v1/mcp`.**
                         Live-called `discover` against `v2/mcp` (real
                         tenant) and got back
                         `getConfluenceContentDescendants(contentId, depth,
                         limit, cursor)` — a real, folder-scoped, native
                         tool that would let `ConfluenceSyncEngine` walk a
                         folder without building CQL at all. It's reached
                         via `executeRead` + `name`, not a directly-named
                         top-level tool. **`v1/mcp` (this proposal's actual
                         target, see open issue #7) has no equivalent** —
                         v1's tool list has no native descendants call,
                         only CQL ancestor queries (confirmed in
                         [atlassian-mcp-reference.md](../atlassian-mcp-reference.md)).
                         **Keep `FolderWalker` as designed for v1** — this
                         native alternative only becomes relevant if/when a
                         `v2/mcp` migration is actually undertaken.
  ConfluenceSyncEngine.js orchestrator — page/folder/space modes, manifest
                         diffing (stale vs up-to-date), bulk-download confirm
                         guard — Confluence's equivalent of SyncEngine, not
                         reusing SyncEngine directly since the diffing key
                         (lastModified per page) and output shape (nested by
                         space/folder) differ from Jira's per-issue model
src/markdown/
  wikiToMarkdown.js      DELETE, and the `j2m` dependency with it — MCP's
                       description/comment text is already Markdown for both
                       products, nothing left to convert
  MarkdownFormatter.js   EXTEND — Jira issue frontmatter/body stays as-is in
                       shape; add page frontmatter (id/title/space/lastModified,
                       matching confluence-fetch's current frontmatter) and a
                       TOC builder (port of cf-fetch.js's buildToc) as new
                       pure functions in this module — no I/O, same rule as
                       today
cli.js / index.js      EXTEND — new commands alongside sync/track/login:
                       `fetch-page <id>`, `fetch-dir <id>`, `fetch-space <key>`
                       (mirrors cf-fetch.js's --page/--dir/--dirs/--pages
                       flags as real subcommands, not argv flags, matching
                       jiraFedrunek's existing dispatch(command, args, deps)
                       pattern in cli.js) — exact command names/flags TBD at
                       implementation time, not decided in this doc
confluence-fetch/      DELETE once parity is reached — no longer a separate
                       tool in the repo
```

### Default field set (Jira)

`JiraClient` takes the field list as a constructor option, not a hardcoded
array — a narrower or wider set may be wanted later. The tested list above
becomes the shipped default when none is passed:

```js
// src/jira/JiraClient.js
export const DEFAULT_JIRA_FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee', 'reporter',
  'description', 'comment', 'labels', 'fixVersions', 'components',
  'created', 'updated', 'resolutiondate', 'sprint',
]

export class JiraClient {
  constructor({ mcpSession, cloudId, fields = DEFAULT_JIRA_FIELDS }) {
    this.mcpSession = mcpSession
    this.cloudId = cloudId
    this.fields = fields
  }

  async getIssue(key) {
    return this.mcpSession.callTool('searchJiraIssuesUsingJql', {
      cloudId: this.cloudId,
      jql: `key = ${key}`,
      fields: this.fields,
      responseContentFormat: 'markdown',
      maxResults: 1,
    })
  }
}
```

## Unifying config, output, and CLI

This is the part the earlier draft of this doc explicitly left unresolved —
resolving it now per "no separation":

- **Config: one `jiraFedrunek.toml`, `cloud_id` at the top level.** Currently
  doesn't exist yet (nothing's tracked). It grows beyond `tracked_keys` (Jira)
  to also hold `cloud_id` and Confluence targets, replacing
  `confluence-fetch/config.js`'s JS constants and
  `confluence-fetch/constants.js`'s `CLOUD_ID`:
  ```toml
  cloud_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"   # tenant id, not a secret
  tracked_keys = ["JIRA-1167"]                          # Jira, existing

  [confluence]
  space_keys = ["ARCHDOCS"]               # was DEFAULT_SPACE_KEYS
  [[confluence.watch_pages]]
  id = "100000001"
  label = "System A → System B Field Mapping & JIRA-172 Scope Analysis"
  [[confluence.watch_dirs]]
  folder_id = "100000002"
  label = "System A Interaction Inventory"
  ```
  `cloud_id` goes in `jiraFedrunek.toml`, not `.env`: it's a tenant identifier
  (visible in every Atlassian API URL already, e.g. `self` links throughout
  the JQL probe response above), not a secret like the OAuth client
  credentials `.env` used to hold. `jiraFedrunek.toml` is already this
  project's "committed, team-shared, non-secret config" file by convention
  (`tracked_keys` already lives there) — putting `cloud_id` in `.env` would
  wrongly imply it's sensitive and reintroduce a manual per-dev setup step
  this whole proposal exists to remove.
- **Output: one tree, one state file with type-keyed sections.**
  `sync/{KEY}.md` (Jira, unchanged) sits alongside a new
  `sync/confluence/{spaceKey}/{id}-{slug}.md` (was
  `confluence-fetch/cache/{spaceKey}/...`). State tracking becomes one file,
  `sync/.sync-state.json`, with top-level `{ issues: {...}, confluence: {...} }`
  sections — `issues` keeps `SyncState`'s existing per-issue-key shape
  (`issue_updated_at` + comment ids) untouched, `confluence` keeps the old
  manifest's per-page-id shape (`lastModified`/`path`/`title`) untouched, just
  co-located instead of two separate files. **Design refinement worth
  adopting at implementation time:** add `version` (Confluence's
  `page.version.number`, an explicit integer revision) alongside the
  existing `lastModified` in the Confluence entry shape, and prefer it as
  the diffing predicate — `{ id, version, lastModified, path, title }`.
  `cf-fetch.js` already fetches a `version` object per page
  (`p.version?.createdAt`, see `cf-fetch.js`'s space-mode listing) but
  currently only reads the timestamp out of it; `version.number` specifically
  wasn't printed/confirmed in this investigation's live tests, so confirm
  it's actually present in the `getPagesInConfluenceSpace` response shape
  before committing to it as the primary key — timestamp-only comparison
  today isn't broken, this is a robustness improvement (avoids clock-skew/
  precision edge cases), not a bug fix. Deliberately *not* one generic
  schema across both resource types: Jira's diffing needs per-comment-id
  tracking, Confluence's needs a flat `lastModified` — forcing both into one
  invented shape would be more code for no behavioral benefit. Precedent for
  "one file, per-resource-type sections, no forced-generic schema": Terraform
  state (`resources` list, each entry typed) and `package-lock.json`
  (per-package entries, not a single generic dependency schema). `CONTENTS.md`
  (confluence-fetch's generated index) moves to `sync/confluence/CONTENTS.md`,
  scoped to Confluence — no combined Jira+Confluence index in this pass.
- **CLI: one dispatcher, Confluence nested under one noun.** `cli.js`'s
  existing `dispatch(command, args, deps)` gains a `confluence` command whose
  first arg is a sub-verb, rather than confluence-fetch remaining a
  flag-driven script or Confluence getting its own set of flat top-level
  commands:
  ```
  jiraFedrunek sync JIRA-1167              # Jira, existing, unchanged
  jiraFedrunek track JIRA-1167             # Jira, existing, unchanged
  jiraFedrunek confluence page <id>       # was: node cf-fetch.js --page <id>
  jiraFedrunek confluence dir <id>        # was: --dir <id>
  jiraFedrunek confluence dirs            # was: --dirs
  jiraFedrunek confluence pages           # was: --pages (watch list)
  jiraFedrunek confluence sync            # was: default space mode
  ```
  This is the `gh <noun> <verb>` / `kubectl get <resource>` / `aws <service>
  <verb>` pattern — one tool, resource-type nouns group related verbs instead
  of the top-level command namespace growing flat and crowded as more
  Confluence verbs get added. One argv parser, one `dispatch()`, one auth
  bootstrap (`McpSession` constructed once in `index.js`, passed to both
  `JiraClient` and `ConfluenceClient`) — lowest long-term maintenance surface,
  and consistent with `cli.js`/`index.js`'s existing split (pure dispatch vs.
  thin process-owning shell).
- **One MCP session per invocation, still not shared across invocations.**
  Both Jira and Confluence commands spawn their own `npx mcp-remote` subprocess
  per run (via the shared `McpSession`) — this proposal doesn't add a daemon or
  persistent process. They do share `mcp-remote`'s on-disk OAuth token cache,
  so one browser authorization covers every future command, Jira or
  Confluence, until it expires.
- **Dependencies merge into one `package.json`.** Add
  `@modelcontextprotocol/sdk`, `p-limit`, `p-retry` (all exact-pinned per
  `docs/development.md#dependency-pinning` — check real published versions
  before adding). Drop `j2m` (wikiToMarkdown deleted) and `open` (browser
  launch was `AuthSession`'s job, gone with it). Keep `gray-matter`,
  `smol-toml`. `confluence-fetch/package.json`,
  `confluence-fetch/package-lock.json`, and its `node_modules` are deleted
  along with the directory.
- **Logging: jiraFedrunek's step convention, confluence-fetch's color.**
  `CLAUDE.md`'s `[ClassName.methodName] step N: ...` text format applies to
  every new module (`McpSession`, `ConfluenceClient`, `FolderWalker`,
  `ConfluenceSyncEngine`) — non-negotiable, it's the only debugging layer this
  project has. But confluence-fetch's `isTTY`-gated ANSI palette
  (`cf-fetch.js:39-65` — ANSI codes for cyan/green/yellow/red/etc., disabled
  when not a TTY) is a display layer on top of text, not a competing text
  format, so it merges cleanly: keep the bracketed method-step text, wrap it in
  the same color-if-TTY treatment. E.g. a small shared `log(color, text)`
  helper used by every step-log call, not a per-tag logger like
  confluence-fetch's `log.fetch(...)`/`log.auth(...)` (that API is
  tag-shaped, ours is method-shaped — don't port the API, just the ANSI/TTY
  mechanics):
  ```js
  const color = process.stdout.isTTY ? { cyan: '\x1b[36m', reset: '\x1b[0m', ... } : null
  const step = (c, text) => console.log(color ? `${color[c]}${text}${color.reset}` : text)
  step('cyan', '[McpSession.connect] step 1: opening MCP transport')
  ```
- **Tests: one convention.** `tests/node/<name>.test.js` per new module,
  constructor-injected fakes (`docs/development.md#adding-a-new-module`).
  confluence-fetch currently has zero tests — nothing from it is exempt once
  it's inside jiraFedrunek. `McpSession`'s own network layer needs to be
  fakeable (e.g. inject a `callTool` function or a fake MCP `Client`) so
  `JiraClient`/`ConfluenceClient` tests don't need a live Atlassian connection
  — shape of that fake isn't decided in this doc.
- **Docs.** `docs/architecture.md`'s layer overview, data flow, file layout,
  module ownership table, and non-negotiable invariant #1 all get rewritten
  around this once implementation starts — not done here. `README.md`'s Quick
  start gains the Confluence commands. The OS-keychain proposal
  (`20260902-oauth-keyring-integration-proposal.md`) is superseded — no local
  token file to protect once `TokenStore` is deleted, `mcp-remote` owns its
  own cache.

## Resolved decisions (formerly open questions)

- **Content format: markdown, settled — but keep the client interface
  representation-agnostic, don't hardcode markdown as the content model.**
  `responseContentFormat: "markdown"` for Jira, `contentFormat: "markdown"`
  for Confluence (already how `cf-fetch.js` calls `getConfluencePage`) — no
  ADF path *used* in v1. This was the only option actually tested against
  the real tenant, and it already produces ready-to-write text for both
  products (see Findings above), so there's nothing to gain from also
  *building* an ADF path now. The refinement: `JiraClient`/
  `ConfluenceClient` methods should take `fields`/`contentFormat` as a
  parameter with `markdown` as the default (as `getIssue` already does per
  the "Default field set" section below), not bake `"markdown"` in as an
  unconfigurable literal — cheap to do now, avoids an interface break if a
  richer representation is ever needed for editing/round-tripping. This is
  a scope clarification, not new work: it changes "always pass the literal
  `"markdown"`" to "default to `"markdown"`, pass it as an argument" in the
  method signatures already sketched above. Underlying rationale: Jira's
  canonical rich-text model is ADF (`description`/comment bodies), Markdown
  here is MCP's rendered *export* of that, not Jira's storage format — see
  [atlassian-mcp-reference.md](../atlassian-mcp-reference.md) for the
  confirmed shape. Known fidelity gaps in that rendering (unconfirmed:
  images/attachments, `@mentions`, Confluence macros/panels/expand/status
  lozenges, emojis, deeply nested lists — see that doc's "Markdown
  fidelity" section) are a reason to keep the interface flexible, not a
  reason to build ADF support in this pass — no evidence yet that any
  jiraFedrunek use case is blocked by them.
- **Headless/cron auth: punted for v1, interactive-only.** Every test so far
  (both the Confluence page fetch and both Jira probes) required a browser
  for the first authorization; none tested a non-interactive re-run. Rather
  than guess whether `mcp-remote`'s cached-token refresh works headlessly,
  this proposal ships interactive-only for v1 — `jiraFedrunek sync`/
  `jiraFedrunek confluence sync` require a TTY with browser access the first
  time (and possibly every time, unconfirmed). **This breaks README's
  existing "permanent sync via cron/systemd timer" story** (`README.md`,
  `docs/architecture.md`'s sync algorithm section) until headless auth is
  separately verified and, if needed, designed for — call this out explicitly
  in the README/architecture doc updates during implementation, not silently
  drop the capability.
- **Bulk-download confirm: port as-is.** `confirmBulk` from `cf-fetch.js`
  (TTY gets a `y/N` prompt listing what's about to be fetched; non-TTY without
  an explicit `--yes`/`-y` flag errors instead of silently bulk-fetching)
  carries over unchanged for `jiraFedrunek confluence dirs`/`dir`/`sync`. Jira
  commands (`sync`, `track`) don't need this guard — they already require the
  caller to name specific keys or rely on the explicitly-opted-into
  `tracked_keys` list, there's no "fetch everything in a space" equivalent
  blast radius on the Jira side.

## Open issues (from audit)

An audit of this proposal found the "one probe session" evidence base too thin
to freeze architecture on. Tracking findings here as they get resolved by
further probing (via `confluence-fetch`'s already-authorized MCP session,
reused headlessly — see below) or research. Format: issue, then status +
evidence.

1. **OAuth/session lifecycle under-evidenced.** Original doc drew conclusions
   from one session/one tenant.
   **Partially resolved.** Re-ran `cf-fetch.js --page 100000001` in this
   non-TTY shell (no browser attached) ~1hr after the original interactive
   auth: connected with **zero browser prompts**, reused `mcp-remote`'s
   on-disk token cache (`~/.mcp-auth/mcp-remote-v1/*_tokens.json`,
   `chmod 600`), and completed a real `tools/call` round-trip. That file
   contains `refresh_token` + `expires_at` (~7.9h token lifetime,
   `scope: "openid email profile"` — note the OAuth scope itself says nothing
   about Jira/Confluence access; tool-level authorization is handled
   server-side by Atlassian's MCP host, not by OAuth scope). This directly
   undercuts the "interactive-only, cron breaks" assumption (see #2) — still
   unverified: behavior *after* `expires_at`, revocation, and multi-tenant/
   account-switch cases.
   **New finding, not in original audit list**: on every run (both this one
   and the original), `client.close()` throws an uncaught `DOMException` from
   `mcp-remote`'s `StreamableHTTPClientTransport.close()` during shutdown
   (abort-on-already-closed-socket). Harmless (fires after output is already
   written) but confirms audit finding #3 — there's no defined shutdown/error
   state machine, and this is a concrete transport-layer exception `McpSession`
   needs to swallow deliberately, not accidentally rely on `process.on('exit')`
   ordering to hide.

2. **Headless/cron regression — classify as blocker or accept.**
   **Partially resolved, reverses the pessimistic assumption.** Per #1, a
   second run in a script/cron-like context (no TTY, no browser) succeeded
   using the cached token with no re-prompt. This means "interactive-only"
   should NOT be shipped as a v1 limitation as originally proposed — cron/
   systemd sync likely keeps working as long as the run cadence stays inside
   the token's refresh window. Still open: what happens exactly at/after
   `expires_at` in a headless context (does `mcp-remote` refresh silently via
   `refresh_token`, or does it require a browser?) — needs a test timed past
   expiry, not done here.

3. **`getIssue()` 0/1/>1 semantics — now empirically confirmed.**
   **Resolved.** Ran `searchJiraIssuesUsingJql` for all three cases against
   the real tenant:
   - `key = JIRA-1167` (exists) → `{ issues: [ {...} ], isLast: true }`, length 1.
   - `key = JIRA-9999` (doesn't exist) → `{ issues: [], isLast: true }` —
     empty array, **not an error**. `getIssue()` should treat `issues.length
     === 0` as NotFound.
   - `project = JIRA` with `maxResults: 10` → 10 issues returned, ordinary
     array, no `total` field at the top level of this response shape (only
     nested per-field pagination envelopes like `comment.total` have one).
   The invariant from the audit holds and is now backed by real responses:
   `0 → NotFound`, `1 → return`, `>1 → only expected when the caller
   intentionally passed `maxResults > 1` (multi-key sync), never for a
   single-key `key = X` lookup — so `getIssue(key)` specifically should still
   treat `>1` as `InternalInvariantViolation` since `key = X` is only ever
   satisfied by zero or one issue.

4. **Comment body fidelity — resolved for the tested case, not fully closed.**
   `fields.comment.comments[].body` is returned by
   `searchJiraIssuesUsingJql`/`getJiraIssue` (flattened Markdown with
   `responseContentFormat: "markdown"`); no dedicated comment-read tool
   exists but none appears needed for issues with a handful of comments —
   confirmed against a real 3-comment issue (`JIRA-1194`). Details, including
   `addCommentToJiraIssue`'s ADF requirement for `@mentions`, in
   [docs/atlassian-mcp-reference.md](../atlassian-mcp-reference.md).
   **Still not tested: an issue with a large comment count.** Jira's REST
   v3 `GET /issue/{key}/comment` is documented as paginated; whether
   `searchJiraIssuesUsingJql`'s inline `comment.comments` field silently
   truncates for issues with many comments (vs. an explicit
   `comment.total`-style envelope, similar to how `fields.comment.total`
   already appears in probed responses) is unverified. Find or create a
   Jira issue with 20+ comments and re-test before treating this as fully
   closed — cheap to check, not done in this pass.

5. **Markdown fidelity — partially confirmed with real rich content.**
   Fetched `JIRA-195 OpenAPI Spec: Example Service API`
   (id `100000003`, real Confluence page, 796 lines once written) via
   `getConfluencePage(contentFormat: "markdown")`. Confirmed clean, valid
   Markdown for: fenced code blocks (6 fences, YAML/OpenAPI content) and
   pipe tables (`| # | Item | Correction |` style, multiple rows, inline
   code spans inside cells). No corruption, no leftover ADF/storage-format
   XML. Still **not** verified in any real document: images/attachments,
   user `@mentions`, Confluence macros (panels, expand, status lozenges),
   emojis, nested/mixed lists. Recommend finding or creating one Confluence
   page that exercises those before treating Markdown-fidelity as closed.

6. **Still open, not probed this pass** (no cheap way to test against this
   tenant, or genuinely a design decision rather than a fact to observe):
   - Confluence pagination cursor correctness under >50 results (the two
     `WATCH_DIRS` folders in `config.js` weren't confirmed to exceed one
     page — would need a folder known to have 50+ descendants).
   - Retry/concurrency policy for `p-limit`/`p-retry` (design decision, see
     audit's suggested policy table — not yet written into this doc).
   - Never-retry-mutations rule for `addCommentToJiraIssue`/
     `transitionJiraIssue` (design decision, should just be adopted).
   - State schema versioning + atomic write (design decision, adopt the
     audit's `{ version: 1, issues: {}, confluence: {} }` + temp-file-rename
     suggestion).
   - Page rename/delete/move reconciliation (design decision).
   - `mcp-remote` pinning: currently invoked as `npx -y mcp-remote` in both
     `cf-fetch.js` and the throwaway probes here, which resolved to
     `mcp-remote@0.8.3` this session (visible in the MCP `initialize`
     handshake's `clientInfo.name`) — but nothing pins that version; a
     pinned local dependency (per the audit's recommendation) hasn't been
     evaluated against `mcp-remote`'s actual published `package.json` yet.

7. **`v1/mcp` vs `v2/mcp` — resolved as "stay on v1 for now", not a
   blocker, but flagging for future re-evaluation.** Atlassian's current
   docs describe `v2/mcp` as the documented endpoint, not the `v1/mcp` this
   whole investigation (and `confluence-fetch/constants.js`) is built
   against. Live-probed both against the real tenant 2026-09-02 (details in
   [atlassian-mcp-reference.md](../atlassian-mcp-reference.md#auth)):
   - `v1/mcp` is still live and fully functional — every finding in this
     doc and the reference doc remains valid.
   - `v2/mcp` is also live, but requires its **own** separate browser OAuth
     consent — `mcp-remote`'s token cache is scoped per endpoint URL, so
     this is not a config-only swap for every existing developer/cron auth.
   - `v2/mcp`'s tool surface is **structurally different**: 17 directly-
     named tools built around `discover`/`executeRead`/`executeWrite`/
     `executeDestructive` verbs, vs. v1's ~20 named tools. **Update
     2026-09-02, after live-probing `discover` for every operation this
     proposal actually needs: no functional capability loss found.**
     `getPagesInConfluenceSpace` → `listConfluenceContent`,
     `getConfluenceSpaces` → `listConfluenceSpaces`,
     `searchConfluenceUsingCql` → `searchConfluence` (still a top-level
     tool), the two Confluence footer/inline comment tools → one unified
     `listConfluenceComments`, `addCommentToJiraIssue` →
     `addOrEditJiraIssueComment` — all confirmed present, some strictly
     better (native `getConfluenceContentDescendants(depth, ...)` instead
     of CQL ancestor queries, 250-per-page vs. 100 on content listing).
     Full mapping table in
     [atlassian-mcp-reference.md](../atlassian-mcp-reference.md#auth). The
     real migration cost is architectural: most v2 operations are reached
     via `executeRead`/`executeWrite` + a `name` string instead of a
     directly-named tool, so `JiraClient`/`ConfluenceClient` would need a
     small dispatch layer. Every concrete request shape this doc has
     validated (`searchJiraIssuesUsingJql`'s `fields` list,
     `getConfluencePage(contentFormat:"markdown")`, cursor pagination via
     `getPagesInConfluenceSpace`) remains v1-specific and would need each
     `executeRead`-routed op's actual response shape confirmed with one
     real call before writing client code against it — only the *input*
     schemas were fetched via `discover`, not response shapes.
   - `v2/mcp`'s OAuth consent screen requests markedly broader scopes
     (Jira/Confluence/Bitbucket/Loom/Talent/Teams/Goals/Focus/Artifacts,
     read+write+manage+delete) than v1's minimal `openid email profile`.
   **Decision for this proposal: build against `v1/mcp`, as already
   planned** — it's what's tested, it's still live, and there is no
   forced-deprecation timeline for it (confirmed via the official
   `atlassian-mcp-server` GitHub README — v1 "remains functional," v2 is
   only "recommended for new setups"). Revisit only if Atlassian announces
   an actual `v1` deprecation date; don't design speculative `v2` support
   now given there's no capability reason to rush it. Full v1→v2 operation
   mapping, parameter differences, and migration-readiness notes are
   written up separately in
   [20260902-mcp-v2-migration-proposal.md](20260902-mcp-v2-migration-proposal.md)
   so this groundwork isn't lost if a migration is ever revisited.

## Out of scope (this pass)

- Actual code changes — this doc records the decision and the concrete
  request shape to build against; implementation is separate work.
- Committing probe scripts — throwaway, run from `confluence-fetch/`, deleted
  after each use.
