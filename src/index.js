#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { dispatch } from './cli.js';
import { McpSession } from './mcp/McpSession.js';
import { JiraClient } from './jira/JiraClient.js';
import { ConfluenceClient } from './confluence/ConfluenceClient.js';
import { FolderWalker } from './confluence/FolderWalker.js';
import { ConfluenceSyncEngine } from './confluence/ConfluenceSyncEngine.js';
import { SyncState } from './sync/SyncState.js';
import { FileWriter } from './sync/FileWriter.js';
import { SyncEngine } from './sync/SyncEngine.js';
import { TrackedKeysConfig } from './sync/TrackedKeysConfig.js';
import { ProjectConfig } from './sync/ProjectConfig.js';
import { parse } from 'smol-toml';

// npm's node_modules/.bin shim is a symlink; import.meta.url resolves to the
// symlink's realpath while process.argv[1] stays the symlink path, so a bare
// string compare falsely reports "not the main module" when run via a
// bin shim (as happens for every real jiraFedrunek install).
export function isMainModule(argv1, moduleUrl) {
  if (!argv1) return false;
  let resolvedArgv1;
  try {
    resolvedArgv1 = fs.realpathSync(argv1);
  } catch {
    return false;
  }
  return fileURLToPath(moduleUrl) === resolvedArgv1;
}

function loadEnvFile(envPath) {
  console.log(`[index.loadEnvFile] step 1: reading ${envPath}, skipping if missing`);
  if (!fs.existsSync(envPath)) {
    console.log(
      '[index.loadEnvFile] step 2: no .env file found, relying on already-exported env vars'
    );
    return;
  }
  console.log(
    '[index.loadEnvFile] step 2: parsing KEY=VALUE lines into process.env (not overriding already-set vars)'
  );
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

function confirmPrompt(q) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          'Bulk download requires confirmation but stdin is not a TTY. Re-run with --yes to skip prompt.'
        )
      );
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function alwaysConfirmBulk(items) {
  console.log(
    `[index.alwaysConfirmBulk] step 1: about to download ${items.length} Confluence pages`
  );
  console.log('[index.alwaysConfirmBulk] step 2: --yes given, skipping prompt');
  return true;
}

async function promptConfirmBulk(items) {
  console.log(
    `[index.promptConfirmBulk] step 1: about to download ${items.length} Confluence pages`
  );
  items.slice(0, 10).forEach(p => console.log(`         - [${p.spaceKey}] ${p.title}`));
  if (items.length > 10) console.log(`         ... and ${items.length - 10} more`);
  try {
    const answer = await confirmPrompt(`\nDownload all ${items.length} pages? [y/N] `);
    return answer === 'y' || answer === 'yes';
  } catch (err) {
    console.error(err.message);
    return false;
  }
}

function loadTomlOnce(tomlPath) {
  console.log(`[index.loadTomlOnce] step 1: reading + parsing ${tomlPath} once, if it exists`);
  return fs.existsSync(tomlPath) ? parse(fs.readFileSync(tomlPath, 'utf8')) : undefined;
}

export function buildDependencies({ cwd = process.cwd(), yes } = {}) {
  const projectRoot = path.resolve(cwd);
  console.log(
    '[index.buildDependencies] step 1: loading jiraFedrunek.toml (cloud_id, confluence targets, tracked_keys) once, shared by ProjectConfig and TrackedKeysConfig'
  );
  const tomlPath = path.join(projectRoot, 'jiraFedrunek.toml');
  const tomlData = loadTomlOnce(tomlPath);
  const projectConfig = new ProjectConfig(tomlPath);
  const { cloudId, confluence } = projectConfig.load(tomlData);

  console.log(
    '[index.buildDependencies] step 2: constructing one McpSession, shared by JiraClient and ConfluenceClient'
  );
  const mcpSession = new McpSession({ cloudId });

  console.log('[index.buildDependencies] step 3: constructing JiraClient/SyncState/SyncEngine');
  const jiraClient = new JiraClient({ mcpSession, cloudId });
  const syncState = new SyncState(path.join(projectRoot, 'sync', '.sync-state.json'));
  syncState.load();
  const fileWriter = new FileWriter();
  const syncEngine = new SyncEngine(jiraClient, syncState, fileWriter, {
    pathForKey: key => path.join(projectRoot, 'sync', `${key}.md`),
  });

  console.log(
    '[index.buildDependencies] step 4: constructing ConfluenceClient/FolderWalker/ConfluenceSyncEngine (same SyncState/FileWriter)'
  );
  const confluenceClient = new ConfluenceClient({ mcpSession, cloudId });
  const folderWalker = new FolderWalker(confluenceClient);
  const confluenceSyncEngine = new ConfluenceSyncEngine(
    confluenceClient,
    folderWalker,
    syncState,
    fileWriter,
    {
      outDir: path.join(projectRoot, 'sync', 'confluence'),
      confirmBulk: yes ? alwaysConfirmBulk : promptConfirmBulk,
    }
  );

  console.log(
    '[index.buildDependencies] step 5: constructing TrackedKeysConfig (gitignored jiraFedrunek.toml at repo root)'
  );
  const trackedKeysConfig = new TrackedKeysConfig(tomlPath);

  return {
    mcpSession,
    syncEngine,
    trackedKeysConfig,
    confluenceSyncEngine,
    watchDirs: confluence.watchDirs,
    watchPages: confluence.watchPages,
    spaceKeys: confluence.spaceKeys,
  };
}

export async function main(cwd = process.cwd()) {
  const projectRoot = path.resolve(cwd);
  loadEnvFile(path.join(projectRoot, '.env'));
  const [, , command, ...args] = process.argv;
  console.log(`[index.main] step 1: dispatching command="${command}" args=${JSON.stringify(args)}`);

  if (!['login', 'sync', 'track', 'confluence'].includes(command)) {
    console.error('usage: jiraFedrunek <login|sync|track|confluence> [args...]');
    process.exitCode = 1;
    return;
  }

  console.log(
    '[index.main] step 2: building real McpSession/SyncEngine/ConfluenceSyncEngine dependencies'
  );
  const deps = buildDependencies({ cwd: projectRoot, yes: args.includes('--yes') });
  // "login" connects/closes McpSession itself inside dispatch(); "track" never
  // touches the network at all. Every other command needs a live session first.
  const needsConnection = command !== 'track' && command !== 'login';
  try {
    if (needsConnection) {
      await deps.mcpSession.connect();
    }
    const result = await dispatch(command, args, deps);
    console.log(`[index.main] step 3: dispatch complete, result=${JSON.stringify(result)}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    if (needsConnection) {
      await deps.mcpSession.close();
    }
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main();
}
