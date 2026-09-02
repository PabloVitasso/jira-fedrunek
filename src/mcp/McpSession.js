import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import pRetry from 'p-retry';
import { step } from '../log.js';
import { MCP_URL, AUTH_TIMEOUT_S, CALL_TIMEOUT_MS, RETRY_COUNT, RETRY_BASE_MS, RETRY_CAP_MS } from './constants.js';

function defaultClientFactory() {
  return new Client({ name: 'jiraFedrunek', version: '0.1.0' });
}

function defaultTransportFactory(mcpUrl) {
  return new StdioClientTransport({ command: 'npx', args: ['-y', 'mcp-remote', mcpUrl] });
}

// Owns the MCP Client/StdioClientTransport lifecycle (one npx mcp-remote
// subprocess per invocation) shared by JiraClient and ConfluenceClient.
export class McpSession {
  constructor({ mcpUrl = MCP_URL, cloudId, clientFactory = defaultClientFactory, transportFactory = defaultTransportFactory } = {}) {
    this.mcpUrl = mcpUrl;
    this.cloudId = cloudId;
    this.clientFactory = clientFactory;
    this.transportFactory = transportFactory;
    this.client = null;
    this.cleanedUp = false;
    this.cleanupRegistered = false;
  }

  async connect() {
    step('cyan', `[McpSession.connect] step 1: constructing MCP client + transport for ${this.mcpUrl}`);
    this.client = this.clientFactory();
    const transport = this.transportFactory(this.mcpUrl);
    this.#registerCleanup();
    step('blue', `[McpSession.connect] step 2: connecting — browser may open, authorize within ${AUTH_TIMEOUT_S}s`);
    let timeoutId;
    try {
      await Promise.race([
        this.client.connect(transport),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Authorization timed out after ${AUTH_TIMEOUT_S}s. Re-run and authorize promptly.`)),
            AUTH_TIMEOUT_S * 1_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    step('blue', '[McpSession.connect] step 3: connected');
  }

  async callTool(name, args) {
    step('green', `[McpSession.callTool] step 1: calling ${name}`);
    const retryOpts = {
      retries: RETRY_COUNT,
      factor: 1,
      minTimeout: 0,
      maxTimeout: 0,
      onFailedAttempt: async (err) => {
        const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** err.attemptNumber) + Math.random() * 1_000;
        step('yellow', `[McpSession.callTool] step 2: attempt ${err.attemptNumber} failed for ${name} — retrying in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
      },
    };
    const result = await pRetry(
      () => this.client.callTool({ name, arguments: { cloudId: this.cloudId, ...args } }, undefined, { timeout: CALL_TIMEOUT_MS }),
      retryOpts,
    );
    step('green', `[McpSession.callTool] step 3: ${name} returned`);
    return result;
  }

  #registerCleanup() {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;
    process.on('exit', () => this.#cleanup());
    process.on('SIGINT', () => {
      this.#cleanup();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      this.#cleanup();
      process.exit(143);
    });
  }

  #cleanup() {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    // mcp-remote's StreamableHTTPClientTransport throws an uncaught
    // DOMException from close() on an already-closing socket — cosmetic,
    // fires after real work is done, swallow deliberately.
    this.client?.close().catch(() => {});
  }

  async close() {
    step('cyan', '[McpSession.close] step 1: closing MCP client');
    this.#cleanup();
  }
}
