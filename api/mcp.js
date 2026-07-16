'use strict';

const { TOOLS, executeTool } = require('../lib/tools');

const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26']);
const MAX_REQUEST_BYTES = 1_000_000;
const MAX_RESPONSE_CHARS = 700_000;

function setHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization');
}

function send(res, status, body) {
  setHeaders(res);
  res.statusCode = status;
  let text = JSON.stringify(body);
  if (text.length > MAX_RESPONSE_CHARS) {
    text = JSON.stringify({
      jsonrpc: '2.0',
      id: body?.id ?? null,
      error: { code: -32001, message: 'The result exceeded the safe response size. Use a narrower query or a standalone source tool.' },
    });
  }
  res.end(text);
}

function toolResult(value) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: value, isError: false };
}

function errorResult(error) {
  const value = { error: error.message, source: error.source || undefined, tool: error.tool || undefined, details: error.details || undefined };
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: true };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  }
  if (!text) return {};
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setHeaders(res); res.statusCode = 204; return res.end();
  }
  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST for MCP Streamable HTTP.' } });
  }
  if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed.' } });

  let request;
  try { request = await readBody(req); }
  catch (error) { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } }); }

  const id = request.id ?? null;
  try {
    switch (request.method) {
      case 'initialize': {
        const requested = request.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : '2025-06-18';
        return send(res, 200, { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'investment-intelligence-mcp', title: 'Modular Investment Intelligence', version: '1.0.0' }, instructions: 'Use source-prefixed tools for standalone data. Use analysis tools for one module and research tools only when cross-source aggregation is desired.' } });
      }
      case 'notifications/initialized':
        res.statusCode = 202; return res.end();
      case 'ping':
        return send(res, 200, { jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        return send(res, 200, { jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call': {
        const name = request.params?.name;
        const args = request.params?.arguments || {};
        try {
          const result = await executeTool(name, args);
          return send(res, 200, { jsonrpc: '2.0', id, result: toolResult(result) });
        } catch (error) {
          return send(res, 200, { jsonrpc: '2.0', id, result: errorResult(error) });
        }
      }
      default:
        return send(res, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${request.method}` } });
    }
  } catch (error) {
    return send(res, 500, { jsonrpc: '2.0', id, error: { code: -32603, message: error.message } });
  }
};
