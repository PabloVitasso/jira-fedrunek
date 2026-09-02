import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram } from '../../src/router.js';

function makeMcpSession(overrides = {}) {
  return {
    connect: async () => {},
    close: async () => {},
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    mcpSession: makeMcpSession(),
    syncEngine: { syncAll: async keys => keys.map(key => ({ status: 'created', key })) },
    trackedKeysConfig: { load: () => [], add: keys => keys },
    confluenceSyncEngine: {
      syncPage: async id => ({ status: 'created', id }),
      syncDir: async (folderId, label) => ({ folderId, label }),
      syncDirs: async dirs => dirs,
      syncPages: async pages => pages,
      syncSpaces: async keys => ({ spaceKeys: keys }),
    },
    watchDirs: [],
    watchPages: [],
    spaceKeys: [],
    ...overrides,
  };
}

async function captureOutput(fn) {
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
    const result = await fn();
    return { result, stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stdout.write = originalWrite;
  }
}

async function parse(program, argv) {
  return program.parseAsync(['node', 'jiraFedrunek', ...argv]);
}

test('TC-ROUTER-001: full command name and alias produce identical results for identical arguments (sync/s)', async () => {
  console.log('[TC-ROUTER-001] step 1: wiring a fake SyncEngine capturing calls');
  const calls = [];
  const syncEngine = {
    syncAll: async keys => (calls.push(keys), keys.map(key => ({ status: 'created', key }))),
  };

  console.log(
    '[TC-ROUTER-001] step 2: running "sync PROJ-1" then "s PROJ-1", capturing stdout JSON both times'
  );
  const { stdout: out1 } = await captureOutput(() =>
    parse(buildProgram(baseDeps({ syncEngine })), ['--json', 'sync', 'PROJ-1'])
  );
  const { stdout: out2 } = await captureOutput(() =>
    parse(buildProgram(baseDeps({ syncEngine })), ['--json', 's', 'PROJ-1'])
  );
  console.log(
    `[TC-ROUTER-001] step 3: asserting both invocations produced identical JSON output, got out1=${out1} out2=${out2}`
  );
  assert.equal(out1.join(''), out2.join(''));
  assert.deepEqual(calls, [['PROJ-1'], ['PROJ-1']]);
});

async function withScratchExitCode(fn) {
  const original = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await fn();
    return { result, exitCode: process.exitCode };
  } finally {
    process.exitCode = original;
  }
}

test('TC-ROUTER-002: "cf s" (nested alias) reaches confluenceSyncCommand, scoped separately from top-level "s"', async () => {
  console.log('[TC-ROUTER-002] step 1: wiring a fake ConfluenceSyncEngine capturing spaceKeys');
  let captured;
  const confluenceSyncEngine = {
    syncSpaces: async keys => {
      captured = keys;
      return { spaceKeys: keys };
    },
  };
  console.log('[TC-ROUTER-002] step 2: running "cf s" with spaceKeys=["ARCHDOCS"]');
  await captureOutput(() =>
    parse(buildProgram(baseDeps({ confluenceSyncEngine, spaceKeys: ['ARCHDOCS'] })), ['cf', 's'])
  );
  console.log(
    `[TC-ROUTER-002] step 3: asserting syncSpaces was called with spaceKeys, got: ${JSON.stringify(captured)}`
  );
  assert.deepEqual(captured, ['ARCHDOCS']);
});

test('TC-ROUTER-003: --json emits exactly one { ok, command, data } JSON document to stdout with no step-log lines, diagnostics go to stderr', async () => {
  console.log('[TC-ROUTER-003] step 1: running "sync PROJ-1 --json"');
  const { stdout, stderr } = await captureOutput(() =>
    parse(buildProgram(baseDeps()), ['sync', 'PROJ-1', '--json'])
  );
  console.log(
    `[TC-ROUTER-003] step 2: asserting stdout is exactly one JSON doc, got stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`
  );
  assert.equal(stdout.length, 1);
  const parsed = JSON.parse(stdout[0]);
  assert.deepEqual(parsed, {
    ok: true,
    command: 'sync',
    data: { status: 'synced', results: [{ status: 'created', key: 'PROJ-1' }] },
  });
  assert.ok(
    stderr.some(line => line.includes('cli.syncCommand')),
    'step-logs should be on stderr under --json'
  );
});

