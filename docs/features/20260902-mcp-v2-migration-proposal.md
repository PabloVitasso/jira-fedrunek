---
name: mcp-v2-migration
description: what it would take to move jiraFedrunek's MCP integration from mcp.atlassian.com/v1/mcp to /v2/mcp — tool-by-tool mapping, architecture impact, and everything verified live against the real tenant on 2026-09-02; not adopted, v1 is not being sunset
metadata:
  type: proposal
  status: not adopted — reference material for a future migration, no action needed now
  spec_ref: docs/jiraFedrunek-spec-v2.md
  depends_on: docs/features/20260902-mcp-auth-integration-done.md
  see_also: docs/atlassian-mcp-reference.md
---

# Moving jiraFedrunek's MCP integration from v1 to v2 (proposal)

**Status: not adopted, no action needed now.** This doc exists so a future
migration doesn't start from zero if Atlassian ever sets a `v1` deprecation
date. As of 2026-09-02, `v1/mcp` is confirmed still fully functional with no
announced sunset — see "Why now" below. This doc assumes
[20260902-mcp-auth-integration-done.md](20260902-mcp-auth-integration-done.md)
(jiraFedrunek absorbing `confluence-fetch/` over one shared MCP session) has
been adopted first; everything here describes swapping that design's
`v1/mcp` target for `v2/mcp` afterward, not a standalone change.

## Why this doc exists now, if nothing needs to change now

The question that prompted this: "is there a risk of `v1` being sunset, and
if so, are we prepared?" Researched and live-probed on 2026-09-02, findings
below. Short answer: low urgency, but worth having this doc ready — write it
once while the tenant is authorized and the facts are fresh, rather than
re-deriving all of this under time pressure if Atlassian later announces a
real deadline.

### Deprecation status (verified against primary sources, not the earlier informal review of this proposal that got the endpoint wrong)

