import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AtlassianOAuthClient } from '../../src/auth/AtlassianOAuthClient.js';

function makeClient(overrides = {}) {
  return new AtlassianOAuthClient({
    clientId: 'client-abc',
    clientSecret: 'secret-abc',
    redirectUri: 'http://localhost:3000/callback',
    scopes: ['read:jira-work', 'offline_access'],
    ...overrides,
  });
}

function stubFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = original;
  });
}

test('TC-AUTH-OAUTHCLIENT-001: buildAuthorizeUrl composes the authorize URL with client_id, scope, redirect_uri, state', () => {
  console.log('[TC-AUTH-OAUTHCLIENT-001] step 1: calling buildAuthorizeUrl("state-xyz")');
  const client = makeClient();
  const url = client.buildAuthorizeUrl('state-xyz');
  console.log(`[TC-AUTH-OAUTHCLIENT-001] step 2: asserting composed URL, got: ${url}`);
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://auth.atlassian.com/authorize');
  assert.equal(parsed.searchParams.get('client_id'), 'client-abc');
  assert.equal(parsed.searchParams.get('scope'), 'read:jira-work offline_access');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:3000/callback');
  assert.equal(parsed.searchParams.get('state'), 'state-xyz');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
});

test('TC-AUTH-OAUTHCLIENT-002: exchangeCodeForToken POSTs a grant_type=authorization_code body and returns the parsed tokens', async (t) => {
  console.log('[TC-AUTH-OAUTHCLIENT-002] step 1: stubbing global fetch to capture the request and return fake tokens');
  let capturedUrl;
  let capturedBody;
  stubFetch(t, async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) };
  });
  console.log('[TC-AUTH-OAUTHCLIENT-002] step 2: calling exchangeCodeForToken("auth-code-1")');
  const client = makeClient();
  const tokens = await client.exchangeCodeForToken('auth-code-1');
  console.log(`[TC-AUTH-OAUTHCLIENT-002] step 3: asserting POST to token URL with grant_type=authorization_code, got body: ${JSON.stringify(capturedBody)}`);
  assert.equal(capturedUrl, 'https://auth.atlassian.com/oauth/token');
  assert.equal(capturedBody.grant_type, 'authorization_code');
  assert.equal(capturedBody.code, 'auth-code-1');
  assert.equal(capturedBody.client_id, 'client-abc');
  assert.equal(capturedBody.client_secret, 'secret-abc');
  assert.equal(capturedBody.redirect_uri, 'http://localhost:3000/callback');
  console.log(`[TC-AUTH-OAUTHCLIENT-002] step 4: asserting parsed tokens returned, got: ${JSON.stringify(tokens)}`);
  assert.deepEqual(tokens, { access_token: 'a', refresh_token: 'r', expires_in: 3600 });
});

test('TC-AUTH-OAUTHCLIENT-003: refreshToken POSTs a grant_type=refresh_token body and returns the parsed tokens', async (t) => {
  console.log('[TC-AUTH-OAUTHCLIENT-003] step 1: stubbing global fetch to capture the request and return fake refreshed tokens');
  let capturedBody;
  stubFetch(t, async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }) };
  });
  console.log('[TC-AUTH-OAUTHCLIENT-003] step 2: calling refreshToken("old-refresh-token")');
  const client = makeClient();
  const tokens = await client.refreshToken('old-refresh-token');
  console.log(`[TC-AUTH-OAUTHCLIENT-003] step 3: asserting grant_type=refresh_token body, got: ${JSON.stringify(capturedBody)}`);
  assert.equal(capturedBody.grant_type, 'refresh_token');
  assert.equal(capturedBody.refresh_token, 'old-refresh-token');
  console.log(`[TC-AUTH-OAUTHCLIENT-003] step 4: asserting parsed refreshed tokens returned, got: ${JSON.stringify(tokens)}`);
  assert.deepEqual(tokens, { access_token: 'a2', refresh_token: 'r2', expires_in: 3600 });
});

test('TC-AUTH-OAUTHCLIENT-004: getAccessibleResources GETs with bearer auth and maps to { id, url, name }', async (t) => {
  console.log('[TC-AUTH-OAUTHCLIENT-004] step 1: stubbing global fetch to capture the request and return fake resources');
  let capturedUrl;
  let capturedHeaders;
  stubFetch(t, async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      ok: true,
      json: async () => [{ id: 'cloud-1', url: 'https://site.atlassian.net', name: 'Site', extra: 'ignored' }],
    };
  });
  console.log('[TC-AUTH-OAUTHCLIENT-004] step 2: calling getAccessibleResources("access-token-1")');
  const client = makeClient();
  const resources = await client.getAccessibleResources('access-token-1');
  console.log(`[TC-AUTH-OAUTHCLIENT-004] step 3: asserting GET URL and bearer header, got url=${capturedUrl}`);
  assert.equal(capturedUrl, 'https://api.atlassian.com/oauth/token/accessible-resources');
  assert.equal(capturedHeaders.Authorization, 'Bearer access-token-1');
  console.log(`[TC-AUTH-OAUTHCLIENT-004] step 4: asserting mapped resources, got: ${JSON.stringify(resources)}`);
  assert.deepEqual(resources, [{ id: 'cloud-1', url: 'https://site.atlassian.net', name: 'Site' }]);
});

test('TC-AUTH-OAUTHCLIENT-005: exchangeCodeForToken throws when the response is not ok', async (t) => {
  console.log('[TC-AUTH-OAUTHCLIENT-005] step 1: stubbing global fetch to return a 400');
  stubFetch(t, async () => ({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ({}) }));
  console.log('[TC-AUTH-OAUTHCLIENT-005] step 2: calling exchangeCodeForToken and asserting it rejects');
  const client = makeClient();
  await assert.rejects(() => client.exchangeCodeForToken('bad-code'));
});
