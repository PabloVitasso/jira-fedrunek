# Jira → Markdown Sync — Technical Spec (v2)

## 1. Purpose
Sync Jira issues + comments to local Markdown files, idempotently, with delta detection.

## 2. Stack
- Node.js, native `fetch`
- `j2m` — wiki markup → Markdown
- `gray-matter` — YAML frontmatter read/write
- Jira REST API **v2** (wiki markup output, not ADF), called via OAuth-scoped base URL

## 3. Auth — OAuth 2.0 (3LO)

**Why:** browser redirect + Atlassian login + consent screen required (user-facing authorization, not personal API token).

**Endpoints:**
```
Authorize: https://auth.atlassian.com/authorize
Token:     https://auth.atlassian.com/oauth/token
Resources: https://api.atlassian.com/oauth/token/accessible-resources
API base:  https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2
```

**Flow:**
1. Redirect user to `authorize` URL w/ `client_id`, `scope`, `redirect_uri`, `state`
2. User logs into Atlassian → consent screen ("Allow {app} to access...")
3. Redirect back to `redirect_uri` w/ `code`
4. Exchange `code` → `access_token` + `refresh_token` at `token` URL
5. Fetch `cloudId` via `accessible-resources`
6. Call Jira API using `cloudId`-scoped base URL, `Bearer {access_token}`

**Prerequisite:** register app at `developer.atlassian.com/console/myapps` → `client_id`/`client_secret`, OAuth 2.0 (3LO) config, scopes (`read:jira-work`), callback URL.

**Token refresh:** `refresh_token` exchanged at same `token` URL when `access_token` expired — required for any run beyond token TTL (~1hr).

## 4. File Layout
```
/sync/
  {ISSUE_KEY}.md
  .sync-state.json
  .oauth-tokens.json
```

## 5. Output Format

### 5.1 Issue file — frontmatter (YAML)
```yaml
---
issue_key: PROJ-123
issue_id: 10042
url: https://yoursite.atlassian.net/browse/PROJ-123
status: In Progress
downloaded_at: 2026-09-02T14:03:00Z
issue_updated_at: 2026-09-01T09:12:00Z
sync_version: 1
---
```

### 5.2 Issue file — body
```md
# PROJ-123: Ticket summary title

**Status:** In Progress
**Assignee:** Jane Doe

## Description

<converted markdown body>

---

## Comments

<!-- comment_id: 10088 -->
<!-- author: john.doe -->
<!-- created_at: 2026-08-30T10:00:00Z -->
<!-- downloaded_at: 2026-09-02T14:03:00Z -->

**John Doe** — 2026-08-30 10:00

<converted markdown body>

---
```

### 5.3 Comment metadata
HTML comments (not frontmatter — frontmatter is file-scoped only). Machine-parseable via regex, invisible when rendered.

### 5.4 `.sync-state.json`
```json
{
  "PROJ-123": {
    "issue_updated_at": "2026-09-01T09:12:00Z",
    "comment_ids": [10088, 10091]
  }
}
```

