import fs from 'node:fs';
import crypto from 'node:crypto';

export class SyncState {
  constructor(path) {
    this.path = path;
    this.state = { issues: {}, confluence: {} };
  }

  load() {
    console.log(`[SyncState.load] step 1: reading ${this.path}`);
    if (!fs.existsSync(this.path)) {
      console.log('[SyncState.load] step 2: file missing, starting with empty { issues: {}, confluence: {} }');
      this.state = { issues: {}, confluence: {} };
      return;
    }
    const raw = fs.readFileSync(this.path, 'utf8');
    try {
      console.log('[SyncState.load] step 2: JSON.parse into in-memory state');
      const parsed = JSON.parse(raw);
      this.state = { issues: parsed.issues ?? {}, confluence: parsed.confluence ?? {} };
    } catch (err) {
      const backupPath = `${this.path}.corrupt-${Date.now()}`;
      console.log(`[SyncState.load] step 3: invalid JSON (${err.message}), backing up corrupt file to ${backupPath}`);
      fs.renameSync(this.path, backupPath);
      console.error(`[SyncState.load] warning: ${this.path} contained invalid JSON and was reset. The corrupt file was backed up to ${backupPath}. Tracked history has been lost.`);
      this.state = { issues: {}, confluence: {} };
    }
  }

  getIssue(issueKey) {
    console.log(`[SyncState.getIssue] step 1: looking up ${issueKey} in the issues section`);
    return this.state.issues[issueKey];
  }

  setIssue(issueKey, meta) {
    console.log(`[SyncState.setIssue] step 1: writing { issue_updated_at, comment_ids } for ${issueKey} into the issues section`);
    this.state.issues[issueKey] = meta;
  }

  getPage(pageId) {
    console.log(`[SyncState.getPage] step 1: looking up ${pageId} in the confluence section`);
    return this.state.confluence[pageId];
  }

  setPage(pageId, meta) {
    console.log(`[SyncState.setPage] step 1: writing { lastModified, path, title } for ${pageId} into the confluence section`);
    this.state.confluence[pageId] = meta;
  }

  allPages() {
    console.log('[SyncState.allPages] step 1: returning [pageId, meta] entries from the confluence section');
    return Object.entries(this.state.confluence);
  }

  deletePage(pageId) {
    console.log(`[SyncState.deletePage] step 1: removing ${pageId} from the confluence section`);
    delete this.state.confluence[pageId];
  }

  save() {
    console.log(`[SyncState.save] step 1: JSON.stringify { issues, confluence } to a temp file`);
    const tmpPath = `${this.path}.tmp-${crypto.randomUUID()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    console.log(`[SyncState.save] step 2: renaming temp file over ${this.path} atomically`);
    fs.renameSync(tmpPath, this.path);
  }
}