test('TC-ROUTER-004: --json placed before the subcommand works identically to after', async () => {
  console.log('[TC-ROUTER-004] step 1: running "--json sync PROJ-1" (json before subcommand)');
  const { stdout } = await captureOutput(() =>
    parse(buildProgram(baseDeps()), ['--json', 'sync', 'PROJ-1'])
  );
  console.log(
    `[TC-ROUTER-004] step 2: asserting stdout is exactly one JSON doc, got: ${JSON.stringify(stdout)}`
  );
  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: true,
    command: 'sync',
    data: { status: 'synced', results: [{ status: 'created', key: 'PROJ-1' }] },
  });
});

test('TC-ROUTER-010: --json wraps each confluence subcommand in a command label matching "confluence.<verb>"', async () => {
  console.log('[TC-ROUTER-010] step 1: running "cf page 100000001 --json"');
  const { stdout } = await captureOutput(() =>
    parse(buildProgram(baseDeps()), ['cf', 'page', '100000001', '--json'])
  );
  console.log(
    `[TC-ROUTER-010] step 2: asserting command label is "confluence.page", got: ${JSON.stringify(stdout)}`
  );
  const parsed = JSON.parse(stdout[0]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, 'confluence.page');
  assert.deepEqual(parsed.data, {
    status: 'confluence',
    verb: 'page',
    result: { status: 'created', id: '100000001' },
  });
});

test('TC-ROUTER-011: --json on a failing command emits one { ok: false, error } JSON document to stdout instead of throwing, and marks the exit non-zero', async () => {
  console.log('[TC-ROUTER-011] step 1: wiring a SyncEngine that throws a plain Error("boom")');
  const syncEngine = {
    syncAll: async () => {
      throw new Error('boom');
    },
  };
  console.log('[TC-ROUTER-011] step 2: running "sync PROJ-1 --json" inside a scratch exitCode');
  const { result, exitCode } = await withScratchExitCode(() =>
    captureOutput(() => parse(buildProgram(baseDeps({ syncEngine })), ['sync', 'PROJ-1', '--json']))
  );
  console.log(
    `[TC-ROUTER-011] step 3: asserting one error-envelope JSON doc on stdout and non-zero exitCode, got stdout=${JSON.stringify(result.stdout)} exitCode=${exitCode}`
  );
  assert.equal(result.stdout.length, 1);
  assert.deepEqual(JSON.parse(result.stdout[0]), {
    ok: false,
    command: 'sync',
    error: { code: 'COMMAND_FAILED', message: 'boom' },
  });
  assert.notEqual(exitCode, 0);
  assert.notEqual(exitCode, undefined);
});

test("TC-ROUTER-012: --json error envelope uses a thrown error's own .code when present, instead of the generic fallback", async () => {
  console.log(
    '[TC-ROUTER-012] step 1: wiring a SyncEngine that throws an Error with a .code property'
  );
  const syncEngine = {
    syncAll: async () => {
      const err = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    },
  };
  console.log('[TC-ROUTER-012] step 2: running "sync PROJ-1 --json"');
  const { result } = await withScratchExitCode(() =>
    captureOutput(() => parse(buildProgram(baseDeps({ syncEngine })), ['sync', 'PROJ-1', '--json']))
  );
  console.log(
    `[TC-ROUTER-012] step 3: asserting the error envelope carries code "ENOENT", got: ${JSON.stringify(result.stdout)}`
  );
  assert.deepEqual(JSON.parse(result.stdout[0]), {
    ok: false,
    command: 'sync',
    error: { code: 'ENOENT', message: 'not found' },
  });
});

