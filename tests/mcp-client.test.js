'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeToolName, extractContent } = require('../lib/mcp-client');

test('normalizes hyphens and underscores for alias matching', () => {
  assert.equal(normalizeToolName('get-market_quotes'), 'getmarketquotes');
});

test('extracts structured content from MCP result', () => {
  const result = extractContent({ structuredContent: { value: 1 }, content: [{ type: 'text', text: 'ok' }] });
  assert.deepEqual(result.data, { value: 1 });
  assert.equal(result.text, 'ok');
});

test('parses JSON text when structured content is absent', () => {
  const result = extractContent({ content: [{ type: 'text', text: '{"value":2}' }] });
  assert.deepEqual(result.data, { value: 2 });
});
