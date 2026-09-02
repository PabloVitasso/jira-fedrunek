import { normalizeTimestamp } from './timestamp.js';
import { spaceKeyFromWebui } from './webui.js';

const CONFLUENCE_ID_RE = /^\d+$/;
const MAX_PAGINATION_LOOPS = 1000;

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function nextCursor(data) {
  return data._links?.next
    ? new URL(data._links.next, 'https://x').searchParams.get('cursor')
    : null;
}

// Walks every page descendant of a Confluence folder via paginated CQL
// ancestor queries — pure orchestration over ConfluenceClient.
export class FolderWalker {
  constructor(confluenceClient) {
    this.confluenceClient = confluenceClient;
  }

  async walkDescendants(folderId) {
    if (!CONFLUENCE_ID_RE.test(folderId)) {
      console.log(
        `[FolderWalker.walkDescendants] step 1: rejecting folderId ${JSON.stringify(folderId)} — not a numeric Confluence id, refusing to interpolate into CQL`
      );
      throw new Error(`invalid Confluence folder id: ${folderId}`);
    }
    console.log(
      `[FolderWalker.walkDescendants] step 1: querying descendants of folder ${folderId} via CQL ancestor`
    );
    const pages = [];
    let cursor;
    let loops = 0;
    do {
      loops += 1;
      if (loops > MAX_PAGINATION_LOOPS) {
        throw new Error(
          `[FolderWalker.walkDescendants] exceeded ${MAX_PAGINATION_LOOPS} pagination loops for folder ${folderId} — server cursor may be looping`
        );
      }
      const data = await this.confluenceClient.searchByCql(
        `ancestor = "${folderId}" AND type = page`,
        { limit: 50, cursor }
      );
      console.log(
        `[FolderWalker.walkDescendants] step 2: page of ${data.results?.length ?? 0} result(s), cursor=${cursor ?? 'none'}`
      );
      for (const r of data.results ?? []) {
        const spaceKey = spaceKeyFromWebui(r.content?._links?.webui);
        pages.push({
          id: r.content.id,
          title: r.content.title ?? decodeHtmlEntities(r.title),
          spaceKey,
          lastModified: normalizeTimestamp(r.lastModified),
        });
      }
      cursor = nextCursor(data);
    } while (cursor);
    console.log(
      `[FolderWalker.walkDescendants] step 3: collected ${pages.length} descendant page(s) total`
    );
    return pages;
  }
}
