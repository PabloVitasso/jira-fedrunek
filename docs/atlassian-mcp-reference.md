---
name: atlassian-mcp-reference
description: empirically-verified facts about Atlassian's hosted remote MCP server (auth, Jira/Confluence tool surface, response shapes, gaps) — not tied to any adopted architecture
metadata:
  type: reference
  status: not-adopted
  architecture_ref: docs/architecture.md
  source_investigation: docs/features/20260902-mcp-auth-integration-proposal.md
  see_also_v2: docs/features/20260902-mcp-v2-migration-proposal.md
---

# Atlassian MCP: verified facts

Findings from probing Atlassian's hosted remote MCP server
(`https://mcp.atlassian.com/v1/mcp`, via `npx mcp-remote`) against the
Acme Corp tenant (`cloudId aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`). Gathered
while evaluating [20260902-mcp-auth-integration-proposal.md](features/20260902-mcp-auth-integration-proposal.md),
whose migration is **not adopted** (see that doc's status) — this doc exists
because the facts below outlast that decision and apply to any future
Atlassian-MCP work, in this project or elsewhere. Not a design doc: no
architecture, no file layout, no recommendations — see
[architecture.md](architecture.md) for jiraFedrunek's actual (OAuth 3LO +
REST v2) design. Every claim here is either a direct quote from a real tool
response or marked unverified.

## Auth

- One browser OAuth consent, done once via `mcp-remote`, covers **both**
  Jira and Confluence tools in the same MCP session — no second prompt
  calling a Jira tool after a Confluence one (or vice versa).
- Token cache: `~/.mcp-auth/mcp-remote-v1/<hash>_tokens.json`, `chmod 600`,
  written by `mcp-remote` itself (not app code). Contains `access_token`,
  `refresh_token`, `expires_at` (observed lifetime ~7.9h), and
  `scope: "openid email profile"` — the OAuth scope says nothing about
  Jira/Confluence; tool-level authorization is enforced server-side by
  Atlassian's MCP host, not by OAuth scope.
- **Headless reuse confirmed**: re-running a client in a non-TTY shell
  (no browser attached) after the initial interactive auth reused the
  cached token with **zero prompts** and completed a real `tools/call`.
  Confirmed within the token's lifetime; NOT confirmed past `expires_at`
  (does `mcp-remote` silently refresh via `refresh_token`, or does it
  require a browser again? — untested).
- Client name in the MCP `initialize` handshake pins the exact
  `mcp-remote` version in use (`clientInfo.name: "<app> (via mcp-remote
  0.8.3)"`) — visible without any extra instrumentation, useful for
  verifying what's actually running.
- On every `client.close()`, `mcp-remote`'s `StreamableHTTPClientTransport`
  throws an uncaught `DOMException` (abort on already-closing socket).
  Cosmetic — fires after real work is done — but it's an unhandled
  exception on the shutdown path, not a documented/handled state.

## Jira tool surface

Full tool list (`tools/list`, filtered to Jira), as observed — treat as a
snapshot, not a contract:

```
getJiraIssue                     addCommentToJiraIssue (write)
editJiraIssue                    transitionJiraIssue (write)
createJiraIssue                  searchJiraIssuesUsingJql
getTransitionsForJiraIssue       lookupJiraAccountId
getJiraIssueRemoteIssueLinks     addWorklogToJiraIssue (write)
getVisibleJiraProjects
getJiraProjectIssueTypesMetadata
getJiraIssueTypeMetaWithFields
```

There is no *dedicated* Jira comment-read tool (no `getJiraIssueComments`),
but comment bodies are readable via `searchJiraIssuesUsingJql`/`getJiraIssue`
with `comment` in `fields` — see below. `addCommentToJiraIssue` (write) also
supports editing an existing comment (`commentId` param) and ADF bodies for
`@mentions` — see below.

### `searchJiraIssuesUsingJql`

Request shape (all fields optional except `cloudId`/`jql`):

