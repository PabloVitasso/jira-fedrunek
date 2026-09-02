import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JiraClient, DEFAULT_JIRA_FIELDS } from '../../src/jira/JiraClient.js';

function textResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function makeClient({ callTool, cloudId = 'fake-cloud-id', fields } = {}) {
  return new JiraClient({ mcpSession: { callTool }, cloudId, fields });
}

test('TC-JIRA-CLIENT-001: getIssue calls searchJiraIssuesUsingJql with key = <key>, default fields, and returns the single matched issue', async () => {
  console.log('[TC-JIRA-CLIENT-001] step 1: wiring a fake mcpSession returning one matching issue');
  let captured;
  const fakeIssue = { key: 'PROJ-1', fields: { summary: 'x', updated: '2026-01-01T00:00:00.000Z' } };
  const callTool = async (name, args) => {
    captured = { name, args };
    return textResult({ issues: [fakeIssue], isLast: true });
  };
  console.log('[TC-JIRA-CLIENT-001] step 2: calling getIssue("PROJ-1")');
  const client = makeClient({ callTool });
  const issue = await client.getIssue('PROJ-1');
  console.log(`[TC-JIRA-CLIENT-001] step 3: asserting the request shape, got: ${JSON.stringify(captured)}`);
  assert.equal(captured.name, 'searchJiraIssuesUsingJql');
  assert.equal(captured.args.jql, 'key = PROJ-1');
  assert.deepEqual(captured.args.fields, DEFAULT_JIRA_FIELDS);
  assert.equal(captured.args.responseContentFormat, 'markdown');
  assert.equal(captured.args.maxResults, 1);
  console.log(`[TC-JIRA-CLIENT-001] step 4: asserting the matched issue is returned, got: ${JSON.stringify(issue)}`);
  assert.deepEqual(issue, fakeIssue);
});

test('TC-JIRA-CLIENT-002: getIssue throws when zero issues match (key not found)', async () => {
  console.log('[TC-JIRA-CLIENT-002] step 1: wiring a fake mcpSession returning an empty issues array');
  const callTool = async () => textResult({ issues: [], isLast: true });
  console.log('[TC-JIRA-CLIENT-002] step 2: calling getIssue and asserting it rejects');
  const client = makeClient({ callTool });
  await assert.rejects(() => client.getIssue('PROJ-9999'), /not found/);
});

test('TC-JIRA-CLIENT-003: getIssue throws when more than one issue matches key = X (invariant violation)', async () => {
  console.log('[TC-JIRA-CLIENT-003] step 1: wiring a fake mcpSession returning two issues for a single-key lookup');
  const callTool = async () => textResult({ issues: [{ key: 'PROJ-1' }, { key: 'PROJ-1' }], isLast: true });
  console.log('[TC-JIRA-CLIENT-003] step 2: calling getIssue and asserting it rejects');
  const client = makeClient({ callTool });
  await assert.rejects(() => client.getIssue('PROJ-1'));
});

test('TC-JIRA-CLIENT-004: getIssue reads comments inline from fields.comment.comments (no separate call)', async () => {
  console.log('[TC-JIRA-CLIENT-004] step 1: wiring a fake mcpSession returning an issue with inline comments');
  const fakeIssue = {
    key: 'PROJ-1',
    fields: { updated: '2026-01-01T00:00:00.000Z', comment: { comments: [{ id: '1' }, { id: '2' }] } },
  };
  const callTool = async () => textResult({ issues: [fakeIssue], isLast: true });
  console.log('[TC-JIRA-CLIENT-004] step 2: calling getIssue("PROJ-1")');
  const client = makeClient({ callTool });
  const issue = await client.getIssue('PROJ-1');
  console.log(`[TC-JIRA-CLIENT-004] step 3: asserting fields.comment.comments is present on the returned issue, got: ${JSON.stringify(issue.fields.comment)}`);
  assert.deepEqual(issue.fields.comment.comments, [{ id: '1' }, { id: '2' }]);
});

test('TC-JIRA-CLIENT-005: constructor accepts a custom fields list overriding DEFAULT_JIRA_FIELDS', async () => {
  console.log('[TC-JIRA-CLIENT-005] step 1: wiring a fake mcpSession capturing the requested fields');
  let captured;
  const callTool = async (name, args) => {
    captured = args.fields;
    return textResult({ issues: [{ key: 'PROJ-1', fields: {} }], isLast: true });
  };
  console.log('[TC-JIRA-CLIENT-005] step 2: constructing JiraClient with a narrower fields list and calling getIssue');
  const client = makeClient({ callTool, fields: ['summary', 'status'] });
  await client.getIssue('PROJ-1');
  console.log(`[TC-JIRA-CLIENT-005] step 3: asserting the custom fields list was sent, got: ${JSON.stringify(captured)}`);
  assert.deepEqual(captured, ['summary', 'status']);
});
