import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrontmatter,
  buildIssueBody,
  formatComment,
  buildMarkdown,
  buildPageFrontmatter,
  buildToc,
} from '../../src/markdown/MarkdownFormatter.js';

const DOWNLOADED_AT = '2026-09-02T14:03:00Z';

function makeIssue(overrides = {}) {
  return {
    key: 'PROJ-123',
    id: '10042',
    self: 'https://yoursite.atlassian.net/rest/api/3/issue/10042',
    fields: {
      summary: 'Ticket summary title',
      status: { name: 'In Progress' },
      assignee: { displayName: 'Jane Doe' },
      updated: '2026-09-01T09:12:00.000+0000',
      description: 'Some **bold** description',
    },
    ...overrides,
  };
}

function makeComment(overrides = {}) {
  return {
    id: '10088',
    author: { name: 'john.doe', displayName: 'John Doe' },
    created: '2026-08-30T10:00:00.000+0000',
    updated: '2026-08-30T10:00:00.000+0000',
    body: 'Some **bold** comment',
    ...overrides,
  };
}

test('TC-MD-FORMATTER-001: buildFrontmatter returns all required fields from a well-formed issue', () => {
  console.log('[TC-MD-FORMATTER-001] step 1: calling buildFrontmatter with a well-formed issue');
  const fm = buildFrontmatter(makeIssue(), DOWNLOADED_AT);
  console.log(
    `[TC-MD-FORMATTER-001] step 2: asserting frontmatter fields, got: ${JSON.stringify(fm)}`
  );
  assert.deepEqual(fm, {
    issue_key: 'PROJ-123',
    issue_id: '10042',
    url: 'https://yoursite.atlassian.net/rest/api/3/issue/10042',
    status: 'In Progress',
    downloaded_at: DOWNLOADED_AT,
    issue_updated_at: '2026-09-01T09:12:00.000+0000',
    sync_version: 1,
  });
});

test('TC-MD-FORMATTER-002: buildFrontmatter throws when fields.updated is missing', () => {
  console.log(
    '[TC-MD-FORMATTER-002] step 1: calling buildFrontmatter with fields.updated stripped'
  );
  const issue = makeIssue();
  delete issue.fields.updated;
  console.log('[TC-MD-FORMATTER-002] step 2: asserting it throws (fail fast, no silent fallback)');
  assert.throws(() => buildFrontmatter(issue, DOWNLOADED_AT));
});

