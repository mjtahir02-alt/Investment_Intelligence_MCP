'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/mcp');

function request(method, body) {
  return {
    method,
    body,
    headers: {},
    [Symbol.asyncIterator]: async function* () {},
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = value; },
  };
}

test('initialize returns current MCP protocol and server info', async () => {
  const res = response();
  await handler(request('POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }), res);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.result.protocolVersion, '2025-06-18');
  assert.equal(payload.result.serverInfo.name, 'investment-intelligence-mcp');
});

test('tools/list returns modular tools', async () => {
  const res = response();
  await handler(request('POST', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), res);
  const payload = JSON.parse(res.body);
  assert.ok(payload.result.tools.length >= 20);
});

test('GET on MCP endpoint returns method not allowed', async () => {
  const res = response();
  await handler(request('GET'), res);
  assert.equal(res.statusCode, 405);
});
