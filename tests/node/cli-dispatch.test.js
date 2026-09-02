import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loginCommand,
  syncCommand,
  trackCommand,
  confluencePageCommand,
  confluenceDirCommand,
  confluenceDirsCommand,
  confluencePagesCommand,
  confluenceSyncCommand,
} from '../../src/cli.js';

function makeSyncEngine(overrides = {}) {
  return {
    syncAll: async keys => keys.map(key => ({ status: 'created', key })),
    ...overrides,
  };
}

function makeTrackedKeysConfig(overrides = {}) {
  return {
    load: () => [],
    add: keys => keys,
    ...overrides,
  };
}

function makeConfluenceSyncEngine(overrides = {}) {
  return {
    syncPage: async id => ({ status: 'created', id }),
    syncDir: async (folderId, label) => ({ folderId, label, fetched: 0 }),
    syncDirs: async dirs => dirs.map(d => ({ folderId: d.folderId })),
    syncPages: async pages => pages.map(p => ({ id: p.id })),
    syncSpaces: async keys => ({ total: 0, spaceKeys: keys }),
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    syncEngine: makeSyncEngine(),
    trackedKeysConfig: makeTrackedKeysConfig(),
    confluenceSyncEngine: makeConfluenceSyncEngine(),
    watchDirs: [],
    watchPages: [],
    spaceKeys: [],
    ...overrides,
  };
}

test('TC-CLI-DISPATCH-001: loginCommand reports success (connection lifecycle is now owned by run(), not the handler)', async () => {
  console.log('[TC-CLI-DISPATCH-001] step 1: calling loginCommand([], deps)');
  const result = await loginCommand([], baseDeps());
  console.log(
    `[TC-CLI-DISPATCH-001] step 2: asserting status "logged_in", got: ${JSON.stringify(result)}`
  );
  assert.deepEqual(result, { status: 'logged_in' });
});

test('TC-CLI-DISPATCH-002: syncCommand runs SyncEngine.syncAll with the given issue keys', async () => {
  console.log(
    '[TC-CLI-DISPATCH-002] step 1: wiring a fake SyncEngine capturing the keys it was called with'
  );
  let capturedKeys;
  const syncEngine = makeSyncEngine({
    syncAll: async keys => {
      capturedKeys = keys;
      return keys.map(key => ({ status: 'created', key }));
    },
  });
  console.log('[TC-CLI-DISPATCH-002] step 2: calling syncCommand(["PROJ-1", "PROJ-2"], deps)');
  const result = await syncCommand(['PROJ-1', 'PROJ-2'], baseDeps({ syncEngine }));
  console.log(
    `[TC-CLI-DISPATCH-002] step 3: asserting syncAll called with the given keys and results returned, got: ${JSON.stringify(result)}`
  );
  assert.deepEqual(capturedKeys, ['PROJ-1', 'PROJ-2']);
  assert.deepEqual(result, {
    status: 'synced',
    results: [
      { status: 'created', key: 'PROJ-1' },
      { status: 'created', key: 'PROJ-2' },
    ],
  });
});

test('TC-CLI-DISPATCH-004: syncCommand with no issue keys loads tracked_keys from TrackedKeysConfig', async () => {
  console.log(
    '[TC-CLI-DISPATCH-004] step 1: wiring a TrackedKeysConfig with two tracked keys and a fake SyncEngine capturing its input'
  );
  let capturedKeys;
  const syncEngine = makeSyncEngine({
    syncAll: async keys => {
      capturedKeys = keys;
      return keys.map(key => ({ status: 'unchanged', key }));
    },
  });
  const trackedKeysConfig = makeTrackedKeysConfig({ load: () => ['PROJ-1', 'PROJ-2'] });
  console.log('[TC-CLI-DISPATCH-004] step 2: calling syncCommand([], deps)');
  const result = await syncCommand([], baseDeps({ syncEngine, trackedKeysConfig }));
  console.log(
    `[TC-CLI-DISPATCH-004] step 3: asserting syncAll was called with the tracked keys, got: ${JSON.stringify(result)}`
  );
  assert.deepEqual(capturedKeys, ['PROJ-1', 'PROJ-2']);
  assert.equal(result.status, 'synced');
});

