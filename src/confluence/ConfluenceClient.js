function textOf(result) {
  return (result?.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

// getConfluencePage returns a JSON envelope; the markdown lives in .body
function pageBody(raw) {
  try {
    console.log(
      '[ConfluenceClient.pageBody] step 1: parsing raw as JSON envelope, extracting .body'
    );
    return JSON.parse(raw).body ?? raw;
  } catch (err) {
    console.log(
      `[ConfluenceClient.pageBody] step 2: raw is not JSON (${err.message}), using as-is`
    );
    return raw;
  }
}

export class ConfluenceClient {
  constructor({ mcpSession, cloudId }) {
    this.mcpSession = mcpSession;
    this.cloudId = cloudId;
  }

  async getPage(pageId, { contentFormat = 'markdown' } = {}) {
    console.log(
      `[ConfluenceClient.getPage] step 1: calling getConfluencePage(pageId=${pageId}, contentFormat=${contentFormat})`
    );
    const result = await this.mcpSession.callTool('getConfluencePage', {
      cloudId: this.cloudId,
      pageId,
      contentFormat,
    });
    console.log(
      '[ConfluenceClient.getPage] step 2: unwrapping the JSON envelope, returning ready-to-write markdown body'
    );
    return pageBody(textOf(result));
  }

  async getSpaces(keys) {
    console.log(
      `[ConfluenceClient.getSpaces] step 1: calling getConfluenceSpaces(keys=${JSON.stringify(keys)})`
    );
    const result = await this.mcpSession.callTool('getConfluenceSpaces', {
      cloudId: this.cloudId,
      keys,
      limit: keys.length,
    });
    console.log(
      '[ConfluenceClient.getSpaces] step 2: parsing { results: [...] } from response text'
    );
    const data = JSON.parse(textOf(result));
    return data.results ?? [];
  }

  async getPagesInSpace(spaceId, { cursor } = {}) {
    console.log(
      `[ConfluenceClient.getPagesInSpace] step 1: calling getPagesInConfluenceSpace(spaceId=${spaceId}, cursor=${cursor ?? 'none'})`
    );
    const result = await this.mcpSession.callTool('getPagesInConfluenceSpace', {
      cloudId: this.cloudId,
      spaceId,
      limit: 100,
      ...(cursor && { cursor }),
    });
    console.log(
      '[ConfluenceClient.getPagesInSpace] step 2: parsing { results, _links } from response text'
    );
    return JSON.parse(textOf(result));
  }

  async searchByCql(cql, { cursor, limit = 50 } = {}) {
    console.log(
      `[ConfluenceClient.searchByCql] step 1: calling searchConfluenceUsingCql(cql="${cql}", cursor=${cursor ?? 'none'})`
    );
    const result = await this.mcpSession.callTool('searchConfluenceUsingCql', {
      cloudId: this.cloudId,
      cql,
      limit,
      ...(cursor && { cursor }),
    });
    console.log(
      '[ConfluenceClient.searchByCql] step 2: parsing { results, _links } from response text'
    );
    return JSON.parse(textOf(result));
  }
}
