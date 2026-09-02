import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../src/index.js';

async function captureStdio(fn) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args) => stdout.push(args.join(' '));
  console.error = (...args) => stderr.push(args.join(' '));
  process.stdout.write = chunk => {
    stdout.push(chunk.toString());
    return true;
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stdout.write = originalWrite;
  }
  return { stdout, stderr };
}

test('TC-INDEX-MAIN-001: main() end-to-end under --json emits exactly one JSON document to stdout for "track" (no network needed)', async () => {
  console.log(
    '[TC-INDEX-MAIN-001] step 1: making a scratch cwd and running "track PROJ-1 --json" through the real main()'
  );
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-main-json-'));
  const originalArgv = process.argv;
  process.argv = ['node', 'jiraFedrunek', 'track', 'PROJ-1', '--json'];
  let stdout, stderr;
  try {
    ({ stdout, stderr } = await captureStdio(() => main(cwd)));
  } finally {
    process.argv = originalArgv;
  }
  console.log(
    `[TC-INDEX-MAIN-001] step 2: asserting stdout is exactly one JSON doc, got stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`
  );
  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: true,
    command: 'track',
    data: { status: 'tracked', keys: ['PROJ-1'] },
  });
});
