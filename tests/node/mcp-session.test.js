import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpSession } from '../../src/mcp/McpSession.js';

function makeFakeClient(overrides = {}) {
  return {
    connect: async () => {},
    callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    close: async () => {},
    ...overrides,
  };
}

function makeSession({ cloudId = 'cloud-1', client = makeFakeClient(), transport = {} } = {}) {
  return {
    session: new McpSession({
      cloudId,
      clientFactory: () => client,
      transportFactory: () => transport,
    }),
    client,
    transport,
  };
}

test('TC-MCP-SESSION-001: connect() builds client/transport via injected factories and calls client.connect(transport)', async () => {
  console.log(
    '[TC-MCP-SESSION-001] step 1: wiring a fake client capturing the transport it was connected with'
  );
  let capturedTransport;
  const transport = { marker: 'fake-transport' };
  const client = makeFakeClient({
    connect: async t => {
      capturedTransport = t;
    },
  });
  console.log('[TC-MCP-SESSION-001] step 2: calling connect()');
  const { session } = makeSession({ client, transport });
  await session.connect();
  console.log(
    `[TC-MCP-SESSION-001] step 3: asserting the injected transport was passed through, got: ${JSON.stringify(capturedTransport)}`
  );
  assert.equal(capturedTransport, transport);
});

test('TC-MCP-SESSION-002: callTool() calls client.callTool with { name, arguments: { cloudId, ...args } }', async () => {
  console.log('[TC-MCP-SESSION-002] step 1: wiring a fake client capturing the callTool request');
  let captured;
  const client = makeFakeClient({
    callTool: async request => {
      captured = request;
      return { content: [] };
    },
  });
  const { session } = makeSession({ cloudId: 'cloud-42', client });
  await session.connect();
  console.log(
    '[TC-MCP-SESSION-002] step 2: calling callTool("searchJiraIssuesUsingJql", { jql: "key = X" })'
  );
  await session.callTool('searchJiraIssuesUsingJql', { jql: 'key = X' });
  console.log(
    `[TC-MCP-SESSION-002] step 3: asserting cloudId is auto-injected alongside caller args, got: ${JSON.stringify(captured)}`
  );
  assert.equal(captured.name, 'searchJiraIssuesUsingJql');
  assert.deepEqual(captured.arguments, { cloudId: 'cloud-42', jql: 'key = X' });
});

test('TC-MCP-SESSION-003: callTool() returns the raw client.callTool result', async () => {
  console.log('[TC-MCP-SESSION-003] step 1: wiring a fake client returning a fixed result');
  const fakeResult = { content: [{ type: 'text', text: 'hello' }] };
  const client = makeFakeClient({ callTool: async () => fakeResult });
  const { session } = makeSession({ client });
  await session.connect();
  console.log(
    '[TC-MCP-SESSION-003] step 2: calling callTool and asserting the result is passed through unchanged'
  );
  const result = await session.callTool('getJiraIssue', { issueIdOrKey: 'X-1' });
  assert.deepEqual(result, fakeResult);
});

test('TC-MCP-SESSION-004: close() calls client.close() and swallows a rejected close (e.g. transport DOMException)', async () => {
  console.log(
    "[TC-MCP-SESSION-004] step 1: wiring a fake client whose close() rejects, mirroring mcp-remote's known close()-time DOMException"
  );
  let closeCalled = false;
  const client = makeFakeClient({
    close: async () => {
      closeCalled = true;
      throw new DOMException('closed');
    },
  });
  const { session } = makeSession({ client });
  await session.connect();
  console.log('[TC-MCP-SESSION-004] step 2: calling close() and asserting it does not throw');
  await assert.doesNotReject(() => session.close());
  console.log(
    `[TC-MCP-SESSION-004] step 3: asserting client.close() was actually invoked, closeCalled=${closeCalled}`
  );
  assert.equal(closeCalled, true);
});

function flushMicrotasks(n = 10) {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => {});
  return p;
}

