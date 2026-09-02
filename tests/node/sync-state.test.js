import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncState } from '../../src/sync/SyncState.js';

function makeTempPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-syncstate-'));
  return path.join(dir, '.sync-state.json');
}

test('TC-SYNC-STATE-001: load() on a missing file starts with empty issues/confluence sections', () => {
  console.log('[TC-SYNC-STATE-001] step 1: creating a SyncState pointed at a non-existent file');
  const state = new SyncState(makeTempPath());
  console.log('[TC-SYNC-STATE-001] step 2: calling load()');
  state.load();
  console.log(
    '[TC-SYNC-STATE-001] step 3: asserting getIssue()/getPage() return undefined for any key'
  );
  assert.equal(state.getIssue('PROJ-1'), undefined);
  assert.equal(state.getPage('100000001'), undefined);
});

test('TC-SYNC-STATE-002: setIssue() then getIssue() round-trips per-issue metadata in memory', () => {
  console.log('[TC-SYNC-STATE-002] step 1: creating a SyncState and loading empty state');
  const state = new SyncState(makeTempPath());
  state.load();
  console.log('[TC-SYNC-STATE-002] step 2: setIssue() metadata for PROJ-1');
  state.setIssue('PROJ-1', { issue_updated_at: '2026-09-01T00:00:00Z', comment_ids: ['10088'] });
  console.log('[TC-SYNC-STATE-002] step 3: asserting getIssue() returns exactly what was set');
  assert.deepEqual(state.getIssue('PROJ-1'), {
    issue_updated_at: '2026-09-01T00:00:00Z',
    comment_ids: ['10088'],
  });
});

test('TC-SYNC-STATE-003: setPage() then getPage() round-trips per-page metadata in memory', () => {
  console.log('[TC-SYNC-STATE-003] step 1: creating a SyncState and loading empty state');
  const state = new SyncState(makeTempPath());
  state.load();
  console.log('[TC-SYNC-STATE-003] step 2: setPage() metadata for a Confluence page id');
  state.setPage('100000001', {
    lastModified: '2026-09-01T00:00:00Z',
    path: 'ARCHDOCS/100000001-title.md',
    title: 'Title',
  });
  console.log('[TC-SYNC-STATE-003] step 3: asserting getPage() returns exactly what was set');
  assert.deepEqual(state.getPage('100000001'), {
    lastModified: '2026-09-01T00:00:00Z',
    path: 'ARCHDOCS/100000001-title.md',
    title: 'Title',
  });
});

test('TC-SYNC-STATE-004: save() then a fresh load() round-trips both sections to disk', () => {
  console.log(
    '[TC-SYNC-STATE-004] step 1: creating a SyncState, loading, and setting one issue + one page'
  );
  const statePath = makeTempPath();
  const state = new SyncState(statePath);
  state.load();
  state.setIssue('PROJ-1', { issue_updated_at: '2026-09-01T00:00:00Z', comment_ids: [] });
  state.setPage('100000001', {
    lastModified: '2026-09-01T00:00:00Z',
    path: 'ARCHDOCS/100000001-title.md',
    title: 'Title',
  });
  console.log(`[TC-SYNC-STATE-004] step 2: calling save() to ${statePath}`);
  state.save();
  console.log(
    '[TC-SYNC-STATE-004] step 3: creating a second SyncState instance over the same path and loading it'
  );
  const reloaded = new SyncState(statePath);
  reloaded.load();
  console.log('[TC-SYNC-STATE-004] step 4: asserting the reloaded instance sees both sections');
  assert.deepEqual(reloaded.getIssue('PROJ-1'), {
    issue_updated_at: '2026-09-01T00:00:00Z',
    comment_ids: [],
  });
  assert.deepEqual(reloaded.getPage('100000001'), {
    lastModified: '2026-09-01T00:00:00Z',
    path: 'ARCHDOCS/100000001-title.md',
    title: 'Title',
  });
});

test('TC-SYNC-STATE-005: load() tolerates and resets on invalid JSON rather than throwing', () => {
  console.log('[TC-SYNC-STATE-005] step 1: writing invalid JSON to a temp state file');
  const statePath = makeTempPath();
  fs.writeFileSync(statePath, '{ not valid json', 'utf8');
  const state = new SyncState(statePath);
  console.log('[TC-SYNC-STATE-005] step 2: calling load() and asserting it does not throw');
  assert.doesNotThrow(() => state.load());
  console.log('[TC-SYNC-STATE-005] step 3: asserting state is empty after tolerating the bad file');
  assert.equal(state.getIssue('PROJ-1'), undefined);
});

