'use strict';

const SOURCE_REGISTRY = Object.freeze({
  yahoo_sec: {
    label: 'Yahoo Finance + SEC EDGAR',
    endpoint: process.env.YAHOO_EDGAR_MCP_URL || 'https://mcp-yahoo-edgar.vercel.app/mcp',
    health: process.env.YAHOO_EDGAR_HEALTH_URL || 'https://mcp-yahoo-edgar.vercel.app/',
  },
  finnhub: {
    label: 'Finnhub',
    endpoint: process.env.FINNHUB_MCP_URL || 'https://finnhub-mcp.vercel.app/mcp',
    health: process.env.FINNHUB_HEALTH_URL || 'https://finnhub-mcp.vercel.app/health',
  },
  gdelt: {
    label: 'GDELT',
    endpoint: process.env.GDELT_MCP_URL || 'https://gdelt-mcp.vercel.app/mcp',
    health: process.env.GDELT_HEALTH_URL || 'https://gdelt-mcp.vercel.app/health',
  },
});

const DISCOVERY_TTL_MS = 5 * 60_000;
const RESPONSE_LIMIT_BYTES = 2_000_000;
const discoveryCache = new Map();
let requestId = 100;

class UpstreamMcpError extends Error {
  constructor(message, { source, status, details, tool } = {}) {
    super(message);
    this.name = 'UpstreamMcpError';
    this.source = source || null;
    this.status = status || null;
    this.details = details || null;
    this.tool = tool || null;
  }
}

function sourceConfig(source) {
  const config = SOURCE_REGISTRY[source];
  if (!config) throw new TypeError(`source must be one of: ${Object.keys(SOURCE_REGISTRY).join(', ')}.`);
  return config;
}

function normalizeToolName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseEventStream(text, expectedId) {
  const candidates = [];
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (!dataLines.length) continue;
    const joined = dataLines.join('\n');
    if (joined === '[DONE]') continue;
    try { candidates.push(JSON.parse(joined)); } catch {}
  }
  return candidates.find((item) => item && item.id === expectedId) || candidates.at(-1) || null;
}

async function parseResponse(response, expectedId) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > RESPONSE_LIMIT_BYTES) {
    throw new UpstreamMcpError('Upstream MCP response exceeded the safe size limit.', { status: response.status });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > RESPONSE_LIMIT_BYTES) {
    throw new UpstreamMcpError('Upstream MCP response exceeded the safe size limit.', { status: response.status });
  }
  if (!response.ok) {
    throw new UpstreamMcpError(`Upstream MCP returned HTTP ${response.status}.`, {
      status: response.status,
      details: text.replace(/\s+/g, ' ').slice(0, 600),
    });
  }
  const type = response.headers.get('content-type') || '';
  let parsed;
  try {
    parsed = type.includes('text/event-stream') ? parseEventStream(text, expectedId) : JSON.parse(text);
  } catch {
    throw new UpstreamMcpError('Upstream MCP returned an unreadable response.', {
      status: response.status,
      details: text.replace(/\s+/g, ' ').slice(0, 600),
    });
  }
  if (!parsed) throw new UpstreamMcpError('Upstream MCP returned an empty response.', { status: response.status });
  if (parsed.error) {
    throw new UpstreamMcpError(parsed.error.message || 'Upstream MCP JSON-RPC error.', {
      status: response.status,
      details: parsed.error.data || parsed.error,
    });
  }
  return parsed.result;
}

async function rpc(source, method, params = {}, { timeoutMs = 30_000 } = {}) {
  const config = sourceConfig(source);
  const id = ++requestId;
  let response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        'User-Agent': 'Investment-Intelligence-MCP/1.0',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new UpstreamMcpError(`Could not reach ${config.label}: ${error.message}`, { source });
  }
  try {
    return await parseResponse(response, id);
  } catch (error) {
    if (error instanceof UpstreamMcpError) {
      error.source = source;
      throw error;
    }
    throw error;
  }
}

async function listTools(source, { force = false } = {}) {
  const cached = discoveryCache.get(source);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.tools;
  const result = await rpc(source, 'tools/list', {}, { timeoutMs: 25_000 });
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  discoveryCache.set(source, { tools, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return tools;
}

async function resolveTool(source, aliases) {
  const tools = await listTools(source);
  const normalizedAliases = aliases.map(normalizeToolName);
  for (const alias of normalizedAliases) {
    const exact = tools.find((tool) => normalizeToolName(tool.name) === alias);
    if (exact) return exact;
  }
  for (const alias of normalizedAliases) {
    const partial = tools.find((tool) => {
      const name = normalizeToolName(tool.name);
      return name.includes(alias) || alias.includes(name);
    });
    if (partial) return partial;
  }
  throw new UpstreamMcpError(`No matching tool was found in ${source}.`, {
    source,
    details: { requestedAliases: aliases, availableTools: tools.map((tool) => tool.name) },
  });
}

function extractContent(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n');
  let data = result?.structuredContent ?? result?.data;
  if (data === undefined && text) {
    const candidates = [text, text.slice(text.indexOf('{')), text.slice(text.indexOf('['))].filter(Boolean);
    for (const candidate of candidates) {
      try { data = JSON.parse(candidate); break; } catch {}
    }
  }
  return {
    isError: result?.isError === true,
    text: text || null,
    data: data === undefined ? null : data,
    raw: result,
  };
}

async function callTool(source, toolName, args = {}) {
  if (typeof toolName !== 'string' || !toolName.trim() || toolName.length > 160) {
    throw new TypeError('tool must be a non-empty string of 160 characters or fewer.');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('arguments must be an object.');
  const result = await rpc(source, 'tools/call', { name: toolName, arguments: args }, { timeoutMs: 55_000 });
  const extracted = extractContent(result);
  if (extracted.isError) {
    throw new UpstreamMcpError(extracted.text || `Upstream tool ${toolName} returned an error.`, {
      source,
      tool: toolName,
      details: extracted.data,
    });
  }
  return {
    source,
    sourceLabel: sourceConfig(source).label,
    tool: toolName,
    retrievedAt: new Date().toISOString(),
    ...extracted,
  };
}

async function callAlias(source, aliases, args = {}) {
  const tool = await resolveTool(source, aliases);
  return callTool(source, tool.name, args);
}

async function sourceHealth(source) {
  const config = sourceConfig(source);
  const started = Date.now();
  try {
    const tools = await listTools(source, { force: true });
    return {
      source,
      label: config.label,
      status: 'healthy',
      endpoint: config.endpoint,
      latencyMs: Date.now() - started,
      toolCount: tools.length,
      tools: tools.map((tool) => tool.name),
    };
  } catch (error) {
    return {
      source,
      label: config.label,
      status: 'unavailable',
      endpoint: config.endpoint,
      latencyMs: Date.now() - started,
      error: error.message,
    };
  }
}

module.exports = {
  SOURCE_REGISTRY,
  UpstreamMcpError,
  callAlias,
  callTool,
  extractContent,
  listTools,
  normalizeToolName,
  resolveTool,
  sourceConfig,
  sourceHealth,
};
