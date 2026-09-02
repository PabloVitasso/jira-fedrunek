import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../../src/sync/SyncEngine.js';

const DOWNLOADED_AT = '2026-09-02T14:03:00Z';

function makeComment(overrides = {}) {
  return {
    id: '10088',
    author: { name: 'john.doe', displayName: 'John Doe' },
    created: '2026-08-30T10:00:00.000+0000',
    updated: '2026-08-30T10:00:00.000+0000',
    body: 'a comment',
    ...overrides,
  };
}

function makeIssue(overrides = {}) {
  return {
    key: 'PROJ-1',
    id: '10042',
    self: 'https://yoursite.atlassian.net/rest/api/3/issue/10042',
    fields: {
      summary: 'Ticket title',
      status: { name: 'In Progress' },
      assignee: null,
      updated: '2026-09-01T09:12:00.000+0000',
      description: 'desc',
      comment: { comments: [makeComment()] },
    },
    ...overrides,
  };
}

function makeJiraClient({ issue }) {
  return {
    getIssue: async () => issue,
  };
}

function makeSyncState(initial = {}) {
  const state = { ...initial };
  return {
    getIssue: key => state[key],
    setIssue: (key, meta) => {
      state[key] = meta;
    },
    save: () => {},
    _state: state,
  };
}

function makeFileWriter(initial = {}) {
  const files = { ...initial };
  return {
    read: path => (path in files ? files[path] : null),
    write: (path, content) => {
      files[path] = content;
    },
    _files: files,
  };
}

test('TC-SYNC-ENGINE-001: syncIssue creates a new file and sets state when no prior state exists', async () => {
  console.log(
    '[TC-SYNC-ENGINE-001] step 1: wiring fake JiraClient/SyncState/FileWriter with no prior state'
  );
  const jiraClient = makeJiraClient({ issue: makeIssue() });
  const syncState = makeSyncState();
  const fileWriter = makeFileWriter();
  const engine = new SyncEngine(jiraClient, syncState, fileWriter, { now: () => DOWNLOADED_AT });
  console.log('[TC-SYNC-ENGINE-001] step 2: calling syncIssue("PROJ-1")');
  const result = await engine.syncIssue('PROJ-1');
  console.log(
    `[TC-SYNC-ENGINE-001] step 3: asserting result status "created", got: ${JSON.stringify(result)}`
  );
  assert.deepEqual(result, { status: 'created', key: 'PROJ-1' });
  console.log('[TC-SYNC-ENGINE-001] step 4: asserting a file was written and SyncState updated');
  assert.equal(Object.keys(fileWriter._files).length, 1);
  assert.match(Object.values(fileWriter._files)[0], /<!-- comment_id: 10088 -->/);
  assert.deepEqual(syncState._state['PROJ-1'], {
    issue_updated_at: '2026-09-01T09:12:00.000+0000',
    comment_ids: ['10088'],
  });
});

test('TC-SYNC-ENGINE-002: syncIssue skips regeneration when fields.updated matches stored state', async () => {
  console.log(
    '[TC-SYNC-ENGINE-002] step 1: wiring fake JiraClient/SyncState with matching issue_updated_at already stored'
  );
  const jiraClient = makeJiraClient({ issue: makeIssue() });
  const syncState = makeSyncState({
    'PROJ-1': { issue_updated_at: '2026-09-01T09:12:00.000+0000', comment_ids: ['10088'] },
  });
  const fileWriter = makeFileWriter({ '/tmp/PROJ-1.md': 'stale content' });
  const engine = new SyncEngine(jiraClient, syncState, fileWriter, {
    now: () => DOWNLOADED_AT,
    pathForKey: () => '/tmp/PROJ-1.md',
  });
  console.log('[TC-SYNC-ENGINE-002] step 2: calling syncIssue("PROJ-1")');
  const result = await engine.syncIssue('PROJ-1');
  console.log(
    `[TC-SYNC-ENGINE-002] step 3: asserting result status "unchanged" and file untouched, got: ${JSON.stringify(result)}`
  );
  assert.deepEqual(result, { status: 'unchanged', key: 'PROJ-1' });
  assert.equal(fileWriter._files['/tmp/PROJ-1.md'], 'stale content');
});

