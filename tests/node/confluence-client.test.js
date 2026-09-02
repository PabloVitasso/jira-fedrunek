import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfluenceClient } from '../../src/confluence/ConfluenceClient.js';

function textResult(payload) {
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] };
}

function makeClient({ callTool, cloudId = 'fake-cloud-id' } = {}) {
  return new ConfluenceClient({ mcpSession: { callTool }, cloudId });
}

test('TC-CONFLUENCE-CLIENT-001: getPage calls getConfluencePage with contentFormat=markdown and unwraps the JSON envelope body', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-001] step 1: wiring a fake mcpSession returning a JSON envelope with a .body field');
  let captured;
  const callTool = async (name, args) => {
    captured = { name, args };
    return textResult(JSON.stringify({ body: '# Title\n\ntext' }));
  };
  console.log('[TC-CONFLUENCE-CLIENT-001] step 2: calling getPage("100000001")');
  const client = makeClient({ callTool });
  const body = await client.getPage('100000001');
  console.log(`[TC-CONFLUENCE-CLIENT-001] step 3: asserting the request shape, got: ${JSON.stringify(captured)}`);
  assert.equal(captured.name, 'getConfluencePage');
  assert.equal(captured.args.pageId, '100000001');
  assert.equal(captured.args.contentFormat, 'markdown');
  console.log(`[TC-CONFLUENCE-CLIENT-001] step 4: asserting the unwrapped markdown body, got: ${JSON.stringify(body)}`);
  assert.equal(body, '# Title\n\ntext');
});

test('TC-CONFLUENCE-CLIENT-002: getSpaces calls getConfluenceSpaces and returns the results array', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-002] step 1: wiring a fake mcpSession returning two spaces');
  let captured;
  const callTool = async (name, args) => {
    captured = { name, args };
    return textResult({ results: [{ key: 'ARCHDOCS', id: '1' }] });
  };
  console.log('[TC-CONFLUENCE-CLIENT-002] step 2: calling getSpaces(["ARCHDOCS"])');
  const client = makeClient({ callTool });
  const spaces = await client.getSpaces(['ARCHDOCS']);
  console.log(`[TC-CONFLUENCE-CLIENT-002] step 3: asserting request + result, got request: ${JSON.stringify(captured)}, result: ${JSON.stringify(spaces)}`);
  assert.equal(captured.name, 'getConfluenceSpaces');
  assert.deepEqual(captured.args.keys, ['ARCHDOCS']);
  assert.deepEqual(spaces, [{ key: 'ARCHDOCS', id: '1' }]);
});

test('TC-CONFLUENCE-CLIENT-003: getPagesInSpace forwards a cursor when given and returns the raw parsed envelope', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-003] step 1: wiring a fake mcpSession capturing cursor forwarding');
  let captured;
  const callTool = async (name, args) => {
    captured = args;
    return textResult({ results: [{ id: '1' }], _links: {} });
  };
  console.log('[TC-CONFLUENCE-CLIENT-003] step 2: calling getPagesInSpace("42", { cursor: "abc" })');
  const client = makeClient({ callTool });
  const data = await client.getPagesInSpace('42', { cursor: 'abc' });
  console.log(`[TC-CONFLUENCE-CLIENT-003] step 3: asserting cursor forwarded and envelope returned, got: ${JSON.stringify(captured)}`);
  assert.equal(captured.spaceId, '42');
  assert.equal(captured.cursor, 'abc');
  assert.deepEqual(data, { results: [{ id: '1' }], _links: {} });
});

test('TC-CONFLUENCE-CLIENT-004: getPagesInSpace omits cursor when not given', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-004] step 1: wiring a fake mcpSession capturing the args');
  let captured;
  const callTool = async (name, args) => {
    captured = args;
    return textResult({ results: [] });
  };
  console.log('[TC-CONFLUENCE-CLIENT-004] step 2: calling getPagesInSpace("42") with no cursor');
  const client = makeClient({ callTool });
  await client.getPagesInSpace('42');
  console.log(`[TC-CONFLUENCE-CLIENT-004] step 3: asserting no cursor key present, got: ${JSON.stringify(captured)}`);
  assert.equal('cursor' in captured, false);
});

test('TC-CONFLUENCE-CLIENT-006: getPage returns the raw text as-is when the body is not valid JSON', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-006] step 1: wiring a fake mcpSession returning plain (non-JSON) markdown text');
  const callTool = async () => textResult('## Section\n\nplain markdown, not a JSON envelope');
  console.log('[TC-CONFLUENCE-CLIENT-006] step 2: calling getPage("100000001")');
  const client = makeClient({ callTool });
  const body = await client.getPage('100000001');
  console.log(`[TC-CONFLUENCE-CLIENT-006] step 3: asserting the raw text was passed through unchanged, got: ${JSON.stringify(body)}`);
  assert.equal(body, '## Section\n\nplain markdown, not a JSON envelope');
});

test('TC-CONFLUENCE-CLIENT-007: getSpaces returns an empty array when the response has no results key', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-007] step 1: wiring a fake mcpSession returning a JSON envelope with no results key');
  const callTool = async () => textResult({});
  console.log('[TC-CONFLUENCE-CLIENT-007] step 2: calling getSpaces(["ARCHDOCS"])');
  const client = makeClient({ callTool });
  const spaces = await client.getSpaces(['ARCHDOCS']);
  console.log(`[TC-CONFLUENCE-CLIENT-007] step 3: asserting an empty array fallback, got: ${JSON.stringify(spaces)}`);
  assert.deepEqual(spaces, []);
});

test('TC-CONFLUENCE-CLIENT-008: searchByCql forwards a cursor and a non-default limit when given', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-008] step 1: wiring a fake mcpSession capturing the args');
  let captured;
  const callTool = async (name, args) => {
    captured = args;
    return textResult({ results: [] });
  };
  console.log('[TC-CONFLUENCE-CLIENT-008] step 2: calling searchByCql(cql, { cursor: "xyz", limit: 10 })');
  const client = makeClient({ callTool });
  await client.searchByCql('type = page', { cursor: 'xyz', limit: 10 });
  console.log(`[TC-CONFLUENCE-CLIENT-008] step 3: asserting cursor and limit were forwarded, got: ${JSON.stringify(captured)}`);
  assert.equal(captured.cursor, 'xyz');
  assert.equal(captured.limit, 10);
});

test('TC-CONFLUENCE-CLIENT-005: searchByCql calls searchConfluenceUsingCql with the given cql', async () => {
  console.log('[TC-CONFLUENCE-CLIENT-005] step 1: wiring a fake mcpSession capturing the cql');
  let captured;
  const callTool = async (name, args) => {
    captured = { name, args };
    return textResult({ results: [{ id: '100000002' }] });
  };
  console.log('[TC-CONFLUENCE-CLIENT-005] step 2: calling searchByCql(\'ancestor = "100000002" AND type = page\')');
  const client = makeClient({ callTool });
  const data = await client.searchByCql('ancestor = "100000002" AND type = page');
  console.log(`[TC-CONFLUENCE-CLIENT-005] step 3: asserting request + result, got: ${JSON.stringify(captured)}`);
  assert.equal(captured.name, 'searchConfluenceUsingCql');
  assert.equal(captured.args.cql, 'ancestor = "100000002" AND type = page');
  assert.deepEqual(data.results, [{ id: '100000002' }]);
});
