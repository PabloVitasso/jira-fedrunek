export class AtlassianOAuthClient {
  constructor({ clientId, clientSecret, redirectUri, scopes }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.scopes = scopes;
  }

  buildAuthorizeUrl(state) {
    console.log('[AtlassianOAuthClient.buildAuthorizeUrl] step 1: building query params (client_id, scope, redirect_uri, state)');
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.clientId,
      scope: this.scopes.join(' '),
      redirect_uri: this.redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    console.log('[AtlassianOAuthClient.buildAuthorizeUrl] step 2: composing https://auth.atlassian.com/authorize URL');
    return `https://auth.atlassian.com/authorize?${params.toString()}`;
  }

  async #postToken(body) {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.log(`[AtlassianOAuthClient.#postToken] step: response not ok (${response.status} ${response.statusText})`);
      throw new Error(`Atlassian token request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async exchangeCodeForToken(code) {
    console.log('[AtlassianOAuthClient.exchangeCodeForToken] step 1: POST https://auth.atlassian.com/oauth/token (grant_type=authorization_code)');
    const tokens = await this.#postToken({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    });
    console.log('[AtlassianOAuthClient.exchangeCodeForToken] step 2: parsing { access_token, refresh_token, expires_in }');
    return tokens;
  }

  async refreshToken(refreshToken) {
    console.log('[AtlassianOAuthClient.refreshToken] step 1: POST https://auth.atlassian.com/oauth/token (grant_type=refresh_token)');
    const tokens = await this.#postToken({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });
    console.log('[AtlassianOAuthClient.refreshToken] step 2: parsing refreshed { access_token, refresh_token, expires_in }');
    return tokens;
  }

  async getAccessibleResources(accessToken) {
    console.log('[AtlassianOAuthClient.getAccessibleResources] step 1: GET https://api.atlassian.com/oauth/token/accessible-resources');
    const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Atlassian accessible-resources request failed: ${response.status} ${response.statusText}`);
    }
    const resources = await response.json();
    console.log('[AtlassianOAuthClient.getAccessibleResources] step 2: mapping response to [{ id: cloudId, url, name }]');
    return resources.map(({ id, url, name }) => ({ id, url, name }));
  }
}
