import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TrackedKeysConfig } from '../../src/sync/TrackedKeysConfig.js';

function makeTempPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-trackedkeys-'));
  return path.join(dir, 'jiraFedrunek.toml');
}

test('TC-SYNC-TRACKEDKEYS-001: load() returns an empty array when no config file exists', () => {
  console.log('[TC-SYNC-TRACKEDKEYS-001] step 1: creating a TrackedKeysConfig pointed at a non-existent file');
  const config = new TrackedKeysConfig(makeTempPath());
  console.log('[TC-SYNC-TRACKEDKEYS-001] step 2: calling load() and asserting []');
  assert.deepEqual(config.load(), []);
});

test('TC-SYNC-TRACKEDKEYS-002: load() parses tracked_keys from an existing TOML file', () => {
  console.log('[TC-SYNC-TRACKEDKEYS-002] step 1: writing a TOML file with tracked_keys directly');
  const configPath = makeTempPath();
  fs.writeFileSync(configPath, 'tracked_keys = ["PROJ-1", "PROJ-2"]\n', 'utf8');
  console.log('[TC-SYNC-TRACKEDKEYS-002] step 2: loading it via TrackedKeysConfig and asserting the parsed array');
  const config = new TrackedKeysConfig(configPath);
  assert.deepEqual(config.load(), ['PROJ-1', 'PROJ-2']);
});

test('TC-SYNC-TRACKEDKEYS-003: add() creates the file and persists a new tracked key', () => {
  console.log('[TC-SYNC-TRACKEDKEYS-003] step 1: creating a TrackedKeysConfig pointed at a non-existent file');
  const configPath = makeTempPath();
  const config = new TrackedKeysConfig(configPath);
  console.log('[TC-SYNC-TRACKEDKEYS-003] step 2: calling add(["PROJ-1"])');
  const result = config.add(['PROJ-1']);
  console.log(`[TC-SYNC-TRACKEDKEYS-003] step 3: asserting returned list and round-trip via a fresh instance, got: ${JSON.stringify(result)}`);
  assert.deepEqual(result, ['PROJ-1']);
  assert.deepEqual(new TrackedKeysConfig(configPath).load(), ['PROJ-1']);
});

test('TC-SYNC-TRACKEDKEYS-004: add() appends to existing tracked_keys without dropping prior entries', () => {
  console.log('[TC-SYNC-TRACKEDKEYS-004] step 1: creating a config already tracking PROJ-1');
  const configPath = makeTempPath();
  const config = new TrackedKeysConfig(configPath);
  config.add(['PROJ-1']);
  console.log('[TC-SYNC-TRACKEDKEYS-004] step 2: calling add(["PROJ-2"])');
  const result = config.add(['PROJ-2']);
  console.log(`[TC-SYNC-TRACKEDKEYS-004] step 3: asserting both keys present, got: ${JSON.stringify(result)}`);
  assert.deepEqual(result, ['PROJ-1', 'PROJ-2']);
});

test('TC-SYNC-TRACKEDKEYS-005: add() is idempotent for an already-tracked key', () => {
  console.log('[TC-SYNC-TRACKEDKEYS-005] step 1: creating a config already tracking PROJ-1');
  const configPath = makeTempPath();
  const config = new TrackedKeysConfig(configPath);
  config.add(['PROJ-1']);
  console.log('[TC-SYNC-TRACKEDKEYS-005] step 2: calling add(["PROJ-1"]) again');
  const result = config.add(['PROJ-1']);
  console.log(`[TC-SYNC-TRACKEDKEYS-005] step 3: asserting no duplicate entry, got: ${JSON.stringify(result)}`);
  assert.deepEqual(result, ['PROJ-1']);
});
