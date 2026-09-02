import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfluenceSyncEngine } from '../../src/confluence/ConfluenceSyncEngine.js';
import { SyncState } from '../../src/sync/SyncState.js';

const NOW = '2026-09-02T14:03:00.000Z';

function makeTempStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-confluence-sync-'));
  return path.join(dir, '.sync-state.json');
}

function makeFileWriter(initial = {}) {
  const files = { ...initial };
  return {
    read: (p) => (p in files ? files[p] : null),
    write: (p, content) => { files[p] = content; },
    _files: files,
  };
}

function makeConfluenceClient(overrides = {}) {
  return {
    getPage: async () => '## Section\n\nbody text',
    searchByCql: async () => ({ results: [] }),
    getSpaces: async () => [],
    getPagesInSpace: async () => ({ results: [] }),
    ...overrides,
  };
}

function makeEngine({ confluenceClient = makeConfluenceClient(), folderWalker = { walkDescendants: async () => [] }, options = {} } = {}) {
  const syncState = new SyncState(makeTempStatePath());
  syncState.load();
  const fileWriter = makeFileWriter();
  const engine = new ConfluenceSyncEngine(confluenceClient, folderWalker, syncState, fileWriter, { now: () => NOW, ...options });
  return { engine, syncState, fileWriter };
}

test('TC-CONFLUENCE-SYNC-001: syncPage creates a new file and sets state when the page is not yet tracked', async () => {
  console.log('[TC-CONFLUENCE-SYNC-001] step 1: wiring a fake ConfluenceClient resolving a page by CQL id lookup');
  const confluenceClient = makeConfluenceClient({
    searchByCql: async () => ({
      results: [{ content: { title: 'Field Mapping', _links: { webui: '/spaces/ARCHDOCS/pages/100000001/x' } }, lastModified: '2026-09-01T00:00:00.000Z' }],
    }),
  });
  const { engine, syncState, fileWriter } = makeEngine({ confluenceClient });
  console.log('[TC-CONFLUENCE-SYNC-001] step 2: calling syncPage("100000001")');
  const result = await engine.syncPage('100000001');
  console.log(`[TC-CONFLUENCE-SYNC-001] step 3: asserting result + state + file, got: ${JSON.stringify(result)}`);
  assert.equal(result.status, 'created');
  assert.deepEqual(syncState.getPage('100000001'), {
    lastModified: '2026-09-01T00:00:00.000Z',
    path: result.path,
    title: 'Field Mapping',
  });
  console.log(`[TC-CONFLUENCE-SYNC-001] step 4: asserting the page file + rebuilt CONTENTS.md were written, got: ${JSON.stringify(Object.keys(fileWriter._files))}`);
  assert.equal(Object.keys(fileWriter._files).length, 2);
});

test('TC-CONFLUENCE-SYNC-002: syncPage skips regeneration when lastModified matches stored state', async () => {
  console.log('[TC-CONFLUENCE-SYNC-002] step 1: wiring a fake ConfluenceClient with a page whose lastModified matches stored state');
  const confluenceClient = makeConfluenceClient({
    searchByCql: async () => ({
      results: [{ content: { title: 'Field Mapping', _links: { webui: '/spaces/ARCHDOCS/pages/1/x' } }, lastModified: '2026-09-01T00:00:00.000Z' }],
    }),
  });
  const { engine, syncState } = makeEngine({ confluenceClient });
  syncState.setPage('1', { lastModified: '2026-09-01T00:00:00.000Z', path: 'ARCHDOCS/1-field-mapping.md', title: 'Field Mapping' });
  console.log('[TC-CONFLUENCE-SYNC-002] step 2: calling syncPage("1") and asserting it is skipped');
  const result = await engine.syncPage('1');
  assert.deepEqual(result, { status: 'unchanged', id: '1' });
});

test('TC-CONFLUENCE-SYNC-003: syncPage reports not_found when the CQL lookup returns no results', async () => {
  console.log('[TC-CONFLUENCE-SYNC-003] step 1: wiring a fake ConfluenceClient with an empty CQL result');
  const { engine } = makeEngine({ confluenceClient: makeConfluenceClient({ searchByCql: async () => ({ results: [] }) }) });
  console.log('[TC-CONFLUENCE-SYNC-003] step 2: calling syncPage("999") and asserting not_found');
  const result = await engine.syncPage('999');
  assert.deepEqual(result, { status: 'not_found', id: '999' });
});

