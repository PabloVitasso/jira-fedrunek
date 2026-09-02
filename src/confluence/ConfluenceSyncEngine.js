import path from 'node:path';
import matter from 'gray-matter';
import pLimit from 'p-limit';
import { buildPageFrontmatter, buildToc } from '../markdown/MarkdownFormatter.js';
import { CONCURRENCY } from '../mcp/constants.js';
import { normalizeTimestamp } from './timestamp.js';
import { spaceKeyFromWebui } from './webui.js';

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const CONFLUENCE_ID_RE = /^\d+$/;
const MAX_PAGINATION_LOOPS = 1000;

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] ??= []).push(x);
    return acc;
  }, {});
}

async function defaultConfirmBulk() {
  return true;
}

// Confluence's equivalent of SyncEngine: page/dir/dirs/pages/sync modes,
// manifest diffing against SyncState's confluence section, bulk-download
// confirm guard, CONTENTS.md rebuild. Ported from confluence-fetch/cf-fetch.js.
export class ConfluenceSyncEngine {
  constructor(confluenceClient, folderWalker, syncState, fileWriter, options = {}) {
    this.confluenceClient = confluenceClient;
    this.folderWalker = folderWalker;
    this.syncState = syncState;
    this.fileWriter = fileWriter;
    this.now = options.now ?? (() => new Date().toISOString());
    this.outDir = options.outDir ?? 'sync/confluence';
    this.confirmBulk = options.confirmBulk ?? defaultConfirmBulk;
    this.concurrency = options.concurrency ?? CONCURRENCY;
  }

