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

test('TC-SYNC-STATE-001: load() on a missing file starts with empty state', () => {
  console.log('[TC-SYNC-STATE-001] step 1: creating a SyncState pointed at a non-existent file');
  const state = new SyncState(makeTempPath());
  console.log('[TC-SYNC-STATE-001] step 2: calling load()');
  state.load();
  console.log('[TC-SYNC-STATE-001] step 3: asserting get() returns undefined for any key');
  assert.equal(state.get('PROJ-1'), undefined);
});

test('TC-SYNC-STATE-002: set() then get() round-trips per-issue metadata in memory', () => {
  console.log('[TC-SYNC-STATE-002] step 1: creating a SyncState and loading empty state');
  const state = new SyncState(makeTempPath());
  state.load();
  console.log('[TC-SYNC-STATE-002] step 2: set() metadata for PROJ-1');
  state.set('PROJ-1', { issue_updated_at: '2026-09-01T00:00:00Z', comment_ids: ['10088'] });
  console.log('[TC-SYNC-STATE-002] step 3: asserting get() returns exactly what was set');
  assert.deepEqual(state.get('PROJ-1'), {
    issue_updated_at: '2026-09-01T00:00:00Z',
    comment_ids: ['10088'],
  });
});

test('TC-SYNC-STATE-003: save() then a fresh load() round-trips state to disk', () => {
  console.log('[TC-SYNC-STATE-003] step 1: creating a SyncState, loading, and setting one issue');
  const statePath = makeTempPath();
  const state = new SyncState(statePath);
  state.load();
  state.set('PROJ-1', { issue_updated_at: '2026-09-01T00:00:00Z', comment_ids: [] });
  console.log(`[TC-SYNC-STATE-003] step 2: calling save() to ${statePath}`);
  state.save();
  console.log('[TC-SYNC-STATE-003] step 3: creating a second SyncState instance over the same path and loading it');
  const reloaded = new SyncState(statePath);
  reloaded.load();
  console.log('[TC-SYNC-STATE-003] step 4: asserting the reloaded instance sees the same metadata');
  assert.deepEqual(reloaded.get('PROJ-1'), {
    issue_updated_at: '2026-09-01T00:00:00Z',
    comment_ids: [],
  });
});

test('TC-SYNC-STATE-004: load() tolerates and resets on invalid JSON rather than throwing', () => {
  console.log('[TC-SYNC-STATE-004] step 1: writing invalid JSON to a temp state file');
  const statePath = makeTempPath();
  fs.writeFileSync(statePath, '{ not valid json', 'utf8');
  const state = new SyncState(statePath);
  console.log('[TC-SYNC-STATE-004] step 2: calling load() and asserting it does not throw');
  assert.doesNotThrow(() => state.load());
  console.log('[TC-SYNC-STATE-004] step 3: asserting state is empty after tolerating the bad file');
  assert.equal(state.get('PROJ-1'), undefined);
});
