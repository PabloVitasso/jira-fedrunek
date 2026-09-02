---
name: npm-global-install
description: make jiraFedrunek installable from GitHub as a helper tool vendored into another project's scripts/ dir (or similar), by anchoring config and sync state to the caller's cwd instead of the package's own install directory, and making it work correctly on Windows
metadata:
  type: done
  status: done
  spec_ref: docs/jiraFedrunek-spec-v2.md
  see_also: docs/architecture.md, docs/development.md#auth
---

# Make jiraFedrunek installable as a vendored helper CLI (done)

**Status: implemented (2026-09-02).** See "Implementation notes" at the
bottom for what shipped, what changed from the original plan, and what's
still open.

# Make jiraFedrunek installable as a vendored helper CLI (proposal)

## Why

The target deployment shape: jiraFedrunek published on GitHub, then pulled
into some other, bigger project as a helper tool — e.g. `npm install
github:<user>/jiraFedrunek` into that host project's `scripts/` (or as a
`devDependency` resolving into `node_modules/.bin/jiraFedrunek`), run from
the host project's own directory to sync *that* project's Jira/Confluence
docs. This is not "publish to the public npm registry" — it's "installable
straight from a GitHub URL into someone else's repo layout." **Windows is a
required target**, not best-effort, since the host projects this gets
vendored into aren't guaranteed to be Linux/macOS-only.

The package is already npm-shaped — `bin: { jiraFedrunek: "src/index.js"
}`, ESM, a real shebang, no forbidden `jira.js` dependency — so the open
question is whether it actually behaves correctly once installed somewhere
other than the repo it was authored in, and whether its path/subprocess
handling holds up cross-platform (the user specifically flagged OS
independence, especially temp folders, and Windows support explicitly).

## What's already fine (verified by reading every path/fs/subprocess call
in `src/` and `tests/node/`, 2026-09-02)

- All temp-file usage in tests goes through `os.tmpdir()` + `path.join()`
  (`tests/node/sync-file-writer.test.js`, `sync-project-config.test.js`,
  `sync-state.test.js`, `sync-tracked-keys-config.test.js`,
  `confluence-sync-engine.test.js`) — no hardcoded `/tmp` outside one mocked
  `FileWriter` stub in `sync-engine.test.js` that never touches the real
  filesystem.
- `SyncState.save()` writes to `${path}.tmp-${crypto.randomUUID()}` then
  `fs.renameSync` over the real path — same-directory, and correct on
  Linux/macOS. **Its Windows behavior is not verified** — see "Open issue:
  `renameSync` on Windows" below; do not treat this as guaranteed-atomic
  cross-platform.
- `FileWriter.write()` uses `path.dirname()` + `fs.mkdirSync(..., {
  recursive: true })` — no manual separator handling.
- Confluence filenames are built by `slug()` in
  `src/confluence/ConfluenceSyncEngine.js:9`, which strips everything except
  `a-z0-9` and collapses to `-` — immune to Windows-reserved characters
  (`: * ? " < > |`) by construction.
