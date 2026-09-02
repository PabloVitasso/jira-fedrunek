---
name: comment-order
description: configurable newest-first/oldest-first ordering of an issue's comment blocks in synced Markdown, default newest_first, set via [jira].comment_order in jiraFedrunek.toml
metadata:
  type: proposal
  status: proposal — design agreed via brainstorming, ready for implementation
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/architecture.md, docs/development.md#coding-style
---

# Comment ordering (proposal)

## Executive summary

Today, the comment blocks written to `sync/{PROJECT}/{KEY}.md` are in whatever
order `fields.comment.comments` comes back from the Jira MCP tool call
(`JiraClient.getIssue`) — effectively an implementation detail of the API
response, not a deliberate choice. This proposal adds a `[jira].comment_order`
setting in `jiraFedrunek.toml` (`"newest_first"` or `"oldest_first"`, default
`"newest_first"`) that deterministically orders comments by their `created`
timestamp before they're merged into the file.

## Decisions

1. **Config surface is `jiraFedrunek.toml` only — no CLI flag.** This is a
   stable, project-wide setting, not something that varies per invocation.
   Adding a `--comment-order` override would duplicate the same surface area
   `--json`/`--yes` already occupy for no real benefit — nobody re-syncs the
   same project with a different comment order run-to-run.
2. **Sort key is `created`, not `updated`.** Sorting by `updated` would move an
   edited comment to the newest/oldest end of the list every time someone
   fixes a typo, reshuffling the thread on every edit. Sorting by `created`
   keeps a comment in its original chronological slot even after edits,
   matching how people actually read a comment thread.
3. **Toml shape:**
   ```toml
   [jira]
   comment_order = "newest_first"  # or "oldest_first"; omitted = newest_first
   ```
   Lives under `[jira]` (Jira-comment-specific), parsed by `ProjectConfig`
   (which already owns `cloud_id` + other project-level settings), not
   `TrackedKeysConfig` (scoped specifically to the `tracked_keys` list).
4. **Deleted-comment placement is an explicit known limitation, not fixed
   here.** `CommentBlockParser.mergeComments` already appends comments that
   disappeared from the API response (marked `<!-- deleted_at -->`) at the end
   of the file, regardless of their original position. With ordering added,
   that becomes visibly inconsistent under `newest_first` — a deleted comment
   that was actually the newest still lands at the bottom. Fixing this would
   mean threading sort logic into `mergeComments`'s merge/diff loop itself,
   not just a pre-merge sort — real scope creep for what's meant to be a small
   ordering feature. See "Out of scope" below.
5. **Invalid config values fail fast.** A `comment_order` value that isn't
   `"newest_first"`/`"oldest_first"` throws at `ProjectConfig.load()` time,
   consistent with this project's "no silent fallbacks" coding-style rule —
   not silently defaulted, not silently ignored.

## Current state (verified against the repo, 2026-09-03)

- `SyncEngine.syncIssue` (`src/sync/SyncEngine.js:30`) reads
  `issue.fields.comment?.comments ?? []` and passes it straight to
  `mergeComments` with no sorting step.
- `ProjectConfig.load()` (`src/sync/ProjectConfig.js`) currently returns
  `{ cloudId, confluence }` — no `[jira]` section is parsed at all today
  (`TrackedKeysConfig` reads `[jira].tracked_keys` independently, by design —
  see `docs/architecture.md`'s "`TrackedKeysConfig`/`ProjectConfig` split").
- `SyncEngine`'s constructor already takes an `options` object
  (`{ now, pathForKey }`) purely for injection, defaulting sensibly when
  omitted — `commentOrder` follows the same pattern.
- Existing `tests/node/sync-engine.test.js` fixtures use single-comment
  issues; no test currently asserts multi-comment ordering, so defaulting to
  `newest_first` doesn't break any existing test.

## Architecture

```text
issue.fields.comment.comments (API order, undefined/arbitrary)
   │
   ├─ sortComments(comments, commentOrder)   -- new, in SyncEngine.js
   │    non-destructive: comments.slice().sort(byCreated(direction))
   │    compares new Date(a.created) vs new Date(b.created), not string
   │    compare (handles differing UTC offsets across comments correctly)
   │
   ├─ mergeComments(existingBlocks, sorted, downloadedAt)   -- unchanged
   │    still diffs by comment_id/updated, not position — reordering on
   │    every sync is safe, never causes spurious "changed" detection
   │
   └─ SyncState.setIssue(key, { ..., comment_ids: sorted.map(c => c.id) })
        state and file agree on order
```

`commentOrder` flows: `jiraFedrunek.toml` → `ProjectConfig.load()` →
`buildDependencies()` (`src/index.js`) → `new SyncEngine(..., { pathForKey,
commentOrder })`, the same injection path `pathForKey` already uses.

## Scope

- `src/sync/ProjectConfig.js` — parse `[jira].comment_order`, default
  `'newest_first'`, throw on an invalid value; result shape gains
  `jira: { commentOrder }`
- `src/sync/SyncEngine.js` — new `commentOrder` constructor option (default
  `'newest_first'`), a private `sortComments`/comparator, sort inserted into
  `syncIssue` before `mergeComments`; the same sorted array feeds
  `SyncState.setIssue`'s `comment_ids`
- `src/index.js` — `buildDependencies()` threads `commentOrder` from
  `ProjectConfig.load()` into the `SyncEngine` constructor call
- `jiraFedrunek.toml.example` — documents the new `[jira].comment_order` key
- `README.md`, `docs/jiraFedrunek-spec-v2.md` (§5.3/§7),
  `docs/architecture.md` (module-ownership table) — document the setting and
  its default

## Out of scope (this pass)

- A CLI flag/per-invocation override (see "Decisions" #1)
- Fixing deleted-comment placement to respect `comment_order` (see
  "Decisions" #4) — remains appended-at-end regardless of order
- Sorting by anything other than `created` (e.g. `updated`, author)
- Per-tracked-key overrides (one project-wide setting only)

## Acceptance

- `ProjectConfig.load()`:
  - returns `commentOrder: 'newest_first'` when `[jira].comment_order` is
    absent from the toml
  - returns the configured value when present and valid
  - throws a descriptive error when the value is present but not
    `'newest_first'`/`'oldest_first'`
- `SyncEngine.syncIssue`, given a multi-comment fixture with distinct
  `created` timestamps:
  - with `commentOrder: 'newest_first'` (including the default, no option
    passed), the written file's `<!-- comment_id: ... -->` blocks appear
    newest-`created`-first
  - with `commentOrder: 'oldest_first'`, blocks appear oldest-`created`-first
  - `SyncState.comment_ids` order matches the written file's block order in
    both cases
  - an edited comment (`updated` changed, `created` unchanged) stays in its
    original chronological slot, not moved to the newest/oldest end
  - re-syncing an unchanged issue does not report `status: 'changed'` due to
    reordering alone (idempotency preserved — diffing is still by
    `comment_id`/`updated`, not position)
- `npm run lint`, `npm run format:check`, `npm test` all pass
- `jiraFedrunek.toml.example`, `README.md`,
  `docs/jiraFedrunek-spec-v2.md`, `docs/architecture.md` updated
