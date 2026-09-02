import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JiraClient } from '../../src/jira/JiraClient.js';

function makeClient() {
  return new JiraClient({
    getAccessToken: async () => 'fake-access-token',
    getCloudId: async () => 'fake-cloud-id',
  });
}

function stubFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = original;
  });
}

test('TC-JIRA-CLIENT-001: getIssue calls the v2 issue endpoint with bearer auth and returns parsed JSON', async (t) => {
  console.log('[TC-JIRA-CLIENT-001] step 1: stubbing global fetch to capture the request and return a fake issue');
  let capturedUrl;
  let capturedHeaders;
  stubFetch(t, async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return { ok: true, json: async () => ({ key: 'PROJ-1', fields: { summary: 'x' } }) };
  });
  console.log('[TC-JIRA-CLIENT-001] step 2: calling getIssue("PROJ-1")');
  const client = makeClient();
  const issue = await client.getIssue('PROJ-1');
  console.log(`[TC-JIRA-CLIENT-001] step 3: asserting cloudId-scoped URL and bearer header, got url=${capturedUrl}`);
  assert.equal(capturedUrl, 'https://api.atlassian.com/ex/jira/fake-cloud-id/rest/api/2/issue/PROJ-1');
  assert.equal(capturedHeaders.Authorization, 'Bearer fake-access-token');
  console.log(`[TC-JIRA-CLIENT-001] step 4: asserting parsed issue JSON returned, got: ${JSON.stringify(issue)}`);
  assert.deepEqual(issue, { key: 'PROJ-1', fields: { summary: 'x' } });
});

test('TC-JIRA-CLIENT-002: getIssue throws when the response is not ok', async (t) => {
  console.log('[TC-JIRA-CLIENT-002] step 1: stubbing global fetch to return a 404');
  stubFetch(t, async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }));
  console.log('[TC-JIRA-CLIENT-002] step 2: calling getIssue and asserting it rejects');
  const client = makeClient();
  await assert.rejects(() => client.getIssue('PROJ-404'));
});

test('TC-JIRA-CLIENT-003: getComments calls the v2 comment endpoint and returns the comments array', async (t) => {
  console.log('[TC-JIRA-CLIENT-003] step 1: stubbing global fetch to capture the request and return fake comments');
  let capturedUrl;
  stubFetch(t, async (url) => {
    capturedUrl = url;
    return { ok: true, json: async () => ({ comments: [{ id: '1' }, { id: '2' }] }) };
  });
  console.log('[TC-JIRA-CLIENT-003] step 2: calling getComments("PROJ-1")');
  const client = makeClient();
  const comments = await client.getComments('PROJ-1');
  console.log(`[TC-JIRA-CLIENT-003] step 3: asserting comment endpoint URL, got url=${capturedUrl}`);
  assert.equal(capturedUrl, 'https://api.atlassian.com/ex/jira/fake-cloud-id/rest/api/2/issue/PROJ-1/comment');
  console.log(`[TC-JIRA-CLIENT-003] step 4: asserting comments array unwrapped from the "comments" envelope, got: ${JSON.stringify(comments)}`);
  assert.deepEqual(comments, [{ id: '1' }, { id: '2' }]);
});
