import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommentBlocks, mergeComments } from '../../src/markdown/CommentBlockParser.js';
import { formatComment } from '../../src/markdown/MarkdownFormatter.js';

const DOWNLOADED_AT = '2026-09-02T14:03:00Z';

function makeComment(overrides = {}) {
  return {
    id: '10088',
    author: { name: 'john.doe', displayName: 'John Doe' },
    created: '2026-08-30T10:00:00.000+0000',
    updated: '2026-08-30T10:00:00.000+0000',
    body: 'first comment',
    ...overrides,
  };
}

test('TC-MD-COMMENTPARSER-001: parseCommentBlocks extracts a single block keyed by id', () => {
  console.log('[TC-MD-COMMENTPARSER-001] step 1: formatting one comment into markdown content');
  const content = formatComment(makeComment(), DOWNLOADED_AT);
  console.log('[TC-MD-COMMENTPARSER-001] step 2: parsing it back with parseCommentBlocks');
  const blocks = parseCommentBlocks(content);
  console.log(`[TC-MD-COMMENTPARSER-001] step 3: asserting map keyed by "10088", got keys: ${Object.keys(blocks)}`);
  assert.deepEqual(Object.keys(blocks), ['10088']);
  assert.equal(blocks['10088'].id, '10088');
  assert.equal(blocks['10088'].updatedAt, '2026-08-30T10:00:00.000+0000');
  assert.equal(blocks['10088'].block, content);
});

test('TC-MD-COMMENTPARSER-002: parseCommentBlocks extracts multiple blocks in order', () => {
  console.log('[TC-MD-COMMENTPARSER-002] step 1: formatting two comments and concatenating their markdown');
  const c1 = formatComment(makeComment({ id: '1' }), DOWNLOADED_AT);
  const c2 = formatComment(makeComment({ id: '2', body: 'second comment' }), DOWNLOADED_AT);
  const content = `${c1}\n${c2}`;
  console.log('[TC-MD-COMMENTPARSER-002] step 2: parsing combined content with parseCommentBlocks');
  const blocks = parseCommentBlocks(content);
  console.log(`[TC-MD-COMMENTPARSER-002] step 3: asserting both ids present, got keys: ${Object.keys(blocks)}`);
  assert.deepEqual(Object.keys(blocks), ['1', '2']);
});

test('TC-MD-COMMENTPARSER-003: parseCommentBlocks returns an empty object for content with no comment blocks', () => {
  console.log('[TC-MD-COMMENTPARSER-003] step 1: parsing plain content with no HTML comment markers');
  const blocks = parseCommentBlocks('# Just an issue body\n\nNo comments here.');
  console.log(`[TC-MD-COMMENTPARSER-003] step 2: asserting empty map, got: ${JSON.stringify(blocks)}`);
  assert.deepEqual(blocks, {});
});

test('TC-MD-COMMENTPARSER-004: mergeComments appends a block for a new comment id', () => {
  console.log('[TC-MD-COMMENTPARSER-004] step 1: merging one fresh comment against an empty existing-blocks map');
  const result = mergeComments({}, [makeComment()], DOWNLOADED_AT);
  console.log(`[TC-MD-COMMENTPARSER-004] step 2: asserting one block containing the new comment_id, got: ${JSON.stringify(result)}`);
  assert.equal(result.length, 1);
  assert.match(result[0], /<!-- comment_id: 10088 -->/);
});

test('TC-MD-COMMENTPARSER-005: mergeComments replaces the block when comment.updated changed', () => {
  console.log('[TC-MD-COMMENTPARSER-005] step 1: building existing blocks from an older version of the comment');
  const oldContent = formatComment(makeComment(), '2026-09-01T00:00:00Z');
  const existing = parseCommentBlocks(oldContent);
  console.log('[TC-MD-COMMENTPARSER-005] step 2: merging a fresh comment with a newer updated timestamp and new body');
  const fresh = makeComment({ updated: '2026-09-02T00:00:00.000+0000', body: 'edited comment' });
  const result = mergeComments(existing, [fresh], DOWNLOADED_AT);
  console.log(`[TC-MD-COMMENTPARSER-005] step 3: asserting block was replaced with new body/downloaded_at, got: ${JSON.stringify(result)}`);
  assert.equal(result.length, 1);
  assert.match(result[0], /edited comment/);
  assert.match(result[0], new RegExp(`downloaded_at: ${DOWNLOADED_AT}`));
});

test('TC-MD-COMMENTPARSER-006: mergeComments keeps the block unchanged when comment.updated matches stored', () => {
  console.log('[TC-MD-COMMENTPARSER-006] step 1: building existing blocks from the comment at its original downloaded_at');
  const oldContent = formatComment(makeComment(), '2026-09-01T00:00:00Z');
  const existing = parseCommentBlocks(oldContent);
  console.log('[TC-MD-COMMENTPARSER-006] step 2: merging the same comment again (unchanged updated timestamp)');
  const result = mergeComments(existing, [makeComment()], DOWNLOADED_AT);
  console.log(`[TC-MD-COMMENTPARSER-006] step 3: asserting the original block text is preserved byte-for-byte, got: ${JSON.stringify(result)}`);
  assert.equal(result.length, 1);
  assert.equal(result[0], existing['10088'].block);
});

test('TC-MD-COMMENTPARSER-007: mergeComments marks a missing comment with a deleted_at marker', () => {
  console.log('[TC-MD-COMMENTPARSER-007] step 1: building existing blocks with one comment');
  const oldContent = formatComment(makeComment(), '2026-09-01T00:00:00Z');
  const existing = parseCommentBlocks(oldContent);
  console.log('[TC-MD-COMMENTPARSER-007] step 2: merging with an empty fresh-comments list (comment now deleted upstream)');
  const result = mergeComments(existing, [], DOWNLOADED_AT);
  console.log(`[TC-MD-COMMENTPARSER-007] step 3: asserting a deleted_at marker was appended, got: ${JSON.stringify(result)}`);
  assert.equal(result.length, 1);
  assert.match(result[0], /<!-- comment_id: 10088 -->/);
  assert.match(result[0], new RegExp(`<!-- deleted_at: ${DOWNLOADED_AT} -->`));
});