test('TC-MD-FORMATTER-003: buildIssueBody renders title, status, assignee, and converted description', () => {
  console.log('[TC-MD-FORMATTER-003] step 1: calling buildIssueBody with a well-formed issue');
  const body = buildIssueBody(makeIssue());
  console.log(
    `[TC-MD-FORMATTER-003] step 2: asserting rendered body, got: ${JSON.stringify(body)}`
  );
  assert.match(body, /^# PROJ-123: Ticket summary title/);
  assert.match(body, /\*\*Status:\*\* In Progress/);
  assert.match(body, /\*\*Assignee:\*\* Jane Doe/);
  assert.match(body, /## Description/);
  assert.match(body, /Some \*\*bold\*\* description/);
});

test('TC-MD-FORMATTER-004: buildIssueBody renders "Unassigned" when fields.assignee is null', () => {
  console.log(
    '[TC-MD-FORMATTER-004] step 1: calling buildIssueBody with fields.assignee set to null'
  );
  const body = buildIssueBody(makeIssue({ fields: { ...makeIssue().fields, assignee: null } }));
  console.log(
    `[TC-MD-FORMATTER-004] step 2: asserting "Unassigned" appears, got: ${JSON.stringify(body)}`
  );
  assert.match(body, /\*\*Assignee:\*\* Unassigned/);
});

test('TC-MD-FORMATTER-005: formatComment renders the HTML-comment metadata block', () => {
  console.log('[TC-MD-FORMATTER-005] step 1: calling formatComment with a well-formed comment');
  const block = formatComment(makeComment(), DOWNLOADED_AT);
  console.log(
    `[TC-MD-FORMATTER-005] step 2: asserting metadata comment lines, got: ${JSON.stringify(block)}`
  );
  assert.match(block, /<!-- comment_id: 10088 -->/);
  assert.match(block, /<!-- author: john\.doe -->/);
  assert.match(block, /<!-- created_at: 2026-08-30T10:00:00\.000\+0000 -->/);
  assert.match(block, /<!-- updated_at: 2026-08-30T10:00:00\.000\+0000 -->/);
  assert.match(block, new RegExp(`<!-- downloaded_at: ${DOWNLOADED_AT} -->`));
});

test('TC-MD-FORMATTER-006: formatComment renders the display header and converted body', () => {
  console.log('[TC-MD-FORMATTER-006] step 1: calling formatComment with a well-formed comment');
  const block = formatComment(makeComment(), DOWNLOADED_AT);
  console.log(
    `[TC-MD-FORMATTER-006] step 2: asserting header and body, got: ${JSON.stringify(block)}`
  );
  assert.match(block, /\*\*John Doe\*\* — 2026-08-30 10:00/);
  assert.match(block, /Some \*\*bold\*\* comment/);
  assert.match(block, /\n---\n?$/);
});

test('TC-MD-FORMATTER-007: buildMarkdown produces frontmatter + body + comments per spec 5.1-5.2', () => {
  console.log('[TC-MD-FORMATTER-007] step 1: calling buildMarkdown with one issue and one comment');
  const markdown = buildMarkdown(makeIssue(), [makeComment()], DOWNLOADED_AT);
  console.log(
    `[TC-MD-FORMATTER-007] step 2: asserting frontmatter delimiters, body, and comment block present`
  );
  assert.match(markdown, /^---\nissue_key: PROJ-123/);
  assert.match(markdown, /# PROJ-123: Ticket summary title/);
  assert.match(markdown, /## Comments/);
  assert.match(markdown, /<!-- comment_id: 10088 -->/);
});

test('TC-MD-FORMATTER-008: buildMarkdown with zero comments still renders the Comments heading', () => {
  console.log('[TC-MD-FORMATTER-008] step 1: calling buildMarkdown with an empty comments array');
  const markdown = buildMarkdown(makeIssue(), [], DOWNLOADED_AT);
  console.log(
    `[TC-MD-FORMATTER-008] step 2: asserting "## Comments" heading is present with no comment blocks`
  );
  assert.match(markdown, /## Comments/);
  assert.doesNotMatch(markdown, /<!-- comment_id:/);
});

test('TC-MD-FORMATTER-009: buildPageFrontmatter returns id/title/space/lastModified from a well-formed page', () => {
  console.log('[TC-MD-FORMATTER-009] step 1: calling buildPageFrontmatter with a well-formed page');
  const fm = buildPageFrontmatter({
    id: '100000001',
    title: 'Field Mapping',
    spaceKey: 'ARCHDOCS',
    lastModified: '2026-09-01T00:00:00.000Z',
  });
  console.log(
    `[TC-MD-FORMATTER-009] step 2: asserting frontmatter fields, got: ${JSON.stringify(fm)}`
  );
  assert.deepEqual(fm, {
    id: '100000001',
    title: 'Field Mapping',
    space: 'ARCHDOCS',
    lastModified: '2026-09-01T00:00:00.000Z',
  });
});

test('TC-MD-FORMATTER-010: buildPageFrontmatter throws when id/title are missing', () => {
  console.log('[TC-MD-FORMATTER-010] step 1: calling buildPageFrontmatter with id stripped');
  console.log('[TC-MD-FORMATTER-010] step 2: asserting it throws (fail fast, no silent fallback)');
  assert.throws(() => buildPageFrontmatter({ title: 'Field Mapping' }));
});

test('TC-MD-FORMATTER-011: buildToc renders a nested link list from ##-###### headings', () => {
  console.log(
    '[TC-MD-FORMATTER-011] step 1: calling buildToc with a markdown document containing headings'
  );
  const md = '## First\n\ntext\n\n### Nested\n\nmore text\n\n## Second\n';
  const toc = buildToc(md);
  console.log(
    `[TC-MD-FORMATTER-011] step 2: asserting the Contents section and nested links, got: ${JSON.stringify(toc)}`
  );
  assert.match(toc, /^## Contents/);
  assert.match(toc, /- \[First\]\(#first\)/);
  assert.match(toc, / {2}- \[Nested\]\(#nested\)/);
  assert.match(toc, /- \[Second\]\(#second\)/);
});

test('TC-MD-FORMATTER-013: buildToc disambiguates duplicate anchors from headings that slugify to the same text', () => {
  console.log(
    '[TC-MD-FORMATTER-013] step 1: calling buildToc with two headings that both slugify to "overview"'
  );
  const md = '## Overview\n\ntext\n\n## Overview\n\nmore text\n';
  const toc = buildToc(md);
  console.log(
    `[TC-MD-FORMATTER-013] step 2: asserting the first link uses the plain anchor and the second is disambiguated, got: ${JSON.stringify(toc)}`
  );
  assert.match(toc, /- \[Overview\]\(#overview\)\n- \[Overview\]\(#overview-1\)/);
});

test('TC-MD-FORMATTER-012: buildToc returns an empty string when there are no headings', () => {
  console.log(
    '[TC-MD-FORMATTER-012] step 1: calling buildToc with a markdown document with no ##-###### headings'
  );
  const toc = buildToc('just some text\n\nno headings here\n');
  console.log(
    `[TC-MD-FORMATTER-012] step 2: asserting an empty string is returned, got: ${JSON.stringify(toc)}`
  );
  assert.equal(toc, '');
});
