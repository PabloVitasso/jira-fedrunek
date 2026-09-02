import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileWriter } from '../../src/sync/FileWriter.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-filewriter-'));
}

test('TC-SYNC-FILEWRITER-001: write then read round-trips file content', () => {
  console.log('[TC-SYNC-FILEWRITER-001] step 1: creating a temp dir and a FileWriter instance');
  const dir = makeTempDir();
  const target = path.join(dir, 'PROJ-1.md');
  const writer = new FileWriter();
  console.log(`[TC-SYNC-FILEWRITER-001] step 2: writing content to ${target}`);
  writer.write(target, '# hello\n');
  console.log('[TC-SYNC-FILEWRITER-001] step 3: reading it back and asserting round-trip');
  const result = writer.read(target);
  assert.equal(result, '# hello\n');
});

test('TC-SYNC-FILEWRITER-002: read returns null for a missing file', () => {
  console.log('[TC-SYNC-FILEWRITER-002] step 1: creating a temp dir with no target file');
  const dir = makeTempDir();
  const target = path.join(dir, 'does-not-exist.md');
  const writer = new FileWriter();
  console.log(
    `[TC-SYNC-FILEWRITER-002] step 2: reading ${target} and asserting null (not a throw)`
  );
  const result = writer.read(target);
  assert.equal(result, null);
});

test('TC-SYNC-FILEWRITER-003: write creates missing parent directories', () => {
  console.log(
    '[TC-SYNC-FILEWRITER-003] step 1: creating a temp dir, target nested under an unmade subdir'
  );
  const dir = makeTempDir();
  const target = path.join(dir, 'nested', 'deeper', 'PROJ-2.md');
  const writer = new FileWriter();
  console.log(`[TC-SYNC-FILEWRITER-003] step 2: writing to ${target} without pre-creating parents`);
  writer.write(target, 'body');
  console.log('[TC-SYNC-FILEWRITER-003] step 3: asserting the file exists with the right content');
  assert.equal(fs.readFileSync(target, 'utf8'), 'body');
});
