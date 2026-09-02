export async function dispatch(command, args, { authSession, syncEngine, trackedKeysConfig }) {
  console.log(`[dispatch] step 1: dispatching command="${command}" args=${JSON.stringify(args)}`);
  switch (command) {
    case 'login': {
      console.log('[dispatch] step 2: running AuthSession.getAccessToken() (full OAuth flow if no valid token stored)');
      await authSession.getAccessToken();
      console.log('[dispatch] step 3: login complete, tokens persisted');
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
    default:
      console.log(`[dispatch] step 2: unknown command "${command}"`);
      throw new Error(`unknown command: ${command}`);
  }
}