test('TC-CONFLUENCE-SYNC-004: syncDir fetches every descendant, writes files under <space>/<folderId>-<slug>/', async () => {
  console.log('[TC-CONFLUENCE-SYNC-004] step 1: wiring a fake FolderWalker returning two descendant pages');
  const folderWalker = {
    walkDescendants: async () => [
      { id: '1', title: 'A', spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' },
      { id: '2', title: 'B', spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' },
    ],
  };
  const { engine, fileWriter } = makeEngine({ folderWalker });
  console.log('[TC-CONFLUENCE-SYNC-004] step 2: calling syncDir("100000002", "My Folder")');
  const result = await engine.syncDir('100000002', 'My Folder');
  console.log(`[TC-CONFLUENCE-SYNC-004] step 3: asserting fetch counts and file paths, got: ${JSON.stringify(result)}`);
  assert.equal(result.total, 2);
  assert.equal(result.fetched, 2);
  const paths = Object.keys(fileWriter._files).filter((p) => !p.endsWith('CONTENTS.md'));
  const expectedSubDir = path.join('ARCHDOCS', '100000002-my-folder');
  assert.ok(paths.every((p) => p.includes(expectedSubDir)), `expected all page paths to include ${expectedSubDir}, got: ${JSON.stringify(paths)}`);
});

test('TC-CONFLUENCE-SYNC-005: syncDir removes orphaned manifest entries no longer present remotely, scoped to that folder', async () => {
  console.log('[TC-CONFLUENCE-SYNC-005] step 1: wiring a SyncState with a stale orphan entry under the folder subdir, plus one live page');
  const folderWalker = {
    walkDescendants: async () => [{ id: '1', title: 'A', spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' }],
  };
  const { engine, syncState } = makeEngine({ folderWalker });
  syncState.setPage('1', { lastModified: '2026-08-01T00:00:00.000Z', path: 'ARCHDOCS/100000002-my-folder/1-a.md', title: 'A' });
  syncState.setPage('99', { lastModified: '2026-08-01T00:00:00.000Z', path: 'ARCHDOCS/100000002-my-folder/99-orphan.md', title: 'Orphan' });
  console.log('[TC-CONFLUENCE-SYNC-005] step 2: calling syncDir("100000002", "My Folder")');
  await engine.syncDir('100000002', 'My Folder');
  console.log(`[TC-CONFLUENCE-SYNC-005] step 3: asserting the orphan (id=99) was removed from state, live page (id=1) kept`);
  assert.equal(syncState.getPage('99'), undefined);
  assert.ok(syncState.getPage('1'));
});

test('TC-CONFLUENCE-SYNC-006: syncSpaces throws on unknown space keys', async () => {
  console.log('[TC-CONFLUENCE-SYNC-006] step 1: wiring a fake ConfluenceClient with no matching spaces');
  const { engine } = makeEngine({ confluenceClient: makeConfluenceClient({ getSpaces: async () => [] }) });
  console.log('[TC-CONFLUENCE-SYNC-006] step 2: calling syncSpaces(["BOGUS"]) and asserting it rejects');
  await assert.rejects(() => engine.syncSpaces(['BOGUS']), /unknown space keys/);
});

test('TC-CONFLUENCE-SYNC-008: syncPage reports "updated" (not "created") when the page is already tracked with a different lastModified', async () => {
  console.log('[TC-CONFLUENCE-SYNC-008] step 1: wiring a fake ConfluenceClient with a page whose lastModified differs from stored state');
  const confluenceClient = makeConfluenceClient({
    searchByCql: async () => ({
      results: [{ content: { title: 'Field Mapping', _links: { webui: '/spaces/ARCHDOCS/pages/1/x' } }, lastModified: '2026-09-02T00:00:00.000Z' }],
    }),
  });
  const { engine, syncState } = makeEngine({ confluenceClient });
  syncState.setPage('1', { lastModified: '2026-09-01T00:00:00.000Z', path: 'ARCHDOCS/1-field-mapping.md', title: 'Field Mapping' });
  console.log('[TC-CONFLUENCE-SYNC-008] step 2: calling syncPage("1")');
  const result = await engine.syncPage('1');
  console.log(`[TC-CONFLUENCE-SYNC-008] step 3: asserting status "updated", got: ${JSON.stringify(result)}`);
  assert.equal(result.status, 'updated');
});

test('TC-CONFLUENCE-SYNC-009: syncPage falls back to id as title and "unknown" as spaceKey when the CQL result is missing them', async () => {
  console.log('[TC-CONFLUENCE-SYNC-009] step 1: wiring a fake ConfluenceClient whose CQL result has no content.title/title and no webui link');
  const confluenceClient = makeConfluenceClient({
    searchByCql: async () => ({ results: [{ lastModified: '2026-09-01T00:00:00.000Z' }] }),
  });
  const { engine, syncState } = makeEngine({ confluenceClient });
  console.log('[TC-CONFLUENCE-SYNC-009] step 2: calling syncPage("42")');
  const result = await engine.syncPage('42');
  console.log(`[TC-CONFLUENCE-SYNC-009] step 3: asserting the written state used the id as title, got: ${JSON.stringify(syncState.getPage('42'))}`);
  assert.equal(syncState.getPage('42').title, '42');
  assert.equal(result.path, path.join('unknown', '42-42.md'));
});

test('TC-CONFLUENCE-SYNC-010: syncDir returns a zeroed result and writes nothing when the folder has no descendant pages', async () => {
  console.log('[TC-CONFLUENCE-SYNC-010] step 1: wiring a fake FolderWalker returning no descendants');
  const { engine, fileWriter } = makeEngine({ folderWalker: { walkDescendants: async () => [] } });
  console.log('[TC-CONFLUENCE-SYNC-010] step 2: calling syncDir("100000002", "My Folder")');
  const result = await engine.syncDir('100000002', 'My Folder');
  console.log(`[TC-CONFLUENCE-SYNC-010] step 3: asserting a zeroed result and no files written, got: ${JSON.stringify(result)}`);
  assert.deepEqual(result, { folderId: '100000002', total: 0, fetched: 0, failed: [], skipped: 0 });
  assert.deepEqual(fileWriter._files, {});
});

test('TC-CONFLUENCE-SYNC-011: syncDirs runs syncDir once per watched folder and returns results in order', async () => {
  console.log('[TC-CONFLUENCE-SYNC-011] step 1: wiring a fake FolderWalker whose descendants depend on the requested folderId');
  const folderWalker = {
    walkDescendants: async (folderId) => [{ id: folderId, title: `Page ${folderId}`, spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' }],
  };
  const { engine } = makeEngine({ folderWalker });
  console.log('[TC-CONFLUENCE-SYNC-011] step 2: calling syncDirs([{folderId: "1", ...}, {folderId: "2", ...}])');
  const results = await engine.syncDirs([{ folderId: '1', label: 'One' }, { folderId: '2', label: 'Two' }]);
  console.log(`[TC-CONFLUENCE-SYNC-011] step 3: asserting one result per watched folder, in order, got: ${JSON.stringify(results)}`);
  assert.equal(results.length, 2);
  assert.equal(results[0].folderId, '1');
  assert.equal(results[1].folderId, '2');
});

test('TC-CONFLUENCE-SYNC-012: syncPages runs syncPage once per watched page and returns results in order', async () => {
  console.log('[TC-CONFLUENCE-SYNC-012] step 1: wiring a fake ConfluenceClient resolving whichever id is requested by CQL');
  const confluenceClient = makeConfluenceClient({
    searchByCql: async (cql) => {
      const id = cql.match(/id = "(\w+)"/)[1];
      return { results: [{ content: { title: `Page ${id}`, _links: { webui: `/spaces/ARCHDOCS/pages/${id}/x` } }, lastModified: '2026-09-01T00:00:00.000Z' }] };
    },
  });
  const { engine } = makeEngine({ confluenceClient });
  console.log('[TC-CONFLUENCE-SYNC-012] step 2: calling syncPages([{id: "1"}, {id: "2"}])');
  const results = await engine.syncPages([{ id: '1' }, { id: '2' }]);
  console.log(`[TC-CONFLUENCE-SYNC-012] step 3: asserting one result per watched page, in order, got: ${JSON.stringify(results)}`);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, '1');
  assert.equal(results[1].id, '2');
  assert.equal(results[0].status, 'created');
  assert.equal(results[1].status, 'created');
});

test('TC-CONFLUENCE-SYNC-013: syncSpaces follows the cursor across multiple pages of getPagesInSpace results', async () => {
  console.log('[TC-CONFLUENCE-SYNC-013] step 1: wiring a fake ConfluenceClient serving two pages of results via cursor for a single space');
  const calls = [];
  const confluenceClient = makeConfluenceClient({
    getSpaces: async () => [{ key: 'ARCHDOCS', id: '1' }],
    getPagesInSpace: async (spaceId, { cursor } = {}) => {
      calls.push(cursor);
      if (!cursor) {
        return {
          results: [{ id: '1', title: 'A', version: { createdAt: '2026-09-01T00:00:00.000Z' } }],
          _links: { next: '/rest/api/pages?cursor=abc' },
        };
      }
      return { results: [{ id: '2', title: 'B', version: { createdAt: '2026-09-01T00:00:00.000Z' } }] };
    },
  });
  const { engine } = makeEngine({ confluenceClient });
  console.log('[TC-CONFLUENCE-SYNC-013] step 2: calling syncSpaces(["ARCHDOCS"])');
  const result = await engine.syncSpaces(['ARCHDOCS']);
  console.log(`[TC-CONFLUENCE-SYNC-013] step 3: asserting the cursor sequence and total across both pages, got calls: ${JSON.stringify(calls)}, result: ${JSON.stringify(result)}`);
  assert.deepEqual(calls, [undefined, 'abc']);
  assert.equal(result.total, 2);
});

test('TC-CONFLUENCE-SYNC-014: #fetchStale records a per-page failure without failing the whole batch, when one write rejects', async () => {
  console.log('[TC-CONFLUENCE-SYNC-014] step 1: wiring a fake ConfluenceClient whose getPage rejects for one of two stale pages');
  const folderWalker = {
    walkDescendants: async () => [
      { id: '1', title: 'A', spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' },
      { id: '2', title: 'B', spaceKey: 'ARCHDOCS', lastModified: '2026-09-01T00:00:00.000Z' },
    ],
  };
  const confluenceClient = makeConfluenceClient({
    getPage: async (id) => {
      if (id === '2') throw new Error('fetch failed for page 2');
      return '## Section\n\nbody text';
    },
  });
  const { engine, syncState } = makeEngine({ confluenceClient, folderWalker });
  console.log('[TC-CONFLUENCE-SYNC-014] step 2: calling syncDir("100000002", "My Folder")');
  const result = await engine.syncDir('100000002', 'My Folder');
  console.log(`[TC-CONFLUENCE-SYNC-014] step 3: asserting one fetched, one failed, and only the successful page landed in state, got: ${JSON.stringify(result)}`);
  assert.equal(result.fetched, 1);
  assert.equal(result.failed.length, 1);
  assert.ok(syncState.getPage('1'));
  assert.equal(syncState.getPage('2'), undefined);
});

test('TC-CONFLUENCE-SYNC-007: syncSpaces aborts the bulk fetch when confirmBulk returns false, leaving state untouched', async () => {
  console.log('[TC-CONFLUENCE-SYNC-007] step 1: wiring a fake ConfluenceClient with two stale pages and a confirmBulk that declines');
  const confluenceClient = makeConfluenceClient({
    getSpaces: async () => [{ key: 'ARCHDOCS', id: '1' }],
    getPagesInSpace: async () => ({
      results: [
        { id: '1', title: 'A', version: { createdAt: '2026-09-01T00:00:00.000Z' } },
        { id: '2', title: 'B', version: { createdAt: '2026-09-01T00:00:00.000Z' } },
      ],
    }),
  });
  const { engine, syncState } = makeEngine({ confluenceClient, options: { confirmBulk: async () => false } });
  console.log('[TC-CONFLUENCE-SYNC-007] step 2: calling syncSpaces(["ARCHDOCS"])');
  const result = await engine.syncSpaces(['ARCHDOCS']);
  console.log(`[TC-CONFLUENCE-SYNC-007] step 3: asserting the bulk fetch was aborted and nothing was written, got: ${JSON.stringify(result)}`);
  assert.equal(result.aborted, true);
  assert.equal(result.fetched, 0);
  assert.equal(syncState.getPage('1'), undefined);
});