```json
{
  "cloudId": "...",
  "jql": "key = JIRA-1167",
  "fields": ["summary", "status", "comment", "..."],
  "responseContentFormat": "markdown",
  "maxResults": 1
}
```

- `fields` is a server-side filter — only requested fields come back;
  fields the issue doesn't have (e.g. no sprint) are silently omitted, not
  an error.
- Zero matches → `{ "issues": [], "isLast": true }` — empty array, **not**
  a thrown error. Confirmed with `key = JIRA-9999` (nonexistent).
- One match → `{ "issues": [ {...} ], "isLast": true }`.
- N matches (`project = JIRA`, `maxResults: 10`) → ordinary array of up to
  N issues. **No top-level `total`/count field** in this response shape —
  only nested per-field envelopes (e.g. `fields.comment.total`) have one.
- `description` and other rich-text fields return as flattened Markdown
  text (`**bold**`, `* bullet`) when an issue has such content — same
  shape whether or not `responseContentFormat: "markdown"` is explicitly
  passed (unconfirmed whether that's a stable guarantee or just today's
  default).
- `self` links resolve to `rest/api/3/issue/<id>` — MCP talks to Jira's
  **v3** REST API internally, regardless of what the caller requests.
- **Reading comments — corrected finding.** `fields.comment.comments[].body`
  **is** returned, confirmed against a real issue with 3 comments
  (`JIRA-1194`), via `searchJiraIssuesUsingJql` and via `getJiraIssue`
  directly. Tested with `responseContentFormat: "markdown"` explicit, and
  with it omitted entirely — **both came back with flattened Markdown
  body text** on this hosted server (`mcp.atlassian.com`); omitting
  `responseContentFormat` was not observed to default to ADF JSON here.
  (A default-is-ADF behavior has been reported for at least one
  *self-hosted* Jira MCP server implementation — e.g. the PyPI
  `mcp-atlassian` package, a different codebase from Atlassian's own
  hosted `mcp.atlassian.com` — so don't assume this default is universal
  across MCP servers claiming Jira/Confluence support; pass
  `responseContentFormat: "markdown"` explicitly regardless, since it's
  cheap insurance either way.) An earlier pass at this investigation
  wrongly concluded no comment-read path exists at all; that was a false
  negative caused by combining `fields: ["comment"]` with
  `expand: "renderedFields"` in the same call — `body` disappears from
  every comment when `expand` is set that way. **Do not combine
  `expand: "renderedFields"` with a `comment` field request** if the body
  is needed; omit `expand` entirely for comment reads. Comment metadata
  (`id`/`author`/`created`/`updated`) is present regardless of `expand`.
- **Writing comments** — `addCommentToJiraIssue(cloudId, issueIdOrKey,
  commentBody, contentFormat)`:
  - `contentFormat: "markdown"` → `commentBody` is plain text/Markdown.
    Works for ordinary comments.
  - `contentFormat: "adf"` → `commentBody` must be a full ADF JSON
    document. **Required for a real `@mention`** — Markdown's
    `[~accountid:...]` syntax is escaped as literal text, not rendered as
    a mention (verified on JIRA-413). Minimal ADF mention skeleton:
    ```json
    {"version":1,"type":"doc","content":[{"type":"paragraph","content":[
      {"type":"mention","attrs":{"id":"<accountId>","text":"@Name","accessLevel":""}},
      {"type":"text","text":" — rest of sentence"}
    ]}]}
    ```
  - `commentId` set → edits that existing comment instead of creating a
    new one.
  - `commentVisibility` → restricts to a group/role (not exercised in any
    project referenced by this doc).

## Confluence tool surface

Tools observed (subset, comment/page related):

```
getConfluencePage                    createConfluenceFooterComment (write)
getConfluenceSpaces                  createConfluenceInlineComment (write)
getPagesInConfluenceSpace
searchConfluenceUsingCql
getConfluencePageFooterComments
getConfluencePageInlineComments
getConfluenceCommentChildren
```

Unlike Jira, Confluence has real comment-*read* tools
(`getConfluencePageFooterComments`, `getConfluenceCommentChildren`) — the
asymmetry with Jira's write-only comment surface is real, not an
oversight in testing.

