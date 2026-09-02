import fs from 'node:fs';

export class SyncState {
  constructor(path) {
    this.path = path;
    this.state = {};
  }

  load() {
    console.log(`[SyncState.load] step 1: reading ${this.path}`);
    if (!fs.existsSync(this.path)) {
      console.log('[SyncState.load] step 2: file missing, starting with empty state');
      this.state = {};
      return;
    }
    const raw = fs.readFileSync(this.path, 'utf8');
    try {
      console.log('[SyncState.load] step 2: JSON.parse into in-memory state');
      this.state = JSON.parse(raw);
    } catch (err) {
      console.log(`[SyncState.load] step 3: invalid JSON (${err.message}), resetting to empty state`);
      this.state = {};
    }
  }

  get(issueKey) {
    console.log(`[SyncState.get] step 1: looking up ${issueKey} in in-memory state`);
    return this.state[issueKey];
  }

  set(issueKey, meta) {
    console.log(`[SyncState.set] step 1: writing { issue_updated_at, comment_ids } for ${issueKey} into in-memory state`);
    this.state[issueKey] = meta;
  }

  save() {
    console.log(`[SyncState.save] step 1: JSON.stringify in-memory state to ${this.path}`);
    fs.writeFileSync(this.path, JSON.stringify(this.state, null, 2), 'utf8');
  }
}
