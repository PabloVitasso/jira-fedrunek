import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthSession } from '../../src/auth/AuthSession.js';

function makeOauthClient(overrides = {}) {
  return {
    buildAuthorizeUrl: () => 'https://auth.atlassian.com/authorize?state=s',
    exchangeCodeForToken: async () => ({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600 }),
    refreshToken: async () => ({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh', expires_in: 3600 }),
    getAccessibleResources: async () => [{ id: 'cloud-1', url: 'https://site.atlassian.net', name: 'Site' }],
    ...overrides,
  };
}

function makeTokenStore(initial = null) {
  let tokens = initial;
  return {
    load: () => tokens,
    save: (t) => { tokens = t; },
    isExpired: () => {
      if (!tokens) return true;
      return new Date(tokens.expires_at).getTime() <= Date.now();
    },
    _get: () => tokens,
  };
}

function makeCallbackServer(overrides = {}) {
  return {
    waitForCode: async () => ({ code: 'auth-code-1', state: 's' }),
    ...overrides,
  };
}

test('TC-AUTH-SESSION-001: getAccessToken returns the stored token as-is when not expired', async () => {
  console.log('[TC-AUTH-SESSION-001] step 1: wiring a TokenStore with a valid, non-expired token already stored');
  const tokenStore = makeTokenStore({
    access_token: 'stored-access',
    refresh_token: 'stored-refresh',
    expires_at: '2999-01-01T00:00:00Z',
    cloud_id: 'cloud-1',
  });
  const session = new AuthSession(makeOauthClient(), tokenStore, makeCallbackServer());
  console.log('[TC-AUTH-SESSION-001] step 2: calling getAccessToken()');
  const token = await session.getAccessToken();
  console.log(`[TC-AUTH-SESSION-001] step 3: asserting the stored token is returned unchanged, got: ${token}`);
  assert.equal(token, 'stored-access');
});

test('TC-AUTH-SESSION-002: getAccessToken refreshes and persists when the stored token is expired', async () => {
  console.log('[TC-AUTH-SESSION-002] step 1: wiring a TokenStore with an expired token');
  const tokenStore = makeTokenStore({
    access_token: 'stale-access',
    refresh_token: 'stale-refresh',
    expires_at: '2020-01-01T00:00:00Z',
    cloud_id: 'cloud-1',
  });
  const session = new AuthSession(makeOauthClient(), tokenStore, makeCallbackServer());
  console.log('[TC-AUTH-SESSION-002] step 2: calling getAccessToken()');
  const token = await session.getAccessToken();
  console.log(`[TC-AUTH-SESSION-002] step 3: asserting refreshToken()'s new access_token is returned and persisted, got: ${token}`);
  assert.equal(token, 'refreshed-access');
  assert.equal(tokenStore._get().access_token, 'refreshed-access');
  assert.equal(tokenStore._get().refresh_token, 'refreshed-refresh');
});

test('TC-AUTH-SESSION-003: getAccessToken runs the full OAuth flow when no token is stored', async () => {
  console.log('[TC-AUTH-SESSION-003] step 1: wiring a TokenStore with nothing stored, a fake CallbackServer and OAuthClient');
  const tokenStore = makeTokenStore(null);
  const session = new AuthSession(makeOauthClient(), tokenStore, makeCallbackServer());
  console.log('[TC-AUTH-SESSION-003] step 2: calling getAccessToken()');
  const token = await session.getAccessToken();
  console.log(`[TC-AUTH-SESSION-003] step 3: asserting exchangeCodeForToken()'s access_token is returned and persisted, got: ${token}`);
  assert.equal(token, 'fresh-access');
  assert.equal(tokenStore._get().access_token, 'fresh-access');
  assert.equal(tokenStore._get().refresh_token, 'fresh-refresh');
});

test('TC-AUTH-SESSION-004: getCloudId returns the stored cloud_id without calling getAccessibleResources again', async () => {
  console.log('[TC-AUTH-SESSION-004] step 1: wiring a TokenStore with a valid token that already has cloud_id set');
  const tokenStore = makeTokenStore({
    access_token: 'stored-access',
    refresh_token: 'stored-refresh',
    expires_at: '2999-01-01T00:00:00Z',
    cloud_id: 'cloud-1',
  });
  let calls = 0;
  const oauthClient = makeOauthClient({ getAccessibleResources: async () => { calls++; return []; } });
  const session = new AuthSession(oauthClient, tokenStore, makeCallbackServer());
  console.log('[TC-AUTH-SESSION-004] step 2: calling getCloudId()');
  const cloudId = await session.getCloudId();
  console.log(`[TC-AUTH-SESSION-004] step 3: asserting stored cloud_id returned and getAccessibleResources not called, got: ${cloudId}, calls=${calls}`);
  assert.equal(cloudId, 'cloud-1');
  assert.equal(calls, 0);
});

test('TC-AUTH-SESSION-005: getCloudId fetches and persists cloud_id via getAccessibleResources when missing', async () => {
  console.log('[TC-AUTH-SESSION-005] step 1: wiring a TokenStore with a valid token but no cloud_id set');
  const tokenStore = makeTokenStore({
    access_token: 'stored-access',
    refresh_token: 'stored-refresh',
    expires_at: '2999-01-01T00:00:00Z',
  });
  const session = new AuthSession(makeOauthClient(), tokenStore, makeCallbackServer());
  console.log('[TC-AUTH-SESSION-005] step 2: calling getCloudId()');
  const cloudId = await session.getCloudId();
  console.log(`[TC-AUTH-SESSION-005] step 3: asserting cloud_id resolved from getAccessibleResources and persisted, got: ${cloudId}`);
  assert.equal(cloudId, 'cloud-1');
  assert.equal(tokenStore._get().cloud_id, 'cloud-1');
});

test('TC-AUTH-SESSION-006: getAccessToken opens the authorize URL via the injected openUrl during the full OAuth flow', async () => {
  console.log('[TC-AUTH-SESSION-006] step 1: wiring an empty TokenStore and capturing openUrl calls via an options override');
  const tokenStore = makeTokenStore(null);
  let openedUrl;
  const session = new AuthSession(makeOauthClient(), tokenStore, makeCallbackServer(), {
    openUrl: async (url) => { openedUrl = url; },
  });
  console.log('[TC-AUTH-SESSION-006] step 2: calling getAccessToken()');
  await session.getAccessToken();
  console.log(`[TC-AUTH-SESSION-006] step 3: asserting openUrl was called with the built authorize URL, got: ${openedUrl}`);
  assert.equal(openedUrl, 'https://auth.atlassian.com/authorize?state=s');
});
