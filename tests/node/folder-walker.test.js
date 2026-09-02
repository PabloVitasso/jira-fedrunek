import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FolderWalker } from '../../src/confluence/FolderWalker.js';

function makePage({ id, title, spaceKey = 'ARCHDOCS', lastModified = '2026-09-01T00:00:00.000Z' }) {
  return {
    content: { id, title, _links: { webui: `/spaces/${spaceKey}/pages/${id}/${title}` } },
    lastModified,
  };
}

test('TC-FOLDER-WALKER-001: walkDescendants collects pages from a single, unpaginated CQL result', async () => {
  console.log('[TC-FOLDER-WALKER-001] step 1: wiring a fake ConfluenceClient returning one page of results, no cursor');
  let captured;
  const confluenceClient = {
    searchByCql: async (cql, opts) => {
      captured = { cql, opts };
      return { results: [makePage({ id: '1', title: 'A' }), makePage({ id: '2', title: 'B' })] };
    },
  };
  console.log('[TC-FOLDER-WALKER-001] step 2: calling walkDescendants("100000002")');
  const pages = await new FolderWalker(confluenceClient).walkDescendants('100000002');
  console.log(`[TC-FOLDER-WALKER-001] step 3: asserting the CQL query shape, got: ${JSON.stringify(captured)}`);
  assert.equal(captured.cql, 'ancestor = "100000002" AND type = page');
  console.log(`[TC-FOLDER-WALKER-001] step 4: asserting both pages collected with id/title/spaceKey/lastModified, got: ${JSON.stringify(pages)}`);
  assert.deepEqual(pages, [
    { id: '1', title: 'A', spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' },
    { id: '2', title: 'B', spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' },
  ]);
});

test('TC-FOLDER-WALKER-002: walkDescendants follows the cursor across multiple pages until _links.next is absent', async () => {
  console.log('[TC-FOLDER-WALKER-002] step 1: wiring a fake ConfluenceClient serving two pages of results via cursor');
  const calls = [];
  const confluenceClient = {
    searchByCql: async (cql, opts) => {
      calls.push(opts.cursor);
      if (!opts.cursor) {
        return {
          results: [makePage({ id: '1', title: 'A' })],
          _links: { next: '/rest/api/search?cursor=abc' },
        };
      }
      return { results: [makePage({ id: '2', title: 'B' })] };
    },
  };
  console.log('[TC-FOLDER-WALKER-002] step 2: calling walkDescendants("100000002")');
  const pages = await new FolderWalker(confluenceClient).walkDescendants('100000002');
  console.log(`[TC-FOLDER-WALKER-002] step 3: asserting the cursor sequence, got: ${JSON.stringify(calls)}`);
  assert.deepEqual(calls, [undefined, 'abc']);
  console.log(`[TC-FOLDER-WALKER-002] step 4: asserting both pages across both cursor pages were collected, got: ${JSON.stringify(pages.map((p) => p.id))}`);
  assert.deepEqual(pages.map((p) => p.id), ['1', '2']);
});

test('TC-FOLDER-WALKER-004: walkDescendants falls back to the decoded r.title when content.title is missing', async () => {
  console.log('[TC-FOLDER-WALKER-004] step 1: wiring a fake ConfluenceClient whose result has no content.title, only an HTML-entity-encoded r.title');
  const confluenceClient = {
    searchByCql: async () => ({
      results: [{ content: { id: '1', _links: { webui: '/spaces/ARCHDOCS/pages/1/x' } }, title: 'Q&amp;A Guide', lastModified: '2026-09-01T00:00:00.000Z' }],
    }),
  };
  console.log('[TC-FOLDER-WALKER-004] step 2: calling walkDescendants("100000002")');
  const pages = await new FolderWalker(confluenceClient).walkDescendants('100000002');
  console.log(`[TC-FOLDER-WALKER-004] step 3: asserting the decoded r.title was used, got: ${JSON.stringify(pages)}`);
  assert.equal(pages[0].title, 'Q&A Guide');
});

test('TC-FOLDER-WALKER-005: walkDescendants falls back to "unknown" spaceKey when the webui link is absent', async () => {
  console.log('[TC-FOLDER-WALKER-005] step 1: wiring a fake ConfluenceClient whose result has no _links.webui');
  const confluenceClient = {
    searchByCql: async () => ({ results: [{ content: { id: '1', title: 'A' }, lastModified: '2026-09-01T00:00:00.000Z' }] }),
  };
  console.log('[TC-FOLDER-WALKER-005] step 2: calling walkDescendants("100000002")');
  const pages = await new FolderWalker(confluenceClient).walkDescendants('100000002');
  console.log(`[TC-FOLDER-WALKER-005] step 3: asserting the "unknown" spaceKey fallback, got: ${JSON.stringify(pages)}`);
  assert.equal(pages[0].spaceKey, 'unknown');
});

test('TC-FOLDER-WALKER-003: walkDescendants returns an empty array when there are no results', async () => {
  console.log('[TC-FOLDER-WALKER-003] step 1: wiring a fake ConfluenceClient returning zero results');
  const confluenceClient = { searchByCql: async () => ({ results: [] }) };
  console.log('[TC-FOLDER-WALKER-003] step 2: calling walkDescendants and asserting an empty array');
  const pages = await new FolderWalker(confluenceClient).walkDescendants('100000002');
  assert.deepEqual(pages, []);
});
