export class AuthSession {
  constructor(oauthClient, tokenStore, callbackServer, options = {}) {
    this.oauthClient = oauthClient;
    this.tokenStore = tokenStore;
    this.callbackServer = callbackServer;
    this.openUrl = options.openUrl ?? ((url) => console.log(`[AuthSession] open this URL to authorize: ${url}`));
    this.port = options.port ?? 3000;
  }

  async getAccessToken() {
    console.log('[AuthSession.getAccessToken] step 1: load stored tokens via TokenStore.load()');
    const stored = this.tokenStore.load();
    if (stored && !this.tokenStore.isExpired()) {
      console.log('[AuthSession.getAccessToken] step 2: present and not expired, returning access_token as-is');
      return stored.access_token;
    }

    if (stored) {
      console.log('[AuthSession.getAccessToken] step 3: present and expired, refreshing via AtlassianOAuthClient.refreshToken()');
      const refreshed = await this.oauthClient.refreshToken(stored.refresh_token);
      const tokens = {
        ...stored,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
      console.log('[AuthSession.getAccessToken] step 5: persist result via TokenStore.save() and return access_token');
      this.tokenStore.save(tokens);
      return tokens.access_token;
    }

    console.log('[AuthSession.getAccessToken] step 4: absent, running full OAuth flow (authorize URL -> browser -> CallbackServer.waitForCode -> exchangeCodeForToken)');
    const state = Math.random().toString(36).slice(2);
    const authorizeUrl = this.oauthClient.buildAuthorizeUrl(state);
    console.log('[AuthSession.getAccessToken] step 4b: opening the authorize URL via the injected openUrl');
    await this.openUrl(authorizeUrl);
    const { code } = await this.callbackServer.waitForCode(this.port);
    const exchanged = await this.oauthClient.exchangeCodeForToken(code);
    const tokens = {
      access_token: exchanged.access_token,
      refresh_token: exchanged.refresh_token,
      expires_at: new Date(Date.now() + exchanged.expires_in * 1000).toISOString(),
    };
    console.log('[AuthSession.getAccessToken] step 5: persist result via TokenStore.save() and return access_token');
    this.tokenStore.save(tokens);
    return tokens.access_token;
  }

  async getCloudId() {
    console.log('[AuthSession.getCloudId] step 1: ensure a valid access token via getAccessToken()');
    const accessToken = await this.getAccessToken();
    const stored = this.tokenStore.load();
    if (stored?.cloud_id) {
      console.log('[AuthSession.getCloudId] step 2: cloud_id already present in TokenStore, returning it');
      return stored.cloud_id;
    }
    console.log('[AuthSession.getCloudId] step 2: cloud_id missing, fetching via getAccessibleResources()');
    const [resource] = await this.oauthClient.getAccessibleResources(accessToken);
    this.tokenStore.save({ ...stored, cloud_id: resource.id });
    return resource.id;
  }
}
