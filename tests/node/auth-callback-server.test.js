import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallbackServer } from '../../src/auth/CallbackServer.js';

test('TC-AUTH-CALLBACKSERVER-001: waitForCode resolves { code, state } from a real redirect request', async () => {
  console.log('[TC-AUTH-CALLBACKSERVER-001] step 1: starting a CallbackServer on an ephemeral port');
  const server = new CallbackServer();
  const port = 34567;
  const promise = server.waitForCode(port);
  console.log(`[TC-AUTH-CALLBACKSERVER-001] step 2: firing a real HTTP GET to /callback?code=...&state=... on port ${port}`);
  await fetch(`http://localhost:${port}/callback?code=auth-code-1&state=state-xyz`);
  console.log('[TC-AUTH-CALLBACKSERVER-001] step 3: asserting waitForCode resolved with the parsed code/state');
  const result = await promise;
  assert.deepEqual(result, { code: 'auth-code-1', state: 'state-xyz' });
});

test('TC-AUTH-CALLBACKSERVER-002: waitForCode closes the listener after resolving (port is free again)', async () => {
  console.log('[TC-AUTH-CALLBACKSERVER-002] step 1: starting a CallbackServer and completing one redirect round-trip');
  const server = new CallbackServer();
  const port = 34568;
  const promise = server.waitForCode(port);
  await fetch(`http://localhost:${port}/callback?code=c&state=s`);
  await promise;
  console.log('[TC-AUTH-CALLBACKSERVER-002] step 2: starting a second CallbackServer on the same port to prove the first one released it');
  const server2 = new CallbackServer();
  const promise2 = server2.waitForCode(port);
  await fetch(`http://localhost:${port}/callback?code=c2&state=s2`);
  console.log('[TC-AUTH-CALLBACKSERVER-002] step 3: asserting the second round-trip also resolves correctly');
  const result2 = await promise2;
  assert.deepEqual(result2, { code: 'c2', state: 's2' });
});

test('TC-AUTH-CALLBACKSERVER-003: waitForCode responds to the browser request with a 200 confirmation page', async () => {
  console.log('[TC-AUTH-CALLBACKSERVER-003] step 1: starting a CallbackServer and firing the redirect request');
  const server = new CallbackServer();
  const port = 34569;
  const promise = server.waitForCode(port);
  const response = await fetch(`http://localhost:${port}/callback?code=c3&state=s3`);
  console.log(`[TC-AUTH-CALLBACKSERVER-003] step 2: asserting the HTTP response itself is a 200, got status=${response.status}`);
  assert.equal(response.status, 200);
  await promise;
});
