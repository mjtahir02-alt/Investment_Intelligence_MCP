'use strict';

const { sourceHealth, SOURCE_REGISTRY } = require('../lib/mcp-client');
const { executeTool } = require('../lib/tools');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const deep = req.query?.deep === '1' || parsedUrl.searchParams.get('deep') === '1';
  const smoke = req.query?.smoke === '1' || parsedUrl.searchParams.get('smoke') === '1';
  const base = {
    status: 'ok',
    service: 'investment-intelligence-mcp',
    version: '1.0.0',
    architecture: 'standalone sources + analysis modules + aggregated research',
    mcpEndpoint: '/mcp',
    sources: Object.fromEntries(Object.entries(SOURCE_REGISTRY).map(([key, value]) => [key, value.endpoint])),
    timestamp: new Date().toISOString(),
  };
  if (smoke) {
    const symbol = String(req.query?.symbol || parsedUrl.searchParams.get('symbol') || 'AAPL').toUpperCase().slice(0, 24);
    const cases = [
      ['yahoo_get_quote', { symbol }],
      ['finnhub_get_quote', { symbol }],
      ['gdelt_get_feed_status', {}],
    ];
    const results = await Promise.all(cases.map(async ([name, arguments_]) => {
      const started = Date.now();
      try {
        const value = await executeTool(name, arguments_);
        return { tool: name, status: 'success', latencyMs: Date.now() - started, source: value.source || value.provider || null };
      } catch (error) {
        return { tool: name, status: 'failed', latencyMs: Date.now() - started, error: error.message };
      }
    }));
    const passed = results.filter((item) => item.status === 'success').length;
    res.statusCode = passed ? 200 : 503;
    return res.end(JSON.stringify({ ...base, status: passed === results.length ? 'ok' : passed ? 'partial' : 'degraded', smokeSymbol: symbol, smokeResults: results }));
  }
  if (!deep) { res.statusCode = 200; return res.end(JSON.stringify(base)); }
  const checks = await Promise.all(Object.keys(SOURCE_REGISTRY).map(sourceHealth));
  const healthy = checks.filter((check) => check.status === 'healthy').length;
  res.statusCode = healthy ? 200 : 503;
  res.end(JSON.stringify({ ...base, status: healthy === checks.length ? 'ok' : healthy ? 'partial' : 'degraded', upstream: checks }));
};
