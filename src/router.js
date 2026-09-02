import { Command } from 'commander';
import {
  loginCommand,
  syncCommand,
  trackCommand,
  confluencePageCommand,
  confluenceDirCommand,
  confluenceDirsCommand,
  confluencePagesCommand,
  confluenceSyncCommand,
} from './cli.js';

export async function withJsonRedirect(json, fn) {
  if (!json) return fn();
  console.error(
    '[router.withJsonRedirect] step 1: --json given, redirecting console.log to stderr for this invocation'
  );
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

export async function run(handler, args, deps, { needsConnection, json }) {
  return withJsonRedirect(json, async () => {
    if (needsConnection) {
      console.log('[router.run] step 1: connecting McpSession');
      await deps.mcpSession.connect();
    }
    try {
      return await handler(args, deps);
    } finally {
      if (needsConnection) {
        console.log('[router.run] step 2: closing McpSession');
        await deps.mcpSession.close();
      }
    }
  });
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  console.log(`[router.emit] result: ${JSON.stringify(payload)}`);
}

// Under --json, a handler failure is still exactly one JSON document on
// stdout (machine-readable protocol), not a thrown rejection + stderr text —
// that's the human-mode error path, left untouched (exec() rethrows instead).
function emitJsonError(commandLabel, err) {
  emit(
    {
      ok: false,
      command: commandLabel,
      error: { code: err.code ?? 'COMMAND_FAILED', message: err.message },
    },
    true
  );
  process.exitCode = 1;
}

function registerConfluenceCommands(confluence, exec) {
  confluence
    .command('page <id>')
    .alias('p')
    .action(async id => exec(confluencePageCommand, [id], true, 'confluence.page'));

  confluence
    .command('dir <id>')
    .alias('d')
    .action(async id => exec(confluenceDirCommand, [id], true, 'confluence.dir'));

  confluence
    .command('dirs')
    .alias('ds')
    .action(async () => exec(confluenceDirsCommand, [], true, 'confluence.dirs'));

  confluence
    .command('pages')
    .alias('ps')
    .action(async () => exec(confluencePagesCommand, [], true, 'confluence.pages'));

  confluence
    .command('sync')
    .alias('s')
    .action(async () => exec(confluenceSyncCommand, [], true, 'confluence.sync'));
}

export function buildProgram(deps) {
  const program = new Command();
  program
    .name('jiraFedrunek')
    .exitOverride()
    .configureOutput({ writeErr: str => process.stderr.write(str) })
    .option(
      '--json',
      'emit one { ok, command, data } / { ok: false, command, error } JSON document to stdout, diagnostics on stderr'
    )
    .option('--yes', 'skip the interactive bulk-confirm prompt for Confluence bulk downloads');

  async function exec(handler, args, needsConnection, commandLabel) {
    const { json } = program.opts();
    try {
      const data = await run(handler, args, deps, { needsConnection, json });
      emit(json ? { ok: true, command: commandLabel, data } : data, json);
      return data;
    } catch (err) {
      if (!json) throw err;
      emitJsonError(commandLabel, err);
      return undefined;
    }
  }

  program
    .command('login')
    .alias('l')
    .action(async () => exec(loginCommand, [], true, 'login'));

  program
    .command('track [keys...]')
    .alias('t')
    .action(async keys => exec(trackCommand, keys, false, 'track'));

  program
    .command('sync [keys...]')
    .alias('s')
    .action(async keys => exec(syncCommand, keys, true, 'sync'));

  const confluence = program.command('confluence').alias('cf');
  registerConfluenceCommands(confluence, exec);

  return program;
}