test('TC-ROUTER-013: without --json, a failing command still rejects (human mode error path is unchanged)', async () => {
  console.log(
    '[TC-ROUTER-013] step 1: wiring a SyncEngine that throws, running "sync PROJ-1" without --json'
  );
  const syncEngine = {
    syncAll: async () => {
      throw new Error('boom');
    },
  };
  await assert.rejects(
    () => captureOutput(() => parse(buildProgram(baseDeps({ syncEngine })), ['sync', 'PROJ-1'])),
    /boom/
  );
  console.log('[TC-ROUTER-013] step 2: confirmed rejection propagates as before in human mode');
});

test('TC-ROUTER-005: McpSession connects and closes around a command that needs it (sync)', async () => {
  console.log('[TC-ROUTER-005] step 1: wiring a fake McpSession recording connect/close calls');
  let connected = false;
  let closed = false;
  const mcpSession = makeMcpSession({
    connect: async () => {
      connected = true;
    },
    close: async () => {
      closed = true;
    },
  });
  console.log('[TC-ROUTER-005] step 2: running "sync PROJ-1"');
  await captureOutput(() => parse(buildProgram(baseDeps({ mcpSession })), ['sync', 'PROJ-1']));
  console.log(
    `[TC-ROUTER-005] step 3: asserting connect/close were both called, connected=${connected} closed=${closed}`
  );
  assert.equal(connected, true);
  assert.equal(closed, true);
});

test('TC-ROUTER-006: McpSession still closes when a command handler throws', async () => {
  console.log('[TC-ROUTER-006] step 1: wiring a fake McpSession and a SyncEngine that throws');
  let closed = false;
  const mcpSession = makeMcpSession({
    close: async () => {
      closed = true;
    },
  });
  const syncEngine = {
    syncAll: async () => {
      throw new Error('boom');
    },
  };
  console.log('[TC-ROUTER-006] step 2: running "sync PROJ-1" and expecting it to reject');
  await assert.rejects(
    () =>
      captureOutput(() =>
        parse(buildProgram(baseDeps({ mcpSession, syncEngine })), ['sync', 'PROJ-1'])
      ),
    /boom/
  );
  console.log(
    `[TC-ROUTER-006] step 3: asserting close() still ran despite the throw, closed=${closed}`
  );
  assert.equal(closed, true);
});

test('TC-ROUTER-007: track does not connect McpSession (never touches the network)', async () => {
  console.log('[TC-ROUTER-007] step 1: wiring a fake McpSession recording connect calls');
  let connected = false;
  const mcpSession = makeMcpSession({
    connect: async () => {
      connected = true;
    },
  });
  console.log('[TC-ROUTER-007] step 2: running "track PROJ-1"');
  await captureOutput(() => parse(buildProgram(baseDeps({ mcpSession })), ['track', 'PROJ-1']));
  console.log(
    `[TC-ROUTER-007] step 3: asserting connect() was never called, connected=${connected}`
  );
  assert.equal(connected, false);
});

test('TC-ROUTER-008: unknown command exits non-zero', async () => {
  console.log('[TC-ROUTER-008] step 1: running an unknown top-level command "bogus"');
  await assert.rejects(
    () => captureOutput(() => parse(buildProgram(baseDeps()), ['bogus'])),
    err => {
      console.log(
        `[TC-ROUTER-008] step 2: asserting a non-zero exitCode was thrown, got: ${JSON.stringify(err.exitCode)}`
      );
      assert.notEqual(err.exitCode, 0);
      return true;
    }
  );
});

test('TC-ROUTER-009: unknown option exits non-zero', async () => {
  console.log('[TC-ROUTER-009] step 1: running "sync --bogus-flag"');
  await assert.rejects(
    () => captureOutput(() => parse(buildProgram(baseDeps()), ['sync', '--bogus-flag'])),
    err => {
      console.log(
        `[TC-ROUTER-009] step 2: asserting a non-zero exitCode was thrown, got: ${JSON.stringify(err.exitCode)}`
      );
      assert.notEqual(err.exitCode, 0);
      return true;
    }
  );
});