- `getConfluencePage(contentFormat: "markdown")` returns ready-to-write
  Markdown text directly (no ADF/storage-format XML leftover).
- `searchConfluenceUsingCql` and `getPagesInConfluenceSpace` both paginate
  via a `cursor` param and a `_links.next` URL in the response containing
  the next cursor as a query param — standard cursor pagination, consume
  until `_links.next` is absent. (Mechanism confirmed by reading working
  code in `confluence-fetch/cf-fetch.js`; **not independently verified
  against a folder with >50 real descendants** in this investigation —
  the two folders tested were not confirmed to exceed one page.)

## Markdown fidelity (Confluence → Markdown)

Fetched a real, substantial page (`JIRA-195 OpenAPI Spec: Example Service
API`, 796 lines once written) via `getConfluencePage`:

- **Confirmed clean**: fenced code blocks (6 fences, YAML/OpenAPI
  content), pipe tables (multi-row, inline code spans inside cells).
  No ADF/storage-format corruption.
- **Not verified in any real document tested**: images/attachments,
  `@mentions`, Confluence macros (panels, expand, status lozenges),
  emojis, deeply nested/mixed lists. Treat Markdown fidelity as confirmed
  for prose/code/tables only, unconfirmed for richer macro-based content,
  until a page exercising those is tested.

## External references

Atlassian's own docs, for cross-checking the empirical findings above. Two of
these were spot-fetched and verified during this investigation (marked
**verified 2026-09-02**); the rest are cited but not independently fetched —
treat their claims as pointers to check, not confirmed facts, until fetched.

- [Getting started with the Atlassian Rovo MCP Server](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/) —
  **verified 2026-09-02**. Documents `https://mcp.atlassian.com/v2/mcp` as
  current, doesn't mention `/authv2`. Confirms OAuth 2.1 as primary auth,
  with API-token auth available as an optional alternative.
  **Correction to this doc's own earlier note**: `/v1/mcp/authv2` is in
  fact a real, documented endpoint — see the official GitHub repo entry
  below, which this doc hadn't checked yet when it first called that value
  unverified. Don't trust one Atlassian page's silence on a URL as proof
  the URL doesn't exist; check the authoritative repo/changelog too.
- [`atlassian/atlassian-mcp-server` README (GitHub, official)](https://github.com/atlassian/atlassian-mcp-server) —
  **verified 2026-09-02, the authoritative source for v1/v2 status.**
  - **`v1/mcp` is *not* being sunset.** Both `https://mcp.atlassian.com/v1/mcp`
    and `https://mcp.atlassian.com/v1/mcp/authv2` "remain functional."
    `v2/mcp` is "now the recommended version" for *new* setups, and
    "existing v1 connections automatically start to expose and use v2
    tools" (mechanism/timing not detailed further; not independently
    observed in this session's `v1` probes, which still showed the
    familiar v1 named-tool surface — see the `--dirs` test above run the
    same day). One compatibility note: "incompatible clients may need to
    clear cached client IDs or `.well-known` credentials."
  - **Only confirmed hard deprecation is transport, not the tool API**:
    HTTP+SSE (`v1/sse`) was sunset 2026-06-30 in favor of Streamable HTTP —
    unrelated to the v1-vs-v2 *tool surface* question, but easy to conflate
    with it. `confluence-fetch/constants.js`'s comment ("SSE deprecated
    after 2026-06-30") is about this transport change, not a v1-tools
    sunset warning.
  - Atlassian's own team (community post below) frames this as "likely
    seek to replace v1 with v2 (rather than a full deprecation)," with no
    committed timeline — i.e. **real but currently low migration-urgency
    risk**, not an imminent forced cutover.