test('TC-CLI-DISPATCH-005: trackCommand adds the given keys via TrackedKeysConfig.add and reports the updated list', async () => {
  console.log(
    '[TC-CLI-DISPATCH-005] step 1: wiring a fake TrackedKeysConfig capturing what it was asked to add'
  );
  let capturedKeys;
  const trackedKeysConfig = makeTrackedKeysConfig({
    add: keys => {
      capturedKeys = keys;
      return ['PROJ-1', 'PROJ-3'];
    },
  });
  console.log('[TC-CLI-DISPATCH-005] step 2: calling trackCommand(["PROJ-3"], deps)');
  const result = await trackCommand(['PROJ-3'], baseDeps({ trackedKeysConfig }));
  console.log(
    `[TC-CLI-DISPATCH-005] step 3: asserting add() was called with the given keys and the updated list is reported, got: ${JSON.stringify(result)}`
  );
  assert.deepEqual(capturedKeys, ['PROJ-3']);
  assert.deepEqual(result, { status: 'tracked', keys: ['PROJ-1', 'PROJ-3'] });
});

test('TC-CLI-DISPATCH-006: confluencePageCommand dispatches to ConfluenceSyncEngine.syncPage', async () => {
  console.log(
    '[TC-CLI-DISPATCH-006] step 1: wiring a fake ConfluenceSyncEngine capturing the page id'
  );
  let capturedId;
  const confluenceSyncEngine = makeConfluenceSyncEngine({
    syncPage: async id => {
      capturedId = id;
      return { status: 'created', id };
    },
  });
  console.log('[TC-CLI-DISPATCH-006] step 2: calling confluencePageCommand(["100000001"], deps)');
  const result = await confluencePageCommand(['100000001'], baseDeps({ confluenceSyncEngine }));
  console.log(
    `[TC-CLI-DISPATCH-006] step 3: asserting syncPage was called with the given id, got: ${JSON.stringify(result)}`
  );
  assert.equal(capturedId, '100000001');
  assert.deepEqual(result, {
    status: 'confluence',
    verb: 'page',
    result: { status: 'created', id: '100000001' },
  });
});

test('TC-CLI-DISPATCH-007: confluenceDirCommand resolves a label from watchDirs when present', async () => {
  console.log(
    '[TC-CLI-DISPATCH-007] step 1: wiring a fake ConfluenceSyncEngine capturing folderId/label, plus a matching watchDirs entry'
  );
  let captured;
  const confluenceSyncEngine = makeConfluenceSyncEngine({
    syncDir: async (folderId, label) => {
      captured = { folderId, label };
      return { folderId, label };
    },
  });
  const watchDirs = [{ folderId: '100000002', label: 'My Folder' }];
  console.log('[TC-CLI-DISPATCH-007] step 2: calling confluenceDirCommand(["100000002"], deps)');
  await confluenceDirCommand(['100000002'], baseDeps({ confluenceSyncEngine, watchDirs }));
  console.log(
    `[TC-CLI-DISPATCH-007] step 3: asserting the watchDirs label was resolved, got: ${JSON.stringify(captured)}`
  );
  assert.deepEqual(captured, { folderId: '100000002', label: 'My Folder' });
});

