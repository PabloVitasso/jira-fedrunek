import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectConfig } from '../../src/sync/ProjectConfig.js';

function makeTempPath(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-projectconfig-'));
  const file = path.join(dir, 'jiraFedrunek.toml');
  if (content !== undefined) fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('TC-PROJECT-CONFIG-001: load() on a missing file returns empty defaults', () => {
  console.log(
    '[TC-PROJECT-CONFIG-001] step 1: creating a ProjectConfig pointed at a non-existent file'
  );
  const config = new ProjectConfig(makeTempPath());
  console.log('[TC-PROJECT-CONFIG-001] step 2: calling load() and asserting empty defaults');
  const result = config.load();
  assert.deepEqual(result, {
    cloudId: undefined,
    confluence: { spaceKeys: [], watchPages: [], watchDirs: [] },
  });
});

test('TC-PROJECT-CONFIG-002: load() extracts cloud_id from the top level', () => {
  console.log('[TC-PROJECT-CONFIG-002] step 1: writing a toml file with cloud_id set');
  const filePath = makeTempPath('cloud_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"\n');
  console.log('[TC-PROJECT-CONFIG-002] step 2: calling load() and asserting cloudId is extracted');
  const result = new ProjectConfig(filePath).load();
  assert.equal(result.cloudId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

test('TC-PROJECT-CONFIG-005: load(data) uses the supplied pre-parsed TOML instead of re-reading the file', () => {
  console.log(
    '[TC-PROJECT-CONFIG-005] step 1: writing a toml file with cloud_id="ON-DISK" but constructing load() with a different pre-parsed object'
  );
  const filePath = makeTempPath('cloud_id = "ON-DISK"\n');
  const config = new ProjectConfig(filePath);
  console.log('[TC-PROJECT-CONFIG-005] step 2: calling load({ cloud_id: "PRE-PARSED" })');
  const result = config.load({ cloud_id: 'PRE-PARSED' });
  console.log(
    `[TC-PROJECT-CONFIG-005] step 3: asserting the pre-parsed data was used, not a fresh disk read, got: ${JSON.stringify(result)}`
  );
  assert.equal(result.cloudId, 'PRE-PARSED');
});

test('TC-PROJECT-CONFIG-004: load() defaults confluence targets when [confluence] table is absent entirely', () => {
  console.log(
    '[TC-PROJECT-CONFIG-004] step 1: writing a toml file with cloud_id only, no [confluence] table'
  );
  const filePath = makeTempPath('cloud_id = "cloud-1"\n');
  console.log(
    '[TC-PROJECT-CONFIG-004] step 2: calling load() and asserting confluence defaults to empty arrays'
  );
  const result = new ProjectConfig(filePath).load();
  assert.deepEqual(result.confluence, { spaceKeys: [], watchPages: [], watchDirs: [] });
});

test('TC-PROJECT-CONFIG-005: load() defaults confluence targets when [confluence] table is present but empty', () => {
  console.log(
    '[TC-PROJECT-CONFIG-005] step 1: writing a toml file with an empty [confluence] table'
  );
  const filePath = makeTempPath('cloud_id = "cloud-1"\n\n[confluence]\n');
  console.log(
    '[TC-PROJECT-CONFIG-005] step 2: calling load() and asserting confluence defaults to empty arrays'
  );
  const result = new ProjectConfig(filePath).load();
  assert.deepEqual(result.confluence, { spaceKeys: [], watchPages: [], watchDirs: [] });
});

test('TC-PROJECT-CONFIG-006: load() maps multiple watch_pages and watch_dirs entries in order', () => {
  console.log(
    '[TC-PROJECT-CONFIG-006] step 1: writing a toml file with two watch_pages and two watch_dirs entries'
  );
  const filePath = makeTempPath(`
cloud_id = "cloud-1"

[confluence]
space_keys = ["ARCHDOCS"]

[[confluence.watch_pages]]
id = "100000001"
label = "Field Mapping"

[[confluence.watch_pages]]
id = "100000003"
label = "OpenAPI Spec"

[[confluence.watch_dirs]]
folder_id = "100000002"
label = "Interaction Inventory"

[[confluence.watch_dirs]]
folder_id = "100000004"
label = "Policy renewal"
`);
  console.log(
    '[TC-PROJECT-CONFIG-006] step 2: calling load() and asserting both lists preserve order'
  );
  const result = new ProjectConfig(filePath).load();
  console.log(`[TC-PROJECT-CONFIG-006] step 3: got: ${JSON.stringify(result)}`);
  assert.deepEqual(result.confluence.watchPages, [
    { id: '100000001', label: 'Field Mapping' },
    { id: '100000003', label: 'OpenAPI Spec' },
  ]);
  assert.deepEqual(result.confluence.watchDirs, [
    { folderId: '100000002', label: 'Interaction Inventory' },
    { folderId: '100000004', label: 'Policy renewal' },
  ]);
});

test('TC-PROJECT-CONFIG-003: load() extracts [confluence] space_keys, watch_pages, watch_dirs', () => {
  console.log(
    '[TC-PROJECT-CONFIG-003] step 1: writing a toml file with a full [confluence] section'
  );
  const filePath = makeTempPath(`
cloud_id = "cloud-1"

[confluence]
space_keys = ["ARCHDOCS"]

[[confluence.watch_pages]]
id = "100000001"
label = "Field Mapping"

[[confluence.watch_dirs]]
folder_id = "100000002"
label = "Interaction Inventory"
`);
  console.log(
    '[TC-PROJECT-CONFIG-003] step 2: calling load() and asserting the confluence targets'
  );
  const result = new ProjectConfig(filePath).load();
  console.log(`[TC-PROJECT-CONFIG-003] step 3: got: ${JSON.stringify(result)}`);
  assert.deepEqual(result.confluence, {
    spaceKeys: ['ARCHDOCS'],
    watchPages: [{ id: '100000001', label: 'Field Mapping' }],
    watchDirs: [{ folderId: '100000002', label: 'Interaction Inventory' }],
  });
});
