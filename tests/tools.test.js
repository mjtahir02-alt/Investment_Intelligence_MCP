'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOLS, thesisFromSnapshot } = require('../lib/tools');

test('exposes standalone, analysis and research tool surfaces', () => {
  const names = new Set(TOOLS.map((tool) => tool.name));
  for (const name of [
    'source_call_tool',
    'yahoo_get_quote',
    'sec_get_company_facts',
    'finnhub_get_price_targets',
    'gdelt_search_latest_articles',
    'analyse_price_momentum',
    'research_build_equity_snapshot',
    'research_compare_companies',
  ]) assert.ok(names.has(name), name);
});

test('every tool is read-only and no-auth', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.deepEqual(tool.securitySchemes, [{ type: 'noauth' }]);
  }
});

test('thesis builder does not produce a recommendation', () => {
  const result = thesisFromSnapshot({
    symbol: 'TEST',
    sections: {
      price_momentum: { status: 'success', evidence: { analysis: { trend: 'positive', maxDrawdownPct: -5 } } },
      estimate_revisions: { status: 'success', evidence: { analysis: { trends: [{ direction: 'up' }] } } },
      news: { status: 'success', evidence: { analysis: { signal: 'positive' } } },
    },
  });
  assert.match(result.conclusion, /No buy, sell or hold recommendation/);
  assert.ok(result.bullCaseEvidence.length >= 2);
});

test('period translation produces an ISO date in the past', () => {
  const { subtractPeriod } = require('../lib/tools');
  const value = new Date(subtractPeriod('1y'));
  assert.ok(Number.isFinite(value.getTime()));
  assert.ok(value.getTime() < Date.now());
});

test('company identifier accepts symbol and rejects missing identifiers', () => {
  const { companyIdentifier } = require('../lib/tools');
  assert.equal(companyIdentifier({ symbol: 'AAPL' }), 'AAPL');
  assert.throws(() => companyIdentifier({}), /required/);
});
