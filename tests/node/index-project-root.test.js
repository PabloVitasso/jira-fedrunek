import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDependencies, isMainModule } from '../../src/index.js';

test('TC-INDEX-ROOT-001: buildDependencies(cwd) anchors all stateful paths under cwd, not the package install dir', () => {
  console.log('[TC-INDEX-ROOT-001] step 1: making a scratch cwd distinct from this package dir');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-cwd-'));
  console.log(`[TC-INDEX-ROOT-001] step 2: calling buildDependencies({ cwd })`);
  const deps = buildDependencies({ cwd });
  console.log(
    '[TC-INDEX-ROOT-001] step 3: asserting tracked-keys config, sync-state, per-issue paths, and confluence outDir all resolve under cwd'
  );
  assert.equal(deps.trackedKeysConfig.path, path.join(cwd, 'jiraFedrunek.toml'));
  assert.equal(deps.syncEngine.syncState.path, path.join(cwd, 'sync', '.sync-state.json'));
  assert.equal(deps.syncEngine.pathForKey('PROJ-1'), path.join(cwd, 'sync', 'PROJ-1.md'));
  assert.equal(deps.confluenceSyncEngine.outDir, path.join(cwd, 'sync', 'confluence'));
});

test('TC-INDEX-ROOT-002: isMainModule() matches a direct invocation (argv[1] equals the module path)', () => {
  console.log(
    '[TC-INDEX-ROOT-002] step 1: asserting isMainModule(argv1, moduleUrl) is true when argv1 is exactly the module file'
  );
  const modulePath = path.resolve(import.meta.dirname, '../../src/index.js');
  assert.equal(isMainModule(modulePath, `file://${modulePath}`), true);
});

test("TC-INDEX-ROOT-003: isMainModule() matches when argv[1] is a symlink to the module (npm's node_modules/.bin shim shape)", () => {
  console.log(
    '[TC-INDEX-ROOT-003] step 1: creating a scratch dir with a real file and a symlink to it, mirroring node_modules/.bin'
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jirafedrunek-mainmod-'));
  const realFile = path.join(dir, 'real-index.js');
  fs.writeFileSync(realFile, '// stub');
  const symlinkPath = path.join(dir, 'bin-shim');
  fs.symlinkSync(realFile, symlinkPath);
  console.log(
    '[TC-INDEX-ROOT-003] step 2: asserting isMainModule(symlinkPath, moduleUrlOfRealFile) is true'
  );
  assert.equal(isMainModule(symlinkPath, `file://${realFile}`), true);
});

test('TC-INDEX-ROOT-004: isMainModule() is false when argv[1] points at an unrelated file', () => {
  console.log(
    '[TC-INDEX-ROOT-004] step 1: asserting isMainModule() is false for a mismatched argv1'
  );
  const modulePath = path.resolve(import.meta.dirname, '../../src/index.js');
  assert.equal(isMainModule('/some/other/script.js', `file://${modulePath}`), false);
});
