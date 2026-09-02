import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TokenStore } from '../../src/auth/TokenStore.js';

function makeTempPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-tokenstore-'));
  return path.join(dir, '.oauth-tokens.json');
}

function makeTokens(overrides = {}) {
  return {
    access_token: 'access-abc',
    refresh_token: 'refresh-abc',
    expires_at: '2026-09-02T15:03:00Z',
    cloud_id: 'cloud-abc',
    ...overrides,
  };
}

test('TC-AUTH-TOKENSTORE-001: load() returns null when no file exists', () => {
  console.log('[TC-AUTH-TOKENSTORE-001] step 1: creating a TokenStore pointed at a non-existent file');
  const store = new TokenStore(makeTempPath());
  console.log('[TC-AUTH-TOKENSTORE-001] step 2: calling load() and asserting null');
  assert.equal(store.load(), null);
});

test('TC-AUTH-TOKENSTORE-002: save() then load() round-trips tokens to disk', () => {
  console.log('[TC-AUTH-TOKENSTORE-002] step 1: creating a TokenStore and saving tokens');
  const tokenPath = makeTempPath();
  const store = new TokenStore(tokenPath);
  store.save(makeTokens());
  console.log('[TC-AUTH-TOKENSTORE-002] step 2: creating a fresh TokenStore over the same path and loading it');
  const reloaded = new TokenStore(tokenPath);
  console.log('[TC-AUTH-TOKENSTORE-002] step 3: asserting the reloaded tokens match what was saved');
  assert.deepEqual(reloaded.load(), makeTokens());
});

test('TC-AUTH-TOKENSTORE-003: isExpired() returns true when expires_at is in the past', () => {
  console.log('[TC-AUTH-TOKENSTORE-003] step 1: saving tokens with expires_at in the past');
  const store = new TokenStore(makeTempPath());
  store.save(makeTokens({ expires_at: '2020-01-01T00:00:00Z' }));
  console.log('[TC-AUTH-TOKENSTORE-003] step 2: asserting isExpired() is true');
  assert.equal(store.isExpired(), true);
});

test('TC-AUTH-TOKENSTORE-004: isExpired() returns false when expires_at is in the future', () => {
  console.log('[TC-AUTH-TOKENSTORE-004] step 1: saving tokens with expires_at far in the future');
  const store = new TokenStore(makeTempPath());
  store.save(makeTokens({ expires_at: '2999-01-01T00:00:00Z' }));
  console.log('[TC-AUTH-TOKENSTORE-004] step 2: asserting isExpired() is false');
  assert.equal(store.isExpired(), false);
});

test('TC-AUTH-TOKENSTORE-005: isExpired() returns true when no tokens are loaded', () => {
  console.log('[TC-AUTH-TOKENSTORE-005] step 1: creating a TokenStore pointed at a non-existent file, no save() or load() called');
  const store = new TokenStore(makeTempPath());
  console.log('[TC-AUTH-TOKENSTORE-005] step 2: asserting isExpired() treats absent tokens as expired');
  assert.equal(store.isExpired(), true);
});

test('TC-AUTH-TOKENSTORE-006: save() hardens the token file to 0600 (owner read/write only)', () => {
  console.log('[TC-AUTH-TOKENSTORE-006] step 1: creating a TokenStore and saving tokens');
  const tokenPath = makeTempPath();
  const store = new TokenStore(tokenPath);
  store.save(makeTokens());
  console.log('[TC-AUTH-TOKENSTORE-006] step 2: stat-ing the file and asserting mode is 0600');
  const mode = fs.statSync(tokenPath).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('TC-AUTH-TOKENSTORE-007: save() creates missing parent directories', () => {
  console.log('[TC-AUTH-TOKENSTORE-007] step 1: creating a temp dir, target nested under an unmade subdir');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-tokenstore-'));
  const tokenPath = path.join(dir, 'nested', 'deeper', 'oauth-tokens.json');
  const store = new TokenStore(tokenPath);
  console.log(`[TC-AUTH-TOKENSTORE-007] step 2: saving to ${tokenPath} without pre-creating parents`);
  store.save(makeTokens());
  console.log('[TC-AUTH-TOKENSTORE-007] step 3: asserting the file exists with the right content');
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenPath, 'utf8')), makeTokens());
});
