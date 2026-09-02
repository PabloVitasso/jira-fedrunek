function resolveDirEntry(folderId, watchDirs) {
  return (watchDirs ?? []).find(d => d.folderId === folderId) ?? { folderId, label: folderId };
}

export async function loginCommand(_args, _deps) {
  console.log(
    '[cli.loginCommand] step 1: connection already established by run(), reporting success'
  );
  return { status: 'logged_in' };
}

export async function syncCommand(keys, deps) {
  console.log(`[cli.syncCommand] step 1: given keys=${JSON.stringify(keys)}`);
  let resolvedKeys = keys;
  if (resolvedKeys.length === 0) {
    console.log(
      '[cli.syncCommand] step 2: no issue keys given, loading tracked_keys from TrackedKeysConfig'
    );
    resolvedKeys = deps.trackedKeysConfig.load();
  }
  console.log(
    `[cli.syncCommand] step 3: running SyncEngine.syncAll(${JSON.stringify(resolvedKeys)})`
  );
  const results = await deps.syncEngine.syncAll(resolvedKeys);
  console.log(`[cli.syncCommand] step 4: sync complete, results=${JSON.stringify(results)}`);
  return { status: 'synced', results };
}

export async function trackCommand(keys, deps) {
  console.log(`[cli.trackCommand] step 1: adding ${JSON.stringify(keys)} to TrackedKeysConfig`);
  const updatedKeys = deps.trackedKeysConfig.add(keys);
  console.log(`[cli.trackCommand] step 2: tracked_keys now ${JSON.stringify(updatedKeys)}`);
  return { status: 'tracked', keys: updatedKeys };
}

export async function confluencePageCommand([id], deps) {
  console.log(`[cli.confluencePageCommand] step 1: syncing page id=${id}`);
  const result = await deps.confluenceSyncEngine.syncPage(id);
  console.log(`[cli.confluencePageCommand] step 2: complete, result=${JSON.stringify(result)}`);
  return { status: 'confluence', verb: 'page', result };
}

export async function confluenceDirCommand([folderId], deps) {
  console.log(
    `[cli.confluenceDirCommand] step 1: resolving label for folderId=${folderId} from watchDirs`
  );
  const entry = resolveDirEntry(folderId, deps.watchDirs);
  console.log(
    `[cli.confluenceDirCommand] step 2: syncing dir folderId=${entry.folderId} label=${entry.label}`
  );
  const result = await deps.confluenceSyncEngine.syncDir(entry.folderId, entry.label);
  console.log(`[cli.confluenceDirCommand] step 3: complete, result=${JSON.stringify(result)}`);
  return { status: 'confluence', verb: 'dir', result };
}

export async function confluenceDirsCommand(_args, deps) {
  console.log(
    `[cli.confluenceDirsCommand] step 1: syncing all watchDirs=${JSON.stringify(deps.watchDirs)}`
  );
  const result = await deps.confluenceSyncEngine.syncDirs(deps.watchDirs);
  console.log(`[cli.confluenceDirsCommand] step 2: complete, result=${JSON.stringify(result)}`);
  return { status: 'confluence', verb: 'dirs', result };
}

export async function confluencePagesCommand(_args, deps) {
  console.log(
    `[cli.confluencePagesCommand] step 1: syncing all watchPages=${JSON.stringify(deps.watchPages)}`
  );
  const result = await deps.confluenceSyncEngine.syncPages(deps.watchPages);
  console.log(`[cli.confluencePagesCommand] step 2: complete, result=${JSON.stringify(result)}`);
  return { status: 'confluence', verb: 'pages', result };
}

export async function confluenceSyncCommand(_args, deps) {
  console.log(
    `[cli.confluenceSyncCommand] step 1: syncing all spaceKeys=${JSON.stringify(deps.spaceKeys)}`
  );
  const result = await deps.confluenceSyncEngine.syncSpaces(deps.spaceKeys);
  console.log(`[cli.confluenceSyncCommand] step 2: complete, result=${JSON.stringify(result)}`);
  return { status: 'confluence', verb: 'sync', result };
}