- **[`atlassian/atlassian-mcp-server` README, GitHub, official](https://github.com/atlassian/atlassian-mcp-server)** —
  authoritative source. Both `https://mcp.atlassian.com/v1/mcp` and
  `https://mcp.atlassian.com/v1/mcp/authv2` "remain functional." `v2/mcp` is
  "now the recommended version" for **new** setups only. "Existing v1
  connections automatically start to expose and use v2 tools" — mechanism/
  timing not detailed, and **not observed in this session's actual v1
  probes**, which still showed v1's familiar named-tool surface end to end
  (`node cf-fetch.js --dirs --yes` against the real tenant, same day — see
  [atlassian-mcp-reference.md](../atlassian-mcp-reference.md)). One
  compatibility note: "incompatible clients may need to clear cached client
  IDs or `.well-known` credentials."
- **[Atlassian Community: "Preview: Atlassian Rovo MCP v2"](https://community.atlassian.com/forums/Atlassian-Remote-MCP-Server/Preview-Atlassian-Rovo-MCP-v2/ba-p/3255431)**,
  official Atlassian team post. Direct quote from an Atlassian team member
  (Sean Bourke): *"Longer term, we will likely seek to replace our v1 API
  with this one (**rather than a full deprecation**)"* — and that
  complexities around "MCP client OAuth and tool caching" still need
  resolving before any concrete migration plan is finalized. No GA date, no
  deprecation date.
- **[Getting started with the Atlassian Rovo MCP Server](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/)** —
  documents `v2/mcp` as the current recommended endpoint, silent on
  `/authv2` (that silence doesn't mean `/authv2` is fake — see the GitHub
  README above, which does document it; don't treat one page's omission as
  proof a URL doesn't exist).
- **Separate, unrelated, already-fully-sunset item — don't conflate with
  the above:** HTTP+SSE transport (`v1/sse`) was deprecated in favor of
  Streamable HTTP (`v1/mcp`) and stopped being supported 2026-06-30. This
  is a transport-protocol change, not a tool-API version change.
  `confluence-fetch/constants.js`'s comment ("SSE deprecated after
  2026-06-30") refers to this, not to any `v1/mcp` tool-surface sunset.

**Conclusion: real but low-urgency risk.** Atlassian's own stated intent is
to eventually retire `v1` in favor of `v2`, but they've explicitly said this
won't be a hard cutover and have no committed timeline. Nothing in
jiraFedrunek needs to move today. This doc is preparation, not a green
light.

## What changes structurally: `v1`'s named tools vs. `v2`'s `discover`/`execute*`

`v1/mcp`'s ~20 tools are each directly callable by name
(`getConfluencePage`, `searchJiraIssuesUsingJql`, etc. — full list in
[atlassian-mcp-reference.md](../atlassian-mcp-reference.md)). `v2/mcp`
exposes only 17 directly-named tools; most of its ~238-operation catalog
(per `discover`'s own tool description) is reached through three generic
dispatch tools:

```
discover(query)              → finds operation names + input schemas by
                                natural-language query, e.g. "list pages
                                in a confluence space"
executeRead(name, inputs)    → runs any read-only operation by name
executeWrite(name, inputs)   → runs any create/update operation by name
executeDestructive(name, inputs) → runs any delete/irreversible operation
```

Per the official v2 preview announcement, this exists specifically to cut
up-front context consumption: "dozens of new tools abstracted behind
discover and execute, lazy loading tools when required to reduce up-front
context window consumption by >50%." This is an AI-agent-context
optimization, not a capability change — but it does mean any MCP *client
library* (like jiraFedrunek's planned `McpSession`/`JiraClient`/
`ConfluenceClient`) written against v2 needs a dispatch layer instead of
calling named tools 1:1.

`v2/mcp`'s 17 directly-named tools (confirmed via a live `tools/list` call,
2026-09-02):

```
discover                        getJiraIssue
executeRead                     getConfluenceContent
executeWrite                    createConfluenceContent
executeDestructive              updateConfluenceContent
search                          createJiraIssue
searchConfluence                 editJiraIssue
searchJiraIssuesUsingJql         transitionJiraIssue
atlassianUserInfo                addOrEditJiraIssueComment
getAccessibleAtlassianResources
```

## Confirmed operation mapping (v1 → v2)

Every operation jiraFedrunek's design needs was checked against the real
tenant via live `discover` calls on 2026-09-02 — **no functional gap
found**. This table is the concrete migration reference:

| jiraFedrunek need | v1 tool (what's built today / planned) | v2 path | Notes |
|---|---|---|---|
| Get one issue + fields | `getJiraIssue` / `searchJiraIssuesUsingJql` | same names, still top-level tools | request shape differs — see "Parameter differences" below |
| Comments, issue has ≤20 | inline `fields.comment.comments` | inline via `getJiraIssue`/`searchJiraIssuesUsingJql`, same cap | v2 keeps this, not a regression |
| Comments, issue has >20 | untested in v1 (no comment-heavy issue tried) | `executeRead(name:"listJiraIssueComments", {issueIdOrKey, startAt, maxResults≤100, orderBy})` | dedicated, paginated; v1's equivalent behavior at >20 comments is itself unverified (see open issue #4 in the base proposal doc) |
| Add/edit Jira comment | `addCommentToJiraIssue` | `addOrEditJiraIssueComment` (top-level tool) | renamed + merged create/edit into one tool |
| Get a Confluence page | `getConfluencePage(contentFormat:"markdown")` | `getConfluenceContent` (top-level tool) | generalized to any content type (page, blog, live doc, comment, whiteboard, embed, database, folder) |
| List spaces by key | `getConfluenceSpaces` | `executeRead(name:"listConfluenceSpaces", {keys, cursor})` | |
| List all pages in a space | `getPagesInConfluenceSpace` | `executeRead(name:"listConfluenceContent", {type:"page", spaceId, cursor})` | limit up to 250/page vs. v1's 100 |
| Walk a folder's descendants (`FolderWalker`) | CQL `ancestor = "<id>" AND type = page`, hand-rolled cursor loop | `executeRead(name:"getConfluenceContentDescendants", {contentId, depth, limit, cursor})` | **native, depth-parameterized — no CQL needed at all.** This is a real upgrade, not just parity |
| CQL search | `searchConfluenceUsingCql` | `searchConfluence(cql, cursor, limit≤100)` | top-level tool, near-identical shape |
| Page footer/inline comments | `getConfluencePageFooterComments` + `getConfluencePageInlineComments` (two tools) | `executeRead(name:"listConfluenceComments", {content-id, comment-type: "footer"|"inline", resolution-status, ...})` | **unified into one op**, adds resolution-status filtering v1 never had |

## Parameter/behavior differences worth knowing before writing client code

These aren't gaps, but they are real shape differences a `JiraClient`/
`ConfluenceClient` rewrite would need to account for — confirmed by
fetching full `inputSchema`s for every v2 top-level tool, 2026-09-02:

- **Pagination style differs for Jira search.** v1: `maxResults` + implicit
  `isLast` flag on the response. v2 `searchJiraIssuesUsingJql`: explicit
  `nextPageToken` passed back in, page until `isLast` is true (per its tool
  description) — a proper opaque-token cursor, closer to Confluence's model
  than v1's Jira search was.
- **`cloudId` is explicit everywhere in v2, deliberately not auto-resolved.**
  Every v2 tool's `cloudId` param description says: *"cloudId is never
  silently auto-resolved or reused for you — call
  `getAccessibleAtlassianResources` ONCE per session, cache the returned
  cloudId, and pass it explicitly on this and every subsequent call."* v2
  also accepts a site prefix or a raw Jira/Confluence URL in place of the
  UUID, which v1 didn't.
- **Content-format handling is more sophisticated and self-documenting in
  v2.** `getJiraIssue`/`searchJiraIssuesUsingJql`/`listJiraIssueComments`/
  `addOrEditJiraIssueComment` all default to markdown but **automatically
  promote to HTML** for any body containing something markdown can't
  represent (inline media, panels, expands, layouts, statuses, @mentions,
  dates, emoji, smart links) — and report which format you actually got via
  an `appliedContentFormat` field in the response, with a warning. This
  directly addresses the Markdown-fidelity concern raised earlier in this
  investigation (see [atlassian-mcp-reference.md](../atlassian-mcp-reference.md)'s
  "Markdown fidelity" section, which found v1 has no such fallback/flagging
  mechanism — v1 either returns markdown or doesn't, with no signal about
  what was lost).
- **`view` presets replace the flat `fields` array as the primary shaping
  knob** on `getJiraIssue`/`searchJiraIssuesUsingJql`: `compact` (default,
  minimal), `evidence` (fetches and maps custom fields automatically —
  useful for the `sprint`/custom-field cases the base proposal's
  `DEFAULT_JIRA_FIELDS` list has to hand-enumerate today), `full` (complete
  response). An explicit `fields` array still works and overrides the view.
- **`getConfluenceContent`'s `detail` param** (`summary` / `ai_summary` /
  `outline` / `full`) is new — no v1 equivalent. `full` is what jiraFedrunek
  would use (equivalent to v1's only mode); `summary`/`outline` are cheaper
  options with no current use case in this project, but available if a
  future feature (e.g. listing pages without fetching full bodies) wants
  them.
- **`getConfluenceContent` handles Confluence content types v1 never
  touched** — attachments, databases, whiteboards, embeds, folders, comments
  as first-class readable content, per the v2 preview announcement's stated
  goal ("support for attachments, databases, whiteboards, and more"). Out
  of scope for jiraFedrunek's current page/space/folder feature set, but a
  capability gain if ever needed.
- **OAuth consent scope is much broader.** v1's cached token scope is
  `openid email profile` (tool-level authorization enforced server-side,
  not via OAuth scope — see reference doc). v2's consent screen requests
  granular `read`/`write`/`search`/`delete`/`manage` scopes across Jira,
  Confluence, Bitbucket, Loom, Talent, Teams, Goals, Focus, and Artifacts
  (`*:agent-interface` suffixed) — even though jiraFedrunek would only use
  the Jira/Confluence ones. This is a real difference to flag to whoever
  approves the OAuth consent at migration time — it's requesting
  account-wide product access, not Jira/Confluence-scoped access.
- **Token caching is not shared between endpoints.** `mcp-remote`'s on-disk
  token cache is scoped per MCP `resource` URL — confirmed by live-probing
  `v2/mcp` with an already-authorized `v1/mcp` session active: it did not
  reuse the v1 token, it issued a fresh OAuth `authorize` URL and required
  a new browser consent. **Migrating `MCP_URL` in `constants.js` (or its
  jiraFedrunek equivalent post-absorption) forces every developer and every
  cron/systemd job through one more interactive browser authorization** —
  it is not a config-only, zero-friction swap.

## What a v2 migration would actually touch in jiraFedrunek's design

Assuming [20260902-mcp-auth-integration-done.md](20260902-mcp-auth-integration-done.md)
has already landed (so `McpSession`/`JiraClient`/`ConfluenceClient` exist,
targeting v1):

- **`McpSession`**: `MCP_URL` changes from `v1/mcp` to `v2/mcp`. Every
  developer/cron auth needs re-doing (see token-caching note above) — this
  alone means a v2 migration is a coordinated rollout, not a silent
  config-file change.
- **`JiraClient`**: `getIssue()`/`getComments()` need to branch on comment
  count (≤20 stays inline, >20 needs a second `executeRead` call to
  `listJiraIssueComments`) — the base proposal's "SyncEngine's two-call
  pattern likely collapses to one call" assumption would need re-verifying
  specifically for comment-heavy issues, since v1 hasn't been tested with
  one either (open issue #4 in the base proposal). `fields` config option
  could shrink or be replaced by `view: "evidence"` for cases needing
  custom fields, cutting the hand-maintained `DEFAULT_JIRA_FIELDS` list.
- **`ConfluenceClient`**: every method needs to route most calls through
  `executeRead`/`executeWrite` + a `name` string instead of calling a
  named tool directly — effectively a small dispatch table
  (`{getPage: 'getConfluenceContent', listSpacePages:
  {tool:'executeRead', name:'listConfluenceContent'}, ...}`) rather than
  1:1 MCP tool calls. `getPage()` itself stays a direct top-level call
  (`getConfluenceContent`).
- **`FolderWalker`**: could be replaced by a single
  `executeRead(name:"getConfluenceContentDescendants", {contentId, depth,
  limit, cursor})` call per folder — no CQL construction, no ancestor-query
  hand-rolling. This is the single biggest simplification a v2 migration
  would unlock, per the base proposal's own "`FolderWalker` may be
  unnecessary" discussion — confirmed real for v2, still not available on
  v1.
- **State schema, output tree, CLI structure**: unaffected. These are
  jiraFedrunek-side design decisions independent of which MCP endpoint or
  tool-dispatch style is underneath.

## Not yet verified — needed before any real migration work starts

- **Response shapes for every `executeRead`-routed operation.** Only the
  *input* schemas were fetched (via `discover`), not actual response
  bodies — no real `executeRead` call was made this session for
  `listConfluenceContent`, `listConfluenceSpaces`,
  `getConfluenceContentDescendants`, `listConfluenceComments`, or
  `listJiraIssueComments`. Each needs one real call against the tenant to
  confirm its response shape before `ConfluenceClient`/`JiraClient` could
  be written against it.
- **Whether `searchJiraIssuesUsingJql`'s inline comment cap is also 20,
  or different from `getJiraIssue`'s.** `listJiraIssueComments`'s
  description specifically names `getJiraIssue`'s 20-comment cap; whether
  `searchJiraIssuesUsingJql` (used for jiraFedrunek's actual `getIssue()`
  per the base proposal's `key = X` JQL pattern) has the identical cap is
  inferred, not independently confirmed.
- **Whether `mcp-remote`'s "automatically start to expose and use v2
  tools" claim (from the GitHub README) ever manifests on an existing v1
  session** — not observed this session; v1 probes still showed the
  familiar v1 tool list throughout. Unclear if this refers to a future
  behavior, a gradual rollout, or something scoped differently than
  "connecting to `v1/mcp` starts returning v2's tool list."
- **`v2/mcp`'s broader OAuth scope grant** — not evaluated against
  Acme Corp's Atlassian admin policies or whether an org admin would need
  to approve a wider grant than the current v1 minimal-scope token. Worth
  checking before assuming migration is a pure developer-side decision.
- **Whether `v1/mcp/authv2` (distinct from both `v1/mcp` and `v2/mcp`) is
  relevant to jiraFedrunek at all** — confirmed to exist (GitHub README),
  not probed live this session, not clear what it changes relative to
  `v1/mcp`. Possibly the "auth-only" transition endpoint referenced by the
  README's "existing v1 connections automatically start to expose v2
  tools" claim. Worth understanding if that claim's mechanism ever becomes
  load-bearing for a decision.

## Decision

**Do not migrate now.** Build and ship
[20260902-mcp-auth-integration-done.md](20260902-mcp-auth-integration-done.md)
against `v1/mcp` as already planned. Revisit this doc if:

- Atlassian announces an actual `v1/mcp` deprecation date, or
- A concrete jiraFedrunek feature needs something only v2 offers (native
  Confluence attachment/database/whiteboard reads, or the native
  descendants API's simplification of `FolderWalker`), or
- The "automatically start to expose v2 tools" behavior mentioned in the
  GitHub README is observed happening to `v1/mcp` unprompted, which would
  mean this migration is effectively forced regardless of this doc's
  recommendation.

## Out of scope (this pass)

- Actual code changes — this doc is reference material for a future
  decision, not an implementation plan.
- Testing `executeWrite`/`executeDestructive` operations (create/update/
  delete) — this investigation only exercised read paths against the real
  tenant, consistent with the base proposal's "never-retry-mutations"
  caution and general reluctance to mutate real Jira/Confluence data during
  exploratory probing.
- Revoking the throwaway `v2/mcp` OAuth grant used for this investigation's
  probing — left in place per instruction; see
  [atlassian-mcp-reference.md](../atlassian-mcp-reference.md) for the token
  file location if it needs revoking later.
