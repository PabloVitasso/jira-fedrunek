#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { dispatch } from './cli.js';
import { AtlassianOAuthClient } from './auth/AtlassianOAuthClient.js';
import { TokenStore } from './auth/TokenStore.js';
import { CallbackServer } from './auth/CallbackServer.js';
import { AuthSession } from './auth/AuthSession.js';
import { JiraClient } from './jira/JiraClient.js';
import { SyncState } from './sync/SyncState.js';
import { FileWriter } from './sync/FileWriter.js';
import { SyncEngine } from './sync/SyncEngine.js';
import { TrackedKeysConfig } from './sync/TrackedKeysConfig.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(envPath) {
  console.log(`[index.loadEnvFile] step 1: reading ${envPath}, skipping if missing`);
  if (!fs.existsSync(envPath)) {
    console.log('[index.loadEnvFile] step 2: no .env file found, relying on already-exported env vars');
    return;
  }
  console.log('[index.loadEnvFile] step 2: parsing KEY=VALUE lines into process.env (not overriding already-set vars)');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function buildDependencies() {
  console.log('[index.buildDependencies] step 1: constructing AtlassianOAuthClient from env-configured client id/secret/redirect/scopes');
  const redirectUri = process.env.JIRA_REDIRECT_URI ?? 'http://localhost:3000/callback';
  const oauthClient = new AtlassianOAuthClient({
    clientId: process.env.JIRA_CLIENT_ID,
    clientSecret: process.env.JIRA_CLIENT_SECRET,
    redirectUri,
    scopes: (process.env.JIRA_SCOPES ?? 'read:jira-work offline_access').split(' ').filter(Boolean),
  });
  console.log('[index.buildDependencies] step 2: constructing TokenStore/CallbackServer/AuthSession (port derived from redirect_uri)');
  const configDir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'jiraFedrunek')
    : path.join(os.homedir(), '.config', 'jiraFedrunek');
  console.log(`[index.buildDependencies] step 2b: token store lives outside the repo at ${configDir} (never gitignore-dependent)`);
  const tokenStore = new TokenStore(path.join(configDir, 'oauth-tokens.json'));
  const callbackServer = new CallbackServer();
  const port = Number(new URL(redirectUri).port) || 3000;
  const authSession = new AuthSession(oauthClient, tokenStore, callbackServer, { openUrl: open, port });

  console.log('[index.buildDependencies] step 3: constructing JiraClient bound to AuthSession.getAccessToken/getCloudId');
  const jiraClient = new JiraClient({
    getAccessToken: () => authSession.getAccessToken(),
    getCloudId: () => authSession.getCloudId(),
  });

  console.log('[index.buildDependencies] step 4: loading SyncState and constructing SyncEngine');
  const syncState = new SyncState(path.join(projectRoot, 'sync', '.sync-state.json'));
  syncState.load();
  const fileWriter = new FileWriter();
  const syncEngine = new SyncEngine(jiraClient, syncState, fileWriter, {
    pathForKey: (key) => path.join(projectRoot, 'sync', `${key}.md`),
  });

  console.log('[index.buildDependencies] step 5: constructing TrackedKeysConfig (committed jiraFedrunek.toml at repo root)');
  const trackedKeysConfig = new TrackedKeysConfig(path.join(projectRoot, 'jiraFedrunek.toml'));

  return { authSession, syncEngine, trackedKeysConfig };
}

async function main() {
  loadEnvFile(path.join(projectRoot, '.env'));
  const [, , command, ...args] = process.argv;
  console.log(`[index.main] step 1: dispatching command="${command}" args=${JSON.stringify(args)}`);

  if (command !== 'login' && command !== 'sync' && command !== 'track') {
    console.error('usage: jiraFedrunek <login|sync|track> [issue keys...]');
    process.exit(1);
    return;
  }

  console.log('[index.main] step 2: building real AuthSession/SyncEngine dependencies');
  const deps = buildDependencies();
  try {
    const result = await dispatch(command, args, deps);
    console.log(`[index.main] step 3: dispatch complete, result=${JSON.stringify(result)}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
