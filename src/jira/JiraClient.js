export class JiraClient {
  constructor({ getAccessToken, getCloudId }) {
    this.getAccessToken = getAccessToken;
    this.getCloudId = getCloudId;
  }

  async #request(path) {
    console.log(`[JiraClient.#request] step 1: resolving cloudId + access token for ${path}`);
    const [cloudId, accessToken] = await Promise.all([this.getCloudId(), this.getAccessToken()]);
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/2${path}`;
    console.log(`[JiraClient.#request] step 2: GET ${url}`);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      console.log(`[JiraClient.#request] step 3: response not ok (${response.status} ${response.statusText})`);
      throw new Error(`Jira API request failed: ${response.status} ${response.statusText}`);
    }
    console.log('[JiraClient.#request] step 3: returning parsed JSON');
    return response.json();
  }

  async getIssue(key) {
    console.log(`[JiraClient.getIssue] step 1: fetching issue ${key}`);
    return this.#request(`/issue/${key}`);
  }

  async getComments(key) {
    console.log(`[JiraClient.getComments] step 1: fetching comments for ${key}`);
    const data = await this.#request(`/issue/${key}/comment`);
    console.log('[JiraClient.getComments] step 2: unwrapping "comments" array from response envelope');
    return data.comments;
  }
}