### 5.5 `.oauth-tokens.json`
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "2026-09-02T15:03:00Z",
  "cloud_id": "abc-123-def"
}
```

## 6. Sync Algorithm
1. Authenticate (load stored token → refresh if expired → else full OAuth flow)
2. Fetch issue → compare `fields.updated` vs stored `issue_updated_at`
3. If unchanged → skip issue body regen
4. Fetch comments → for each: new `id` → append; `updated` changed → replace block; missing → mark `<!-- deleted_at -->`
5. Write file (gray-matter stringify) + update `.sync-state.json`

## 7. Module Design (SOLID / DRY)

### 7.1 `AtlassianOAuthClient` — auth flow only (SRP)
```js
class AtlassianOAuthClient {
  constructor(config: { clientId, clientSecret, redirectUri, scopes })
  buildAuthorizeUrl(state: string): string
  async exchangeCodeForToken(code: string): Promise<{ access_token, refresh_token, expires_in }>
  async refreshToken(refreshToken: string): Promise<{ access_token, refresh_token, expires_in }>
  async getAccessibleResources(accessToken: string): Promise<{ id: cloudId, url, name }[]>
}
```

### 7.2 `TokenStore` — persist tokens across runs (SRP)
```js
class TokenStore {
  load(): { access_token, refresh_token, expires_at, cloud_id } | null
  save(tokens: object): void
  isExpired(): boolean
}
```

### 7.3 `CallbackServer` — local HTTP listener for OAuth redirect (SRP)
```js
class CallbackServer {
  async waitForCode(port: number): Promise<{ code, state }>
}
```

### 7.4 `AuthSession` — orchestrates auth (get-or-refresh-or-login), used by SyncEngine (DIP boundary)
```js
class AuthSession {
  constructor(oauthClient: AtlassianOAuthClient, tokenStore: TokenStore, callbackServer: CallbackServer)
  async getAccessToken(): Promise<string>   // handles load/refresh/full-flow internally
  async getCloudId(): Promise<string>
}
```

### 7.5 `JiraClient` — API access only, auth-agnostic via injected token getter (SRP + DIP)
```js
class JiraClient {
  constructor(config: { getAccessToken: () => Promise<string>, getCloudId: () => Promise<string> })
  async getIssue(key: string): Promise<Issue>
  async getComments(key: string): Promise<Comment[]>
  // internally: baseUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/2`
  //             header  = `Authorization: Bearer ${accessToken}`
}
```

### 7.6 `MarkdownConverter` — wiki → md, stateless (SRP)
```js
function wikiToMarkdown(text: string): string   // wraps j2m.to_markdown
```

### 7.7 `MarkdownFormatter` — pure formatting, no I/O (SRP)
```js
function buildFrontmatter(issue, downloadedAt): object
function buildIssueBody(issue): string
function formatComment(comment, downloadedAt): string
function buildMarkdown(issue, comments, downloadedAt): string   // orchestrates above + matter.stringify
```

### 7.8 `CommentBlockParser` — parse existing file's comment blocks (SRP)
```js
function parseCommentBlocks(content: string): Record<commentId, blockText>
function mergeComments(existingBlocks, freshComments, downloadedAt): string[]
```

### 7.9 `SyncState` — persistence for `.sync-state.json` (SRP)
```js
class SyncState {
  load(): void
  get(issueKey: string): { issue_updated_at, comment_ids } | null
  set(issueKey: string, meta: object): void
  save(): void
}
```

### 7.10 `FileWriter` — filesystem boundary (SRP, testable/mockable)
```js
class FileWriter {
  read(path: string): string | null
  write(path: string, content: string): void
}
```

### 7.11 `SyncEngine` — orchestrator, depends on abstractions via constructor injection (DIP)
```js
class SyncEngine {
  constructor(jiraClient: JiraClient, syncState: SyncState, fileWriter: FileWriter)
  async syncIssue(key: string): Promise<{ status: 'unchanged'|'created'|'updated', key: string }>
  async syncAll(keys: string[]): Promise<SyncResult[]>
}
```

## 8. Data Flow
```
AuthSession.getAccessToken/getCloudId
        ↓
JiraClient.getIssue/getComments
        ↓
MarkdownConverter (wikiToMarkdown, per-field)
        ↓
CommentBlockParser.mergeComments (diff against existing file)
        ↓
MarkdownFormatter.buildMarkdown (gray-matter stringify)
        ↓
FileWriter.write + SyncState.set/save
```

## 9. Dependencies
| Package | Role |
|---|---|
| `j2m` | wiki markup → Markdown |
| `gray-matter` | frontmatter parse/stringify |
| native `fetch` | HTTP |
| native `Date` | timestamps |
| native `http` or `express` (minimal) | OAuth callback listener |
| `open` (npm) | launch browser for authorize URL |

No `jira.js` (v3/ADF-only, wrong format target).

## 10. Open Items
- Confirm v2 `issue`/`comment` endpoints not slated for deprecation on target instance
- `j2m` table conversion — verify multi-column fidelity
- Attachment/image handling — out of scope, add `AttachmentDownloader` module if needed later
- Register app in developer.atlassian.com console, obtain `client_id`/`client_secret`
- Decide token TTL handling: refresh-on-demand vs refresh-on-startup