- `ConfluenceSyncEngine` already normalizes `\` to `/` when comparing
  manifest paths (`ConfluenceSyncEngine.js:114-146`), so path-separator
  differences between platforms don't break the CONTENTS.md/diff logic.
- No `chmod`, no hardcoded `path.sep`, no unix-only permission calls
  anywhere in `src/`.

## The actual blocker: `projectRoot` is the install directory, not the cwd

`src/index.js:19`:

```js
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
```

Every stateful path in `buildDependencies()` and `main()` is anchored to
this: `jiraFedrunek.toml` (`index.js:93`), `sync/.sync-state.json`
(`index.js:105`), `sync/{key}.md` (`index.js:109`), `sync/confluence`
(`index.js:123`), `.env` (`index.js:145`). This is correct today only
because jiraFedrunek is always run as `node src/index.js` from inside its
own repo clone, where "install directory" and "project directory" happen to
be the same folder.

Once installed via `npm install github:<user>/jiraFedrunek` into a host
project's `node_modules` (whether invoked as `npx jiraFedrunek` from that
host project, or symlinked into `scripts/`), `import.meta.url` resolves to
`<host-project>/node_modules/jirafedrunek/src/index.js` — **not** the host
project's own root, and **not necessarily the caller's cwd either**, since
`node_modules/.bin` shims are themselves a layer of indirection. Consequences:

- Running `jiraFedrunek track PROJ-1` from inside the host project would
  write `jiraFedrunek.toml` and `sync/` **inside
  `node_modules/jirafedrunek/`** — a directory `npm install`/`git pull` can
  wipe or overwrite at any time, and one that's `.gitignore`d by
  convention, so the host project's tracked keys and synced docs would be
  silently unpersisted and invisible to `git status`.
- Two host projects vendoring jiraFedrunek independently would each get
  their own `node_modules/jirafedrunek` copy (normal npm behavior), so the
  cross-project collision from a true *global* install doesn't apply here —
  but the wrong-directory problem is the same: state ends up under
  `node_modules`, not in the host project where the user expects to find
  and commit their `jiraFedrunek.toml`.
- A user could not `cd` into the host project, run `npx jiraFedrunek sync`,
  and expect output in `./sync/` the way virtually every other
  project-vendored Node CLI (eslint, prettier) behaves.

## Blocking issue #2: `npx` spawn is not Windows-safe

`src/mcp/McpSession.js:18`:

```js
function defaultTransportFactory(mcpUrl) {
  return new StdioClientTransport({ command: 'npx', args: ['-y', 'mcp-remote', mcpUrl] });
}
```

`child_process.spawn('npx', …)` without `shell: true` fails on Windows,
where `npx` resolves to `npx.cmd`, a shell shim rather than a directly
executable binary — Node cannot exec it without either `shell: true` or
resolving the platform-specific extension first. Since Windows is an
explicit target for this deployment shape (a host project pulling
jiraFedrunek into `scripts/` has no guarantee of a Linux/macOS host), this
is promoted from "nice to have" to a hard blocker alongside the
`projectRoot` issue — `login`/`sync`/anything that talks to the MCP server
would simply crash on Windows today, before config paths even matter.

Also worth checking on Windows once the above is fixed: `readline`-based
TTY confirmation in `confirmPrompt` (`src/index.js:43`) — expected to work
identically on Windows, but not yet exercised there.

## Blocking issue #3: `renameSync` over an existing file is not guaranteed-safe on Windows

`SyncState.save()` (`src/sync/SyncState.js`) relies on `fs.renameSync(tmpPath,
this.path)` to atomically replace `.sync-state.json`, and `SyncState.load()`
does the same pattern when backing up a corrupt file
(`fs.renameSync(this.path, backupPath)`, which doesn't overwrite an
existing destination so is lower risk). Node's docs describe
`fs.renameSync` as an unconditional overwrite-and-replace, but this has a
documented history of `EPERM`/`EBUSY` failures on Windows when the
destination file is open elsewhere (e.g. held by an antivirus scanner, a
text editor, or a second process) — see
[nodejs/node#21957](https://github.com/nodejs/node/issues/21957). **Do not
state or assume this is "atomic on every OS."** It needs to be verified
with a real Windows integration test before this proposal can claim
Windows correctness for `sync`'s state-file writes.

If Windows testing surfaces `EPERM`/`EBUSY` failures, add a retry-with-real-delay
around the `renameSync` call — e.g.:

```js
function safeRenameSync(src, dest, delaysMs = [10, 50, 100]) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(src, dest);
    } catch (err) {
      if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
      if (i >= delaysMs.length) throw err;
      // renameSync has no async sibling call here without restructuring
      // SyncState.save() itself to be async — Atomics.wait blocks the
      // event loop for exactly delaysMs[i], unlike a bare retry loop
      // (which retries with zero delay and won't outlast a transient lock).
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delaysMs[i]);
    }
  }
}
```

Two things a naive retry-loop sketch gets wrong, worth calling out
explicitly so they aren't repeated: (1) a loop with no actual sleep between
attempts (just re-calling `renameSync` back-to-back) won't outlast a
transient lock held for tens of milliseconds — the delay has to be real,
which for *synchronous* code means `Atomics.wait` (or restructuring
`SyncState.save()` to be `async` and using `setTimeout`); (2) **do not**
fall back to `copyFileSync` + `unlinkSync` after retries are exhausted —
that reintroduces exactly the non-atomicity this pattern exists to avoid
(a concurrent reader can observe a partially-copied file mid-copy, and a
crash between copy and unlink orphans the temp file). If retries exhaust,
fail loudly and let the caller see the `EBUSY`/`EPERM` — that means
something else genuinely has the file locked, which the user needs to know
about, not paper over.

## Proposed changes (final — decided 2026-09-02)

1. **Replace `projectRoot` in `src/index.js` with a `cwd` parameter
   defaulted at the entrypoint. No `--cwd` flag initially, and no new
   `config.js`/abstraction module for this** — a one-line default param is
   sufficient and keeps `projectRoot` easily overridable in tests without
   mutating global `process.cwd()`:

   ```js
   export async function main(cwd = process.cwd()) {
     const projectRoot = path.resolve(cwd);
     // ...
   }
   ```

   Every path currently built from `projectRoot` switches to being derived
   from this — for the vendored-into-`scripts/`-dir use case, that's the
   host project's own root. Document in the README/`docs/development.md`
   that jiraFedrunek must be run from the host project's root (e.g. via an
   npm script `"jira:sync": "jiraFedrunek sync"` run through `npm run`,
   which already sets cwd correctly), not from inside
   `node_modules/jirafedrunek`. Add a `--cwd <dir>` flag later only if a
   real use case demands invoking from outside the target directory — not
   speculatively now.

2. **Fix the Windows `npx` spawn via explicit command resolution, not
   `shell: true`:**

   ```js
   function defaultTransportFactory(mcpUrl) {
     const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
     return new StdioClientTransport({
       command,
       args: ['-y', 'mcp-remote', mcpUrl],
     });
   }
   ```

   `shell: true` is rejected deliberately — it routes the spawned command
   through a shell, which adds argument-parsing/quoting behavior and
   injection surface that isn't needed here since `args` is already a
   controlled array (`mcpUrl` comes from `MCP_URL`/config, not raw user
   input, but there's no reason to add shell interpretation on top of it
   regardless). Explicit `.cmd` resolution is the narrower, safer fix.
   Hardcoded `npx.cmd` is adequate for standard Windows Node installs —
   `PATHEXT` probing, `where`/`which` lookups, or a `cross-spawn` dependency
   are unnecessary complexity to add speculatively. Revisit only if a real
   report surfaces a non-standard-`PATH` Windows environment where this
   fails (e.g. some embedded/portable Node distributions) — evidence first,
   not preemptively.

3. **Add an explicit `files` allowlist to `package.json`** rather than a
   blacklist/`.npmignore` — allowlisting is safer because it can't
   accidentally ship a new directory added later that nobody remembered to
   blacklist:

   ```json
   "files": [
     "src",
     "package.json",
     "README.md",
     "LICENSE"
   ]
   ```

   No separate `"bin"` entry needed — this repo has no `bin/` directory;
   the existing `"bin": { "jiraFedrunek": "src/index.js" }` field points
   into `src/`, already covered by the `"src"` entry above.

4. Confirm `npm install github:<user>/jiraFedrunek` actually resolves and
   installs cleanly with no build step (plain JS, no `prepare`/`prepack`
   script needed today) — verify on a scratch host project, not assumed.

## What does NOT change

- No new dependencies.
- No change to output format, TOML schema, or the Jira/Confluence sync
  logic itself — this is purely "where do config/state files live."
- `mcp-remote`'s own token cache (`~/.mcp-auth/mcp-remote-v1/*_tokens.json`)
  is already machine-global by `mcp-remote`'s own design, untouched by this
  proposal.

## Decision (2026-09-02)

**Adopted**, with these resolutions to the prior open issues:

| Question | Decision |
|---|---|
| `projectRoot` → `process.cwd()` | **Yes** |
| `--cwd` flag | **No, deferred** until a real use case needs it |
| `npx` fix on Windows | **`npx.cmd` resolution**, not `shell: true` |
| `package.json files` | **Explicit allowlist** (`src`, `package.json`, `README.md`, `LICENSE`), not a blacklist |
| `renameSync` on Windows | **Not assumed safe — must be integration-tested**; implement retry/fallback only if testing shows it's needed |
| Install mode targeted | `npm install github:<user>/jiraFedrunek` (see open issue below re: submodule/plain-clone) |
| Public npm registry | Out of scope for this proposal; undecided |

Remaining open issue not blocking implementation, but to be decided before
documenting the install method in the README: whether jiraFedrunek should
also support being vendored as a git submodule or plain `git clone` into
`scripts/` (no `node_modules`/npm involved) — the `projectRoot`/cwd fix is
needed either way, but the `files` allowlist only matters for the
npm-install path.

## Acceptance

- From a scratch "host project" directory (not this repo), run `npm
  install github:<user>/jiraFedrunek`, then `npx jiraFedrunek track
  PROJ-1` and `npx jiraFedrunek sync` — confirm `jiraFedrunek.toml` and
  `sync/` land in the host project's root, not inside
  `node_modules/jirafedrunek`.
- **Mandatory** Windows smoke test of the same flow — confirm `login`/`sync`
  successfully spawn `npx.cmd`/`mcp-remote`, config/state paths resolve
  correctly, and `SyncState.save()`'s `renameSync` succeeds across repeated
  writes (including a write while the destination file is open in another
  process, to specifically probe the `EPERM`/`EBUSY` risk called out
  above). If this fails, a Windows-safe replacement strategy must be
  implemented before claiming Windows support, not just documented as a
  known gap.
- `npm test` still passes unmodified (no test currently exercises
  `projectRoot`, so this should be a pure behavior change with no test
  churn — verify that assumption holds).

## Implementation notes (2026-09-02)

**Correction to Blocking issue #2 — the `npx` Windows fix was unnecessary.**
Before implementing the proposed `npx.cmd` branch, checked how
`StdioClientTransport` (from `@modelcontextprotocol/sdk`, used by
`McpSession.js`) actually spawns its subprocess:
`node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js` calls
`cross-spawn(this._serverParams.command, ...)`, not
`child_process.spawn` directly. `cross-spawn`'s Windows path
(`node_modules/cross-spawn/lib/parse.js`) already detects that `npx` isn't
a `.com`/`.exe`, and transparently re-routes through `cmd.exe` with correct
argument escaping — with `shell: false` passed to the underlying
`child_process.spawn` call, so no shell-injection surface is added. So
`command: 'npx'` in `McpSession.js`'s `defaultTransportFactory` already
works on Windows today; **issue #2 was not implemented** — adding
`npx.cmd` resolution on top would have been redundant. This was confirmed
by reading the installed `cross-spawn` source, not by testing on real
Windows — the underlying claim (cross-spawn handles bare non-`.exe`
commands via `cmd.exe`) is a well-established library behavior, but nobody
here has run this on an actual Windows machine.

**What shipped:**

1. `projectRoot` → `cwd` param, as proposed. `src/index.js`:
   `buildDependencies({ cwd = process.cwd(), yes })` and
   `main(cwd = process.cwd())` are now both exported; every path derived
   from `projectRoot` (`jiraFedrunek.toml`, `sync/.sync-state.json`,
   `sync/{key}.md`, `sync/confluence`, `.env`) is anchored to `cwd`. No
   `--cwd` flag, per the decision.
2. **Not implemented** — see correction above.
3. `package.json` `files` allowlist (`src`, `package.json`, `README.md`,
   `LICENSE`) added exactly as proposed.
4. Verified via `npm pack` + `npm install <tarball>` into a scratch host
   project (no GitHub remote exists for this repo yet, so the literal
   `npm install github:<user>/jiraFedrunek` command from the acceptance
   criteria couldn't be run — a local tarball install is npm-install-shaped
   in the same way and exercises the same `files` allowlist + `node_modules/.bin`
   shim path). `npx jiraFedrunek track PROJ-1` correctly wrote
   `jiraFedrunek.toml` to the host project's root, not into
   `node_modules/jirafedrunek/`.

**Bug found and fixed during that end-to-end check, not anticipated by the
proposal:** npm's `node_modules/.bin/jiraFedrunek` is a **symlink** to
`node_modules/jirafedrunek/src/index.js`. When Node runs a script via a
symlinked entry point, `process.argv[1]` stays the symlink path but
`import.meta.url` resolves to the symlink's realpath — so the entrypoint
guard (`if (import.meta.url === main module) main()`, added to make
`buildDependencies`/`main` importable in tests without triggering a real
run) silently evaluated false and `main()` never ran, with no error and
exit code 0. Fixed with an exported `isMainModule(argv1, moduleUrl)`
helper in `src/index.js` that `fs.realpathSync`s `argv1` before comparing.
Covered by `tests/node/index-project-root.test.js`
(TC-INDEX-ROOT-002/003/004), including a symlink-shaped case reproducing
the npm bin-shim layout.

**Still open / not done here:**

- Windows smoke test — not run (no Windows machine in this environment).
  The `npx` cross-spawn behavior and `SyncState.save()`'s `renameSync`
  atomicity risk are both unverified on real Windows; treat Windows support
  as plausible-but-unconfirmed, not proven.
- The submodule/plain-`git clone` vendoring question is still undecided.
- Public npm registry publishing is still out of scope.