  #relPath(dirPart, id, title) {
    return path.join(dirPart, `${id}-${slug(title)}.md`);
  }

  async #writePage(page, dirPart) {
    console.log(
      `[ConfluenceSyncEngine.#writePage] step 1: fetching content for page ${page.id} (${page.title})`
    );
    const markdown = await this.confluenceClient.getPage(page.id);
    const toc = buildToc(markdown);
    const frontmatter = buildPageFrontmatter(page);
    const content = matter.stringify(`${toc}${markdown}`, frontmatter);
    const rel = this.#relPath(dirPart, page.id, page.title);
    const filePath = path.join(this.outDir, rel);
    console.log(
      `[ConfluenceSyncEngine.#writePage] step 2: writing ${filePath} via FileWriter.write`
    );
    this.fileWriter.write(filePath, content);
    this.syncState.setPage(page.id, {
      lastModified: page.lastModified,
      path: rel,
      title: page.title,
    });
    return { id: page.id, path: rel, title: page.title };
  }

  async #fetchStale(pages, dirPart) {
    const stale = pages.filter(
      p => (this.syncState.getPage(p.id)?.lastModified ?? '') !== p.lastModified
    );
    console.log(
      `[ConfluenceSyncEngine.#fetchStale] step 1: ${pages.length} pages, ${stale.length} stale, ${pages.length - stale.length} up-to-date`
    );
    if (stale.length > 1) {
      const proceed = await this.confirmBulk(stale);
      if (!proceed) {
        console.log(
          '[ConfluenceSyncEngine.#fetchStale] step 2: bulk download not confirmed, aborting'
        );
        return { fetched: 0, failed: [], skipped: pages.length - stale.length, aborted: true };
      }
    }
    const limiter = pLimit(this.concurrency);
    const results = await Promise.allSettled(
      stale.map(p => limiter(() => this.#writePage(p, dirPart ?? p.spaceKey)))
    );
    const failed = results.filter(r => r.status === 'rejected');
    this.syncState.save();
    console.log(
      `[ConfluenceSyncEngine.#fetchStale] step 3: ${stale.length - failed.length} fetched, ${failed.length} failed`
    );
    return {
      fetched: stale.length - failed.length,
      failed,
      skipped: pages.length - stale.length,
      aborted: false,
    };
  }

  async #rebuildContents() {
    console.log(
      '[ConfluenceSyncEngine.#rebuildContents] step 1: rebuilding CONTENTS.md from SyncState confluence entries'
    );
    const entries = this.syncState.allPages().map(([id, meta]) => ({ id, ...meta }));
    const lines = [
      '# Confluence Cache',
      `> synced: ${this.now().slice(0, 10)}, ${entries.length} pages`,
    ];
    const parts = e => e.path.split(/[\\/]/);
    const linkPath = e => e.path.replace(/\\/g, '/');
    const bySpace = groupBy(entries, e => parts(e)[0]);
    for (const space of Object.keys(bySpace).sort()) {
      lines.push('', `## ${space}`);
      const spaceEntries = bySpace[space];
      const topLevel = spaceEntries.filter(e => parts(e).length === 2);
      const byFolder = groupBy(
        spaceEntries.filter(e => parts(e).length >= 3),
        e => parts(e)[1]
      );
      topLevel
        .sort((a, b) => a.title.localeCompare(b.title))
        .forEach(e => lines.push(`- [${e.title}](${linkPath(e)})`));
      for (const folder of Object.keys(byFolder).sort()) {
        lines.push('', `### ${folder}`);
        byFolder[folder]
          .sort((a, b) => a.title.localeCompare(b.title))
          .forEach(e => lines.push(`  - [${e.title}](${linkPath(e)})`));
      }
    }
    this.fileWriter.write(path.join(this.outDir, 'CONTENTS.md'), lines.join('\n') + '\n');
    console.log(
      `[ConfluenceSyncEngine.#rebuildContents] step 2: CONTENTS.md written, ${entries.length} entries`
    );
  }

  #removeOrphans(remotePages, { underDir } = {}) {
    const remoteIds = new Set(remotePages.map(p => p.id));
    const underDirFwd = underDir?.replace(/\\/g, '/');
    for (const [id, entry] of this.syncState.allPages()) {
      const underScope = underDirFwd
        ? entry.path.replace(/\\/g, '/').startsWith(`${underDirFwd}/`)
        : true;
      if (underScope && !remoteIds.has(id)) {
        console.log(
          `[ConfluenceSyncEngine.#removeOrphans] step 1: removing orphan page ${id} (${entry.title})`
        );
        this.syncState.deletePage(id);
      }
    }
  }

  async syncPage(id) {
    if (!CONFLUENCE_ID_RE.test(id)) {
      console.log(
        `[ConfluenceSyncEngine.syncPage] step 1: rejecting id ${JSON.stringify(id)} — not a numeric Confluence id, refusing to interpolate into CQL`
      );
      throw new Error(`invalid Confluence page id: ${id}`);
    }
    console.log(
      `[ConfluenceSyncEngine.syncPage] step 1: looking up page ${id} via CQL id = "${id}"`
    );
    const meta = (await this.confluenceClient.searchByCql(`id = "${id}"`, { limit: 1 }))
      .results?.[0];
    if (!meta) {
      console.log(`[ConfluenceSyncEngine.syncPage] step 2: page ${id} not found`);
      return { status: 'not_found', id };
    }
    const title = meta.content?.title ?? meta.title;
    if (!title) {
      console.log(
        `[ConfluenceSyncEngine.syncPage] step 2: no title found for page ${id}, using id as title`
      );
    }
    const page = {
      id,
      title: title ?? id,
      spaceKey: spaceKeyFromWebui(meta.content?._links?.webui),
      lastModified: normalizeTimestamp(meta.lastModified),
    };
    const stored = this.syncState.getPage(id);
    if (stored?.lastModified === page.lastModified) {
      console.log(
        `[ConfluenceSyncEngine.syncPage] step 3: unchanged (lastModified=${page.lastModified}), skipping`
      );
      return { status: 'unchanged', id };
    }
    console.log('[ConfluenceSyncEngine.syncPage] step 3: fetching and writing');
    const written = await this.#writePage(page, page.spaceKey);
    this.syncState.save();
    await this.#rebuildContents();
    return { status: stored ? 'updated' : 'created', id, ...written };
  }

  async syncDir(folderId, label) {
    console.log(
      `[ConfluenceSyncEngine.syncDir] step 1: walking descendants of folder ${folderId} (${label})`
    );
    const pages = await this.folderWalker.walkDescendants(folderId);
    if (!pages.length) {
      console.log('[ConfluenceSyncEngine.syncDir] step 2: no pages found');
      return { folderId, total: 0, fetched: 0, failed: [], skipped: 0 };
    }
    const subDir = path.join(pages[0].spaceKey, `${folderId}-${slug(label)}`);
    const stats = await this.#fetchStale(pages, subDir);
    if (stats.aborted) {
      return { folderId, total: pages.length, ...stats };
    }
    this.#removeOrphans(pages, { underDir: subDir });
    this.syncState.save();
    await this.#rebuildContents();
    return { folderId, total: pages.length, ...stats };
  }

  async syncDirs(watchDirs) {
    console.log(
      `[ConfluenceSyncEngine.syncDirs] step 1: syncing ${watchDirs.length} watched folder(s)`
    );
    const results = [];
    for (const { folderId, label } of watchDirs) {
      results.push(await this.syncDir(folderId, label));
    }
    return results;
  }

  async syncPages(watchPages) {
    console.log(
      `[ConfluenceSyncEngine.syncPages] step 1: syncing ${watchPages.length} watched page(s)`
    );
    const results = [];
    for (const { id } of watchPages) {
      results.push(await this.syncPage(id));
    }
    return results;
  }

  async syncSpaces(spaceKeys) {
    console.log(
      `[ConfluenceSyncEngine.syncSpaces] step 1: resolving space keys ${JSON.stringify(spaceKeys)} to ids`
    );
    const spaces = await this.confluenceClient.getSpaces(spaceKeys);
    const keyToId = Object.fromEntries(spaces.map(s => [s.key, String(s.id)]));
    const missing = spaceKeys.filter(k => !keyToId[k]);
    if (missing.length) {
      throw new Error(`unknown space keys: ${missing.join(', ')}`);
    }

    console.log(
      '[ConfluenceSyncEngine.syncSpaces] step 2: listing all pages in each space (cursor-paginated)'
    );
    const allPages = [];
    for (const spaceKey of spaceKeys) {
      let cursor;
      let loops = 0;
      do {
        loops += 1;
        if (loops > MAX_PAGINATION_LOOPS) {
          throw new Error(
            `[ConfluenceSyncEngine.syncSpaces] exceeded ${MAX_PAGINATION_LOOPS} pagination loops for space ${spaceKey} — server cursor may be looping`
          );
        }
        const data = await this.confluenceClient.getPagesInSpace(keyToId[spaceKey], { cursor });
        allPages.push(
          ...(data.results ?? []).map(p => {
            const createdAt = p.version?.createdAt;
            if (!createdAt) {
              console.log(
                `[ConfluenceSyncEngine.syncSpaces] step 2b: page ${p.id} (${spaceKey}) has no version.createdAt`
              );
            }
            return {
              id: String(p.id),
              title: p.title,
              spaceKey,
              lastModified: normalizeTimestamp(createdAt),
            };
          })
        );
        cursor = data._links?.next
          ? new URL(data._links.next, 'https://x').searchParams.get('cursor')
          : null;
      } while (cursor);
    }

    console.log(
      `[ConfluenceSyncEngine.syncSpaces] step 3: ${allPages.length} pages total across ${spaceKeys.length} space(s)`
    );
    const stats = await this.#fetchStale(allPages);
    if (stats.aborted) {
      return { total: allPages.length, ...stats };
    }
    this.#removeOrphans(allPages);
    this.syncState.save();
    await this.#rebuildContents();
    return { total: allPages.length, ...stats };
  }
}
