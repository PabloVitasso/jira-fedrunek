---
name: markdown-linting
description: validate the *synced output* Markdown (Jira issues/comments, Confluence docs written to sync/) is well-formed GFM, catching wiki-to-markdown conversion bugs via markdownlint-cli2 — not a repo-docs linter
metadata:
  type: proposal
  status: proposal — not yet brainstormed or agreed
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/architecture.md, docs/development.md#coding-style
---

# Markdown output validation (proposal)

## Executive summary

`jiraFedrunek`'s whole job is producing correct Markdown: `MarkdownConverter`
(`wikiToMarkdown`, wrapping `j2m`) converts Jira wiki markup to Markdown, and
`MarkdownFormatter.buildMarkdown` assembles it into the files under
`sync/{PROJECT}/{KEY}.md` (§5.2 of `docs/jiraFedrunek-spec-v2.md`) — issue
bodies, comment bodies, and (per the spec's Confluence sync) page bodies.
`j2m` conversion is a known source of subtle breakage: unclosed fences,
malformed tables, broken emphasis/links, mis-nested lists — none of which
currently gets caught. Today the only check is `npm test` against fixture
issues; nothing validates that the *actual converted Markdown written to
disk* is structurally sound.

This proposal adds an automated **structural validation pass over synced
output** — the files in `sync/**/*.md` — using `markdownlint-cli2`, run
against real (or fixture) conversion output to catch cases where the
Jira→Markdown or Confluence→Markdown conversion produced broken Markdown.

This is explicitly **not** about linting this repo's own `README.md`/`docs/`
— those are hand-written prose with no conversion step involved, so there's
nothing conversion-bug-shaped to catch there. Scope is `sync/**/*.md` only.

## Why markdownlint-cli2 fits this differently than a normal repo-docs use

Normally markdownlint enforces *authoring* conventions (heading levels, line
length, house style) on hand-written docs. Here the target text isn't
hand-written — it's `j2m`'s conversion output, which this project doesn't
control. So the ruleset needs to be narrowed to structural/correctness rules
that indicate an actual broken conversion, not house style:

- Malformed/unclosed fenced code blocks (`MD040`/fence-balance checks)
- Broken table rows (mismatched column counts)
- Malformed link/reference syntax
- Heading structure only insofar as `buildMarkdown`'s own template
  (`# {KEY}: {summary}` / `## Description` / `## Comments`) should stay
  intact — anything conversion-generated should never emit a `#`/`##` that
  collides with the template's own headings
- **Not** enforcing line length, house heading style, or anything about
  *prose* — the source content isn't ours to reformat

## Proposed approach

1. **`markdownlint-cli2`** (devDependency) run against `sync/**/*.md`, with a
   dedicated config (`.markdownlint-output.json` or similar, separate from
   any repo-docs config) enabling only structural rules (fence balance,
   table well-formedness, link syntax) and disabling everything about prose
   style (`MD013` line length, `MD012` blank lines, heading-wording rules).
2. **Wire into the test/verification path, not `npm run lint`.** This isn't
   a "did the author format this file nicely" check — it's "did the
   conversion pipeline produce valid Markdown for this issue," so it belongs
   next to `npm test` (or as a post-sync assertion), run against either:
   - fixture wiki-markup inputs with known-tricky constructs (tables inside
     panels, nested lists, code blocks with `{code}` macros) → converted →
     linted, as a new `tests/node/markdown-output.test.js`-style suite, or
   - real synced output in `sync/`, as an opt-in `npm run validate:sync`
     script for a working tree with real data.
3. **Failures point at a conversion bug**, not a style nit — so violations
   should be treated as test failures (fail loud), consistent with this
   project's "no silent fallbacks" convention, not warnings.

## Scope

- `tests/node/fixtures/` — add wiki-markup fixtures covering constructs
  `j2m` is known to mishandle (needs a concrete list — see "Open
  questions")
- `package.json` — devDependency `markdownlint-cli2`; new script, e.g.
  `"validate:md": "markdownlint-cli2 --config .markdownlint-output.json \"sync/**/*.md\""`
- `.markdownlint-output.json` — narrow, structural-only ruleset (see above)
- `tests/node/*.test.js` — new test(s) asserting `MarkdownFormatter.buildMarkdown`
  output for the tricky fixtures passes the structural lint
- `docs/testing.md` — add this as a test item under the module(s) it covers
  (`MarkdownConverter`/`MarkdownFormatter`)

## Out of scope (this pass)

- Linting this repo's own `README.md`/`docs/**/*.md` (hand-written, no
  conversion step, nothing this proposal's rationale applies to)
- Link-checking (`markdown-link-check`) — different concern, and synced
  issue/comment bodies routinely contain valid-but-unreachable-to-CI
  Atlassian-internal links, so a link checker would false-positive constantly
- Auto-fixing detected breakage — a failed structural lint should fail the
  sync/test, not silently rewrite the converted body
- Confluence-specific conversion rules beyond what's already covered by the
  shared `MarkdownFormatter`/`MarkdownConverter` path, unless Confluence's
  storage-format→Markdown conversion turns out to need separate handling
  (needs verification against current Confluence sync code)

## Open questions

- What's the concrete list of `j2m` constructs known to convert badly? (Jira
  panels/admonitions, `{code}` macros with language hints, nested numbered
  lists, tables-in-lists are common trouble spots for wiki→md converters in
  general — needs confirming against this project's actual usage/complaints,
  not assumed.)
- Should this run against real `sync/` output (requires live/cached data) or
  fixture-only conversion output (deterministic, CI-safe)? Fixture-only seems
  right for CI; real-output validation could be a separate opt-in local
  script.
- Does the Confluence sync path go through the same `MarkdownFormatter`, or
  does it have its own body-assembly logic that would need its own fixtures?

## Acceptance

- A fixture suite of "tricky" wiki-markup inputs exists and is converted via
  the real `MarkdownConverter`/`MarkdownFormatter` pipeline
- Structural markdownlint rules run against that converted output as part of
  `npm test` (or a clearly-documented adjacent script) and pass
- A deliberately-broken fixture (e.g. an unclosed fence) causes the
  validation step to fail, proving the check actually catches conversion
  bugs rather than passing vacuously
- `docs/testing.md` documents this as a test item with its status