test('TC-MCP-SESSION-006: callTool() retries after a failed attempt and returns the eventual success', async t => {
  console.log(
    '[TC-MCP-SESSION-006] step 1: wiring a fake client whose callTool rejects once then succeeds, with fake timers to skip the retry backoff'
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const client = makeFakeClient({
    callTool: async () => {
      attempts++;
      if (attempts === 1) throw new Error('transient failure');
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  });
  const { session } = makeSession({ client });
  await session.connect();
  console.log(
    '[TC-MCP-SESSION-006] step 2: calling callTool and advancing fake timers through the retry backoff'
  );
  const resultPromise = session.callTool('getJiraIssue', { issueIdOrKey: 'X-1' });
  for (let round = 0; round < 6; round++) {
    await flushMicrotasks();
    t.mock.timers.tick(20_000);
  }
  const result = await resultPromise;
  console.log(
    `[TC-MCP-SESSION-006] step 3: asserting two attempts were made and the successful result was returned, got attempts=${attempts}, result=${JSON.stringify(result)}`
  );
  assert.equal(attempts, 2);
  assert.deepEqual(result, { content: [{ type: 'text', text: 'ok' }] });
});

test('TC-MCP-SESSION-007: callTool() rejects once every attempt fails, having exhausted RETRY_COUNT retries', async t => {
  console.log(
    '[TC-MCP-SESSION-007] step 1: wiring a fake client whose callTool always rejects, with fake timers to skip the retry backoff'
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const client = makeFakeClient({
    callTool: async () => {
      attempts++;
      throw new Error('permanent failure');
    },
  });
  const { session } = makeSession({ client });
  await session.connect();
  console.log(
    '[TC-MCP-SESSION-007] step 2: calling callTool and advancing fake timers through every retry backoff'
  );
  const resultPromise = session.callTool('getJiraIssue', { issueIdOrKey: 'X-1' });
  resultPromise.catch(() => {});
  for (let round = 0; round < 10; round++) {
    await flushMicrotasks();
    t.mock.timers.tick(20_000);
  }
  console.log(
    `[TC-MCP-SESSION-007] step 3: asserting the call rejects after exhausting retries, got attempts=${attempts}`
  );
  await assert.rejects(() => resultPromise, /permanent failure/);
  assert.equal(attempts, 4);
});

test('TC-MCP-SESSION-008: connect() rejects when the client never resolves connect() within AUTH_TIMEOUT_S', async t => {
  console.log(
    '[TC-MCP-SESSION-008] step 1: wiring a fake client whose connect() never resolves, with fake timers to skip the real 90s wait'
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = makeFakeClient({ connect: () => new Promise(() => {}) });
  const { session } = makeSession({ client });
  console.log(
    '[TC-MCP-SESSION-008] step 2: calling connect() and advancing fake timers past AUTH_TIMEOUT_S (90s)'
  );
  const connectPromise = session.connect();
  connectPromise.catch(() => {});
  await flushMicrotasks();
  t.mock.timers.tick(90_000);
  console.log(
    '[TC-MCP-SESSION-008] step 3: asserting connect() rejects with the authorization-timeout message'
  );
  await assert.rejects(() => connectPromise, /Authorization timed out after 90s/);
});

test('TC-MCP-SESSION-009: connect() does not leave a late-rejecting loser of the race as an unhandled rejection', async t => {
  console.log(
    '[TC-MCP-SESSION-009] step 1: wiring a fake client whose connect() rejects only after we tell it to, with fake timers to skip the real 90s wait'
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rejectConnect;
  const client = makeFakeClient({
    connect: () =>
      new Promise((_, reject) => {
        rejectConnect = reject;
      }),
  });
  const { session } = makeSession({ client });
  let unhandled = null;
  const onUnhandledRejection = err => {
    unhandled = err;
  };
  process.on('unhandledRejection', onUnhandledRejection);
  console.log(
    '[TC-MCP-SESSION-009] step 2: calling connect() and advancing fake timers past AUTH_TIMEOUT_S so the timeout wins the race'
  );
  const connectPromise = session.connect();
  connectPromise.catch(() => {});
  await flushMicrotasks();
  t.mock.timers.tick(90_000);
  await assert.rejects(() => connectPromise, /Authorization timed out after 90s/);
  console.log(
    '[TC-MCP-SESSION-009] step 3: rejecting the real client.connect() late, after the timeout already settled the race'
  );
  rejectConnect(new Error('transport error after late auth'));
  await flushMicrotasks();
  await new Promise(resolve => setImmediate(resolve));
  process.removeListener('unhandledRejection', onUnhandledRejection);
  console.log(
    `[TC-MCP-SESSION-009] step 4: asserting no unhandledRejection was raised, got: ${unhandled}`
  );
  assert.equal(unhandled, null);
});

test('TC-MCP-SESSION-010: the SIGINT handler awaits cleanup before exiting', async t => {
  console.log('[TC-MCP-SESSION-010] step 1: stubbing process.exit and a slow client.close()');
  t.mock.method(process, 'exit', () => {});
  let closeResolved = false;
  const client = makeFakeClient({
    close: async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      closeResolved = true;
    },
  });
  const { session } = makeSession({ client });
  await session.connect();
  console.log(
    "[TC-MCP-SESSION-010] step 2: grabbing this session's SIGINT listener and invoking it directly"
  );
  const listeners = process.listeners('SIGINT');
  const handler = listeners[listeners.length - 1];
  await handler();
  process.removeListener('SIGINT', handler);
  console.log(
    `[TC-MCP-SESSION-010] step 3: asserting close() resolved before process.exit(130) was called, closeResolved=${closeResolved}, exit calls=${JSON.stringify(process.exit.mock.calls.map(c => c.arguments))}`
  );
  assert.equal(closeResolved, true);
  assert.equal(process.exit.mock.calls.length, 1);
  assert.equal(process.exit.mock.calls[0].arguments[0], 130);
});

test('TC-MCP-SESSION-005: close() is idempotent — a second call does not re-invoke client.close()', async () => {
  console.log('[TC-MCP-SESSION-005] step 1: wiring a fake client counting close() invocations');
  let closeCount = 0;
  const client = makeFakeClient({
    close: async () => {
      closeCount++;
    },
  });
  const { session } = makeSession({ client });
  await session.connect();
  console.log('[TC-MCP-SESSION-005] step 2: calling close() twice');
  await session.close();
  await session.close();
  console.log(
    `[TC-MCP-SESSION-005] step 3: asserting client.close() was only invoked once, got closeCount=${closeCount}`
  );
  assert.equal(closeCount, 1);
});