test('TC-SYNC-STATE-005B: load() fills in empty issues/confluence sections independently when either key is missing from otherwise-valid JSON', () => {
  console.log('[TC-SYNC-STATE-005B] step 1: writing valid JSON missing the "confluence" key');
  const statePath = makeTempPath();
  fs.writeFileSync(
    statePath,
    JSON.stringify({ issues: { 'PROJ-1': { issue_updated_at: 'x', comment_ids: [] } } }),
    'utf8'
  );
  const state = new SyncState(statePath);
  console.log(
    '[TC-SYNC-STATE-005B] step 2: calling load() and asserting confluence defaults to {} while issues is preserved'
  );
  state.load();
  assert.deepEqual(state.getIssue('PROJ-1'), { issue_updated_at: 'x', comment_ids: [] });
  assert.deepEqual(state.allPages(), []);

  console.log('[TC-SYNC-STATE-005B] step 3: writing valid JSON missing the "issues" key');
  const statePath2 = makeTempPath();
  fs.writeFileSync(
    statePath2,
    JSON.stringify({ confluence: { 1: { lastModified: 'x', path: 'p.md', title: 'T' } } }),
    'utf8'
  );
  const state2 = new SyncState(statePath2);
  console.log(
    '[TC-SYNC-STATE-005B] step 4: calling load() and asserting issues defaults to {} while confluence is preserved'
  );
  state2.load();
  assert.equal(state2.getIssue('PROJ-1'), undefined);
  assert.deepEqual(state2.getPage('1'), { lastModified: 'x', path: 'p.md', title: 'T' });
});

test('TC-SYNC-STATE-006B: allPages() returns [pageId, meta] entries from the confluence section', () => {
  console.log('[TC-SYNC-STATE-006B] step 1: creating a SyncState, loading, and setting two pages');
  const state = new SyncState(makeTempPath());
  state.load();
  state.setPage('1', { lastModified: 'a', path: 'p1.md', title: 'One' });
  state.setPage('2', { lastModified: 'b', path: 'p2.md', title: 'Two' });
  console.log(
    '[TC-SYNC-STATE-006B] step 2: calling allPages() and asserting both entries are present'
  );
  const entries = state.allPages();
  assert.deepEqual(new Set(entries.map(([id]) => id)), new Set(['1', '2']));
});

test('TC-SYNC-STATE-007: save() writes atomically, leaving no leftover temp file next to the target', () => {
  console.log('[TC-SYNC-STATE-007] step 1: creating a SyncState, loading, and setting one issue');
  const statePath = makeTempPath();
  const state = new SyncState(statePath);
  state.load();
  state.setIssue('PROJ-1', { issue_updated_at: '2026-09-01T00:00:00Z', comment_ids: [] });
  console.log('[TC-SYNC-STATE-007] step 2: calling save() and inspecting the directory');
  state.save();
  const dir = path.dirname(statePath);
  const entries = fs.readdirSync(dir);
  console.log(
    '[TC-SYNC-STATE-007] step 3: asserting only the target file exists, no .tmp-* artifact'
  );
  assert.deepEqual(entries, [path.basename(statePath)]);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).issues, {
    'PROJ-1': { issue_updated_at: '2026-09-01T00:00:00Z', comment_ids: [] },
  });
});

test('TC-SYNC-STATE-008: load() backs up corrupt JSON to a sibling file and warns instead of silently discarding it', t => {
  console.log('[TC-SYNC-STATE-008] step 1: writing invalid JSON to a temp state file');
  const statePath = makeTempPath();
  const badContent = '{ not valid json';
  fs.writeFileSync(statePath, badContent, 'utf8');
  t.mock.method(console, 'error');
  const state = new SyncState(statePath);
  console.log('[TC-SYNC-STATE-008] step 2: calling load()');
  state.load();
  console.log(
    '[TC-SYNC-STATE-008] step 3: asserting a backup file with the corrupt content was created alongside the original'
  );
  const dir = path.dirname(statePath);
  const backups = fs.readdirSync(dir).filter(f => f !== path.basename(statePath));
  assert.equal(backups.length, 1);
  assert.match(backups[0], new RegExp(`^${path.basename(statePath)}\\.corrupt-`));
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), badContent);
  console.log(
    '[TC-SYNC-STATE-008] step 4: asserting console.error was called to surface the warning'
  );
  assert.equal(console.error.mock.calls.length, 1);
  console.log('[TC-SYNC-STATE-008] step 5: asserting state is still reset to empty');
  assert.equal(state.getIssue('PROJ-1'), undefined);
});

test('TC-SYNC-STATE-006: deletePage() removes a page from the confluence section', () => {
  console.log('[TC-SYNC-STATE-006] step 1: creating a SyncState, loading, and setting one page');
  const state = new SyncState(makeTempPath());
  state.load();
  state.setPage('100000001', { lastModified: 'x', path: 'p.md', title: 'Title' });
  console.log('[TC-SYNC-STATE-006] step 2: calling deletePage()');
  state.deletePage('100000001');
  console.log('[TC-SYNC-STATE-006] step 3: asserting getPage() now returns undefined');
  assert.equal(state.getPage('100000001'), undefined);
});