test('TC-CLI-DISPATCH-007B: confluenceDirCommand falls back to using the id as its own label when not found in watchDirs', async () => {
  console.log(
    '[TC-CLI-DISPATCH-007B] step 1: wiring a fake ConfluenceSyncEngine capturing folderId/label, with an empty watchDirs list'
  );
  let captured;
  const confluenceSyncEngine = makeConfluenceSyncEngine({
    syncDir: async (folderId, label) => {
      captured = { folderId, label };
      return { folderId, label };
    },
  });
  console.log(
    '[TC-CLI-DISPATCH-007B] step 2: calling confluenceDirCommand(["999"], deps) with watchDirs: []'
  );
  await confluenceDirCommand(['999'], baseDeps({ confluenceSyncEngine, watchDirs: [] }));
  console.log(
    `[TC-CLI-DISPATCH-007B] step 3: asserting the id itself was used as both folderId and label, got: ${JSON.stringify(captured)}`
  );
  assert.deepEqual(captured, { folderId: '999', label: '999' });
});

test('TC-CLI-DISPATCH-008: confluenceDirsCommand dispatches to ConfluenceSyncEngine.syncDirs with the configured watchDirs', async () => {
  console.log(
    '[TC-CLI-DISPATCH-008] step 1: wiring a fake ConfluenceSyncEngine capturing the watchDirs list'
  );
  let capturedDirs;
  const confluenceSyncEngine = makeConfluenceSyncEngine({
    syncDirs: async dirs => {
      capturedDirs = dirs;
      return dirs;
    },
  });
  const watchDirs = [
    { folderId: '1', label: 'A' },
    { folderId: '2', label: 'B' },
  ];
  console.log('[TC-CLI-DISPATCH-008] step 2: calling confluenceDirsCommand([], deps)');
  await confluenceDirsCommand([], baseDeps({ confluenceSyncEngine, watchDirs }));
  console.log(
    `[TC-CLI-DISPATCH-008] step 3: asserting syncDirs was called with watchDirs, got: ${JSON.stringify(capturedDirs)}`
  );
  assert.deepEqual(capturedDirs, watchDirs);
});

test('TC-CLI-DISPATCH-009: confluenceSyncCommand dispatches to ConfluenceSyncEngine.syncSpaces with the configured spaceKeys', async () => {
  console.log(
    '[TC-CLI-DISPATCH-009] step 1: wiring a fake ConfluenceSyncEngine capturing the spaceKeys list'
  );
  let capturedKeys;
  const confluenceSyncEngine = makeConfluenceSyncEngine({
    syncSpaces: async keys => {
      capturedKeys = keys;
      return { total: keys.length };
    },
  });
  console.log(
    '[TC-CLI-DISPATCH-009] step 2: calling confluenceSyncCommand([], deps) with spaceKeys: ["ARCHDOCS"]'
  );
  await confluenceSyncCommand([], baseDeps({ confluenceSyncEngine, spaceKeys: ['ARCHDOCS'] }));
  console.log(
    `[TC-CLI-DISPATCH-009] step 3: asserting syncSpaces was called with spaceKeys, got: ${JSON.stringify(capturedKeys)}`
  );
  assert.deepEqual(capturedKeys, ['ARCHDOCS']);
});

test('TC-CLI-DISPATCH-009B: confluencePagesCommand dispatches to ConfluenceSyncEngine.syncPages with the configured watchPages', async () => {
  console.log(
    '[TC-CLI-DISPATCH-009B] step 1: wiring a fake ConfluenceSyncEngine capturing the watchPages list'
  );
  let capturedPages;
  const confluenceSyncEngine = makeConfluenceSyncEngine({
    syncPages: async pages => {
      capturedPages = pages;
      return pages.map(p => ({ id: p.id }));
    },
  });
  const watchPages = [{ id: '1' }, { id: '2' }];
  console.log('[TC-CLI-DISPATCH-009B] step 2: calling confluencePagesCommand([], deps)');
  await confluencePagesCommand([], baseDeps({ confluenceSyncEngine, watchPages }));
  console.log(
    `[TC-CLI-DISPATCH-009B] step 3: asserting syncPages was called with watchPages, got: ${JSON.stringify(capturedPages)}`
  );
  assert.deepEqual(capturedPages, watchPages);
});