test('TC-SYNC-ENGINE-003: syncIssue regenerates and updates state when fields.updated changed', async () => {
  console.log(
    '[TC-SYNC-ENGINE-003] step 1: wiring fake JiraClient with a newer issue than what is stored'
  );
  const jiraClient = makeJiraClient({
    issue: makeIssue({
      fields: { ...makeIssue().fields, updated: '2026-09-02T00:00:00.000+0000' },
    }),
  });
  const syncState = makeSyncState({
    'PROJ-1': { issue_updated_at: '2026-09-01T09:12:00.000+0000', comment_ids: ['10088'] },
  });
  const fileWriter = makeFileWriter({ '/tmp/PROJ-1.md': 'stale content' });
  const engine = new SyncEngine(jiraClient, syncState, fileWriter, {
    now: () => DOWNLOADED_AT,
    pathForKey: () => '/tmp/PROJ-1.md',
  });
  console.log('[TC-SYNC-ENGINE-003] step 2: calling syncIssue("PROJ-1")');
  const result = await engine.syncIssue('PROJ-1');
  console.log(
    `[TC-SYNC-ENGINE-003] step 3: asserting result status "updated" and state's issue_updated_at bumped, got: ${JSON.stringify(result)}`
  );
  assert.deepEqual(result, { status: 'updated', key: 'PROJ-1' });
  assert.equal(syncState._state['PROJ-1'].issue_updated_at, '2026-09-02T00:00:00.000+0000');
  assert.notEqual(fileWriter._files['/tmp/PROJ-1.md'], 'stale content');
});

test('TC-SYNC-ENGINE-004: syncAll calls syncIssue for every key and collects results in order', async () => {
  console.log(
    '[TC-SYNC-ENGINE-004] step 1: wiring a fake JiraClient serving two distinct issues by key'
  );
  const issuesByKey = {
    'PROJ-1': makeIssue({
      key: 'PROJ-1',
      fields: { ...makeIssue().fields, comment: { comments: [] } },
    }),
    'PROJ-2': makeIssue({
      key: 'PROJ-2',
      fields: { ...makeIssue().fields, comment: { comments: [] } },
    }),
  };
  const jiraClient = {
    getIssue: async key => issuesByKey[key],
  };
  const syncState = makeSyncState();
  const fileWriter = makeFileWriter();
  const engine = new SyncEngine(jiraClient, syncState, fileWriter, { now: () => DOWNLOADED_AT });
  console.log('[TC-SYNC-ENGINE-004] step 2: calling syncAll(["PROJ-1", "PROJ-2"])');
  const results = await engine.syncAll(['PROJ-1', 'PROJ-2']);
  console.log(
    `[TC-SYNC-ENGINE-004] step 3: asserting both results collected in order, got: ${JSON.stringify(results)}`
  );
  assert.deepEqual(results, [
    { status: 'created', key: 'PROJ-1' },
    { status: 'created', key: 'PROJ-2' },
  ]);
});

test('TC-SYNC-ENGINE-005: syncIssue treats a missing fields.comment as zero comments', async () => {
  console.log(
    '[TC-SYNC-ENGINE-005] step 1: wiring a fake JiraClient for an issue with no comment field at all'
  );
  const issue = makeIssue();
  delete issue.fields.comment;
  const jiraClient = makeJiraClient({ issue });
  const syncState = makeSyncState();
  const fileWriter = makeFileWriter();
  const engine = new SyncEngine(jiraClient, syncState, fileWriter, { now: () => DOWNLOADED_AT });
  console.log('[TC-SYNC-ENGINE-005] step 2: calling syncIssue("PROJ-1")');
  const result = await engine.syncIssue('PROJ-1');
  console.log(
    `[TC-SYNC-ENGINE-005] step 3: asserting it still succeeds with zero comment_ids, got: ${JSON.stringify(syncState._state['PROJ-1'])}`
  );
  assert.deepEqual(result, { status: 'created', key: 'PROJ-1' });
  assert.deepEqual(syncState._state['PROJ-1'].comment_ids, []);
});
