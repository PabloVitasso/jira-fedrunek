import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wikiToMarkdown } from '../../src/markdown/wikiToMarkdown.js';

test('TC-MD-WIKITOMARKDOWN-001: converts a wiki heading and bold text to markdown', () => {
  console.log('[TC-MD-WIKITOMARKDOWN-001] step 1: calling wikiToMarkdown with wiki markup input');
  const result = wikiToMarkdown('h1. Title\n\nSome *bold* text');
  console.log(`[TC-MD-WIKITOMARKDOWN-001] step 2: asserting output contains markdown heading and bold syntax, got: ${JSON.stringify(result)}`);
  assert.match(result, /^# Title/);
  assert.match(result, /\*\*bold\*\*/);
});

test('TC-MD-WIKITOMARKDOWN-002: returns an empty string for empty input', () => {
  console.log('[TC-MD-WIKITOMARKDOWN-002] step 1: calling wikiToMarkdown with an empty string');
  const result = wikiToMarkdown('');
  console.log(`[TC-MD-WIKITOMARKDOWN-002] step 2: asserting result is an empty string, got: ${JSON.stringify(result)}`);
  assert.equal(result, '');
});
