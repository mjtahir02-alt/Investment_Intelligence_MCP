'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseMomentumPayload, analyseNewsPayload, analyseEstimatePayload } = require('../lib/analysis');

test('momentum analysis extracts a price series and computes direction', () => {
  const result = analyseMomentumPayload({ prices: [
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-02', close: 105 },
    { date: '2026-01-03', close: 110 },
  ] });
  assert.equal(result.status, 'complete');
  assert.equal(result.observations, 3);
  assert.ok(Math.abs(result.totalReturnPct - 10) < 1e-9);
  assert.equal(result.trend, 'mixed');
});

test('momentum analysis reports insufficient data', () => {
  assert.equal(analyseMomentumPayload({ price: 10 }).status, 'insufficient_data');
});

test('news analysis counts positive and negative indicators', () => {
  const result = analyseNewsPayload({ articles: [
    { url: 'https://example.com/a', headline: 'Company beats estimates with strong growth', tone: 3 },
    { url: 'https://example.com/b', headline: 'Company faces lawsuit risk', tone: -2 },
  ] });
  assert.equal(result.articleOrLinkCount, 2);
  assert.ok(result.positiveKeywordMentions > 0);
  assert.ok(result.negativeKeywordMentions > 0);
  assert.equal(result.averageReportedTone, 0.5);
});

test('estimate analysis identifies upward revisions', () => {
  const result = analyseEstimatePayload({ estimates: [
    { period: 'Q1', epsEstimate: 1 },
    { period: 'Q2', epsEstimate: 1.2 },
  ] });
  assert.equal(result.status, 'complete');
  assert.equal(result.trends[0].direction, 'up');
});
