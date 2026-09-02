const CONFLUENCE_VERBS = {
  page: (args, { confluenceSyncEngine }) => confluenceSyncEngine.syncPage(args[0]),
  dir: (args, { confluenceSyncEngine, watchDirs }) => {
    const folderId = args[0];
    const entry = (watchDirs ?? []).find((d) => d.folderId === folderId) ?? { folderId, label: folderId };
    return confluenceSyncEngine.syncDir(entry.folderId, entry.label);
  },
  dirs: (args, { confluenceSyncEngine, watchDirs }) => confluenceSyncEngine.syncDirs(watchDirs),
  pages: (args, { confluenceSyncEngine, watchPages }) => confluenceSyncEngine.syncPages(watchPages),
  sync: (args, { confluenceSyncEngine, spaceKeys }) => confluenceSyncEngine.syncSpaces(spaceKeys),
};

export async function dispatch(command, args, deps) {
  console.log(`[dispatch] step 1: dispatching command="${command}" args=${JSON.stringify(args)}`);
  const { mcpSession, syncEngine, trackedKeysConfig } = deps;
  switch (command) {
    case 'login': {
      console.log('[dispatch] step 2: connecting McpSession (browser auth if no cached token) then closing');
      await mcpSession.connect();
      await mcpSession.close();
      console.log('[dispatch] step 3: login complete, mcp-remote token cache warm');
      return { status: 'logged_in' };
    }
    case 'sync': {
      let keys = args;
      if (keys.length === 0) {
        console.log('[dispatch] step 2: no issue keys given, loading tracked_keys from TrackedKeysConfig');
        keys = trackedKeysConfig.load();
      }
      console.log(`[dispatch] step 3: running SyncEngine.syncAll(${JSON.stringify(keys)})`);
      const results = await syncEngine.syncAll(keys);
      console.log(`[dispatch] step 4: sync complete, results=${JSON.stringify(results)}`);
      return { status: 'synced', results };
    }
    case 'track': {
      console.log(`[dispatch] step 2: adding ${JSON.stringify(args)} to TrackedKeysConfig`);
      const keys = trackedKeysConfig.add(args);
      console.log(`[dispatch] step 3: tracked_keys now ${JSON.stringify(keys)}`);
      return { status: 'tracked', keys };
    }
    case 'confluence': {
      const [verb, ...verbArgs] = args;
      console.log(`[dispatch] step 2: dispatching confluence sub-verb="${verb}" args=${JSON.stringify(verbArgs)}`);
      const handler = CONFLUENCE_VERBS[verb];
      if (!handler) {
        console.log(`[dispatch] step 3: unknown confluence verb "${verb}"`);
        throw new Error(`unknown confluence verb: ${verb}`);
      }
      const result = await handler(verbArgs, deps);
      console.log(`[dispatch] step 4: confluence ${verb} complete, result=${JSON.stringify(result)}`);
      return { status: 'confluence', verb, result };
    }
    default:
      console.log(`[dispatch] step 2: unknown command "${command}"`);
      throw new Error(`unknown command: ${command}`);
  }
}
