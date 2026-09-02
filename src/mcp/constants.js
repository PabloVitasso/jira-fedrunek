// Atlassian MCP endpoint (Streamable HTTP — SSE deprecated after 2026-06-30).
// v1/mcp, not v2/mcp: still fully functional, no forced-deprecation timeline
// as of this writing — see docs/atlassian-mcp-reference.md#auth.
export const MCP_URL = process.env.MCP_URL ?? 'https://mcp.atlassian.com/v1/mcp';

// Seconds the user has to complete browser OAuth before connect() gives up
export const AUTH_TIMEOUT_S = 90;

// Per-call MCP timeout
export const CALL_TIMEOUT_MS = 60_000;

// Retry policy for MCP calls
export const RETRY_COUNT = 3;
export const RETRY_BASE_MS = 1_000;
export const RETRY_CAP_MS = 15_000;

// Max simultaneous Confluence page fetches
export const CONCURRENCY = 3;