- [Preview: Atlassian Rovo MCP v2 (Atlassian Community, official team post)](https://community.atlassian.com/forums/Atlassian-Remote-MCP-Server/Preview-Atlassian-Rovo-MCP-v2/ba-p/3255431) —
  **verified 2026-09-02.** States v2's `discover`/`execute*` design exists
  specifically to cut up-front tool-list context consumption by "more than
  50%" via lazy-loading ("dozens of new tools abstracted behind discover
  and execute"), and that v2 adds "support for attachments, databases,
  whiteboards, and more" in Confluence — a real capability gain over v1,
  not just a reshuffle. No committed GA date.
  **Live-probed 2026-09-02 against the real tenant** (from
  `confluence-fetch/`, which is actively authenticated against `v1/mcp`):
  hitting `v2/mcp` with a fresh `mcp-remote` subprocess did **not** reuse
  the cached `v1/mcp` token — it returned a fresh
  `https://auth.atlassian.com/authorize?...&resource=https%3A%2F%2Fmcp.atlassian.com%2Fv2%2Fmcp`
  URL and blocked on a new browser consent (no browser available in this
  session, so the probe timed out waiting, but the endpoint itself is live
  and correctly speaking the OAuth 2.1 flow — this was not a DNS/connect
  failure). Concretely: **`mcp-remote`'s on-disk token cache is scoped per
  MCP `resource` URL** — migrating `MCP_URL` from `v1/mcp` to `v2/mcp` in
  `constants.js` will force every developer/cron job through one more
  interactive browser authorization, it is not a transparent swap. `v1/mcp`
  itself was reconfirmed still live and fully functional this session (see
  the `--dirs` test below) — Atlassian has not yet sunset it, at least as
  of this date.

  **Major finding, live-authorized against `v2/mcp` 2026-09-02 (separate
  browser consent, real tenant): v2 has a smaller *directly-named* tool
  surface than v1, built around a `discover`/`execute*` dispatch pattern —
  but after probing `discover` for jiraFedrunek's actual needed
  operations, every one of them has a confirmed reachable v2 equivalent.
  No functional capability loss found; the cost of migrating is
  architectural indirection, not missing operations.**

  `tools/list` on `v2/mcp` returned 17 directly-named tools:
  ```
  discover                       getJiraIssue
  executeRead                    getConfluenceContent
  executeWrite                   createConfluenceContent
  executeDestructive             updateConfluenceContent
  search                         createJiraIssue
  searchConfluence                editJiraIssue
  searchJiraIssuesUsingJql        transitionJiraIssue
  atlassianUserInfo               addOrEditJiraIssueComment
  getAccessibleAtlassianResources
  ```
  This is smaller than v1's ~20 named tools because v2 puts most
  less-common operations (238 total in the catalog, per `discover`'s own
  description) behind `executeRead`/`executeWrite`/`executeDestructive` +
  a `name` parameter, resolved via `discover(query)` — confirmed by
  calling `discover` live with three queries relevant to this project:

  | jiraFedrunek need | v1 tool | v2 equivalent (confirmed via live `discover` call) |
  |---|---|---|
  | List all pages in a space | `getPagesInConfluenceSpace` | `listConfluenceContent(type:"page", spaceId, cursor)` — limit up to 250/page (v1: 100) |
  | List spaces by key | `getConfluenceSpaces` | `listConfluenceSpaces(keys, cursor)` |
  | Walk a folder's descendants | CQL `ancestor = "<id>" AND type = page` (`FolderWalker`) | `getConfluenceContentDescendants(contentId, depth, limit, cursor)` — **native, depth-parameterized, not CQL** — this confirms the "prefer native hierarchy over CQL" option noted elsewhere in this doc is real, not speculative |
  | CQL search | `searchConfluenceUsingCql` | `searchConfluence(cql, cursor, limit≤100)` — already a directly-named top-level tool, near-identical shape |
  | Page footer/inline comments | `getConfluencePageFooterComments` + `getConfluencePageInlineComments` (two tools) | `listConfluenceComments(content-id, comment-type: footer\|inline)` — **unified into one op**, plus resolution-status filtering v1 didn't have |
  | Jira comments, issue has ≤20 | inline `fields.comment.comments` | still inline via `getJiraIssue`/`searchJiraIssuesUsingJql` — **not a full loss**, contrary to this doc's earlier draft of this note: `listJiraIssueComments`'s own description states "getJiraIssue embeds at most 20 and cannot page them," implying v2 keeps inline embedding up to that cap |
  | Jira comments, issue has >20 | untested in v1 (no comment-heavy issue tested — see "Open issues" #4 in the proposal doc) | `listJiraIssueComments(issueIdOrKey, startAt, maxResults≤100, orderBy)` — paginated, dedicated tool |
  | Add/edit Jira comment | `addCommentToJiraIssue` | `addOrEditJiraIssueComment` — renamed/merged (add + edit unified) |

  Not yet probed: exact request/response shapes for the `executeRead`-
  routed operations above (only their declared `inputs` schemas were
  fetched via `discover`, not an actual `executeRead` call/response) —
  low risk, since the inputs schema is already concrete and typed, but
  worth one real call each before writing client code against them.

  **Also note:** v2's OAuth consent screen requested a much broader scope
  set than v1's (`openid email profile`) — granular
  read/write/search/delete/manage scopes spanning Jira, Confluence,
  Bitbucket, Loom, Talent, Teams, Goals, Focus, and Artifacts
  (`*:agent-interface` suffixed), even though this probe only exercised
  Jira/Confluence tools. Worth a second look before adopting v2 broadly —
  it's requesting account-wide product access up front, not
  Jira/Confluence-scoped access.
  This v2 session's cached token
  (`~/.mcp-auth/mcp-remote-v1/8a0eb89d34b538e3f06598b9fe28dc4d_tokens.json`)
  is a throwaway probe credential, not used by any script in this repo —
  left cached per instruction, not revoked.
- [Confluence Cloud REST v2 — Page API group](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/) —
  **verified 2026-09-02**. Confirms cursor pagination via `_links.next` /
  `Link` header, and that page responses include `version.number` and a
  top-level `parentId`. Did **not** confirm a `depth` query param on
  `get-pages-in-space` from this fetch — check the live endpoint reference
  before relying on it.
- [Confluence Cloud REST v2 — intro/pagination model](https://developer.atlassian.com/cloud/confluence/rest/v2/intro/) — not fetched this pass.
- [Jira Cloud REST v3 — Issue Search API group](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) — not fetched this pass.
- [Jira Cloud REST v3 — Issue Comments API group](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/) — not fetched this pass; relevant to whether the dedicated comments endpoint is paginated in a way that matters given `searchJiraIssuesUsingJql`'s inline `comment.comments` already covers reads (see above).
- [Jira Cloud REST v3 — intro (ADF)](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) — not fetched this pass.
- atlassian-mcp-server GitHub issues cited in the external review as evidence of Markdown-conversion caveats (media-heavy comment hangs, macro loss) — not fetched or verified this pass; treat as anecdotal until confirmed against this project's own tenant.

## Open / unverified (not tested, not just "probably fine")

- Token behavior at/after `expires_at` in a headless context.
- Token revocation, multi-tenant or account-switch behavior.
- Confluence pagination correctness past one page (>50 results). **Retested
  2026-09-02** by running `node cf-fetch.js --dirs --yes` against both real
  `WATCH_DIRS` folders — still not resolved: "System A Interaction Inventory"
  returned 18 descendants, "Example Folder" returned 6, both well under the
  `limit: 50` page size used by the CQL ancestor query, so `_links.next`
  never appeared in either response. Still need a folder/space with 50+
  real descendants (or a smaller `limit` param temporarily) to exercise the
  cursor-follow path at all.
- Whether `expand: "renderedFields"` dropping comment `body` (see above)
  is specific to that expand value or a broader "some `expand` values
  silently strip fields" pattern — only that one value was tested.
- ADF-mention writing (`addCommentToJiraIssue` with `contentFormat: "adf"`
  and a `mention` node) was not independently re-verified in this
  session's probing — carried over from prior project experience, not
  tested against this specific tenant here.
- Rich Confluence macro fidelity (see above).
