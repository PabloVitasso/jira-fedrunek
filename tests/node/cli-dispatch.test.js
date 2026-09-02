import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../../src/cli.js';

function makeAuthSession(overrides = {}) {
  return {
    getAccessToken: async () => 'access-token-1',
    getCloudId: async () => 'cloud-1',
    ...overrides,
  };
}

function makeSyncEngine(overrides = {}) {
  return {
    syncAll: async (keys) => keys.map((key) => ({ status: 'created', key })),
    ...overrides,
  };
}

function makeTrackedKeysConfig(overrides = {}) {
  return {
    load: () => [],
    add: (keys) => keys,
    ...overrides,
  };
}

test('TC-CLI-DISPATCH-001: "login" command runs AuthSession.getAccessToken and reports success', async () => {
  console.log('[TC-CLI-DISPATCH-001] step 1: wiring a fake AuthSession that resolves a token');
  let called = false;
  const authSession = makeAuthSession({ getAccessToken: async () => { called = true; return 'access-token-1'; } });
  console.log('[TC-CLI-DISPATCH-001] step 2: calling dispatch("login", [], { authSession })');
  const result = await dispatch('login', [], { authSession, syncEngine: makeSyncEngine() });
  console.log(`[TC-CLI-DISPATCH-001] step 3: asserting getAccessToken was called and status "logged_in", got: ${JSON.stringify(result)}, called=${called}`);
  assert.equal(called, true);
  assert.deepEqual(result, { status: 'logged_in' });
});

test('TC-CLI-DISPATCH-002: "sync" command runs SyncEngine.syncAll with the given issue keys', async () => {
  console.log('[TC-CLI-DISPATCH-002] step 1: wiring a fake SyncEngine capturing the keys it was called with');
  let capturedKeys;
  const syncEngine = makeSyncEngine({
    syncAll: async (keys) => { capturedKeys = keys; return keys.map((key) => ({ status: 'created', key })); },
  });
  console.log('[TC-CLI-DISPATCH-002] step 2: calling dispatch("sync", ["PROJ-1", "PROJ-2"], { syncEngine })');
  const result = await dispatch('sync', ['PROJ-1', 'PROJ-2'], { authSession: makeAuthSession(), syncEngine });
  console.log(`[TC-CLI-DISPATCH-002] step 3: asserting syncAll called with the given keys and results returned, got: ${JSON.stringify(result)}`);
  assert.deepEqual(capturedKeys, ['PROJ-1', 'PROJ-2']);
  assert.deepEqual(result, {
    status: 'synced',
    results: [
      { status: 'created', key: 'PROJ-1' },
      { status: 'created', key: 'PROJ-2' },
    ],
  });
});

test('TC-CLI-DISPATCH-003: an unknown command rejects rather than silently doing nothing', async () => {
  console.log('[TC-CLI-DISPATCH-003] step 1: calling dispatch("bogus", [], { ... }) and asserting it rejects');
  await assert.rejects(
    () => dispatch('bogus', [], { authSession: makeAuthSession(), syncEngine: makeSyncEngine(), trackedKeysConfig: makeTrackedKeysConfig() }),
    /unknown command: bogus/,
  );
});

test('TC-CLI-DISPATCH-004: "sync" with no issue keys loads tracked_keys from TrackedKeysConfig', async () => {
  console.log('[TC-CLI-DISPATCH-004] step 1: wiring a TrackedKeysConfig with two tracked keys and a fake SyncEngine capturing its input');
  let capturedKeys;
  const syncEngine = makeSyncEngine({
    syncAll: async (keys) => { capturedKeys = keys; return keys.map((key) => ({ status: 'unchanged', key })); },
  });
  const trackedKeysConfig = makeTrackedKeysConfig({ load: () => ['PROJ-1', 'PROJ-2'] });
  console.log('[TC-CLI-DISPATCH-004] step 2: calling dispatch("sync", [], { syncEngine, trackedKeysConfig })');
  const result = await dispatch('sync', [], { authSession: makeAuthSession(), syncEngine, trackedKeysConfig });
  console.log(`[TC-CLI-DISPATCH-004] step 3: asserting syncAll was called with the tracked keys, got: ${JSON.stringify(result)}`);
  assert.deepEqual(capturedKeys, ['PROJ-1', 'PROJ-2']);
  assert.equal(result.status, 'synced');
});

test('TC-CLI-DISPATCH-005: "track" command adds the given keys via TrackedKeysConfig.add and reports the updated list', async () => {
  console.log('[TC-CLI-DISPATCH-005] step 1: wiring a fake TrackedKeysConfig capturing what it was asked to add');
  let capturedKeys;
  const trackedKeysConfig = makeTrackedKeysConfig({
    add: (keys) => { capturedKeys = keys; return ['PROJ-1', 'PROJ-3']; },
  });
  console.log('[TC-CLI-DISPATCH-005] step 2: calling dispatch("track", ["PROJ-3"], { trackedKeysConfig })');
  const result = await dispatch('track', ['PROJ-3'], {
    authSession: makeAuthSession(),
    syncEngine: makeSyncEngine(),
    trackedKeysConfig,
  });
  console.log(`[TC-CLI-DISPATCH-005] step 3: asserting add() was called with the given keys and the updated list is reported, got: ${JSON.stringify(result)}`);
  assert.deepEqual(capturedKeys, ['PROJ-3']);
  assert.deepEqual(result, { status: 'tracked', keys: ['PROJ-1', 'PROJ-3'] });
});
