'use strict';

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function walk(value, visitor, path = []) {
  visitor(value, path);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visitor, [...path, index]));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => walk(item, visitor, [...path, key]));
}

function collectArrays(value) {
  const arrays = [];
  walk(value, (item, path) => { if (Array.isArray(item) && item.length) arrays.push({ item, path }); });
  return arrays;
}

function firstNumeric(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function firstString(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function extractPriceSeries(payload) {
  const candidates = collectArrays(payload)
    .map(({ item, path }) => {
      const points = item.filter(isObject).map((row) => ({
        time: firstString(row, ['date', 'datetime', 'timestamp', 'time', 'period']),
        close: firstNumeric(row, ['adjClose', 'adjustedClose', 'close', 'regularMarketPrice', 'price']),
      })).filter((point) => point.close !== null);
      return { path, points };
    })
    .filter((candidate) => candidate.points.length >= 2)
    .sort((a, b) => b.points.length - a.points.length);
  return candidates[0]?.points || [];
}

function calculateMaxDrawdown(values) {
  let peak = values[0];
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  return maxDrawdown;
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function analyseMomentumPayload(payload) {
  const series = extractPriceSeries(payload);
  if (series.length < 2) {
    return { status: 'insufficient_data', reason: 'No usable price series was found.', observations: series.length };
  }
  const prices = series.map((point) => point.close);
  const returns = prices.slice(1).map((value, index) => value / prices[index] - 1);
  const simpleReturn = prices.at(-1) / prices[0] - 1;
  const recentWindow = prices.slice(-Math.min(20, prices.length));
  const recentAverage = recentWindow.reduce((sum, value) => sum + value, 0) / recentWindow.length;
  const fullAverage = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  return {
    status: 'complete',
    observations: prices.length,
    firstPrice: prices[0],
    lastPrice: prices.at(-1),
    totalReturnPct: simpleReturn * 100,
    averagePeriodReturnPct: (returns.reduce((sum, value) => sum + value, 0) / returns.length) * 100,
    periodVolatilityPct: standardDeviation(returns) * 100,
    maxDrawdownPct: calculateMaxDrawdown(prices) * 100,
    recentAverage,
    fullAverage,
    trend: prices.at(-1) > recentAverage && recentAverage > fullAverage ? 'positive' : prices.at(-1) < recentAverage && recentAverage < fullAverage ? 'negative' : 'mixed',
    latestTimestamp: series.at(-1).time,
  };
}

function collectText(value) {
  const parts = [];
  walk(value, (item) => { if (typeof item === 'string' && item.length <= 5_000) parts.push(item); });
  return parts.join(' ');
}

function collectNumericByKey(value, regex) {
  const found = [];
  walk(value, (item, path) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) return;
    const key = String(path.at(-1) || '');
    if (regex.test(key)) found.push({ key, value: item, path: path.join('.') });
  });
  return found;
}

function analyseNewsPayload(payloads) {
  const list = Array.isArray(payloads) ? payloads : [payloads];
  const text = list.map(collectText).join(' ').toLowerCase();
  const positiveWords = ['beats', 'beat', 'growth', 'upgrade', 'record', 'strong', 'surge', 'profit', 'approval', 'partnership', 'win'];
  const negativeWords = ['misses', 'miss', 'downgrade', 'decline', 'fall', 'lawsuit', 'probe', 'investigation', 'loss', 'risk', 'recall'];
  const countWord = (word) => (text.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
  const positiveMentions = positiveWords.reduce((sum, word) => sum + countWord(word), 0);
  const negativeMentions = negativeWords.reduce((sum, word) => sum + countWord(word), 0);
  const tones = list.flatMap((payload) => collectNumericByKey(payload, /(tone|sentiment|score)$/i).map((item) => item.value)).filter((value) => Math.abs(value) <= 100);
  const averageTone = tones.length ? tones.reduce((sum, value) => sum + value, 0) / tones.length : null;
  const urls = new Set();
  walk(list, (item) => { if (typeof item === 'string' && /^https?:\/\//i.test(item)) urls.add(item); });
  return {
    status: text ? 'complete' : 'insufficient_data',
    articleOrLinkCount: urls.size,
    positiveKeywordMentions: positiveMentions,
    negativeKeywordMentions: negativeMentions,
    keywordBalance: positiveMentions - negativeMentions,
    averageReportedTone: averageTone,
    signal: averageTone !== null ? (averageTone > 1 ? 'positive' : averageTone < -1 ? 'negative' : 'mixed') : positiveMentions > negativeMentions ? 'positive' : negativeMentions > positiveMentions ? 'negative' : 'mixed',
    caveat: 'Keyword and tone signals are descriptive media indicators, not verified facts or investment recommendations.',
  };
}

function findEstimateRows(payload) {
  const candidates = collectArrays(payload)
    .map(({ item, path }) => {
      const rows = item.filter(isObject).map((row) => {
        const period = firstString(row, ['period', 'date', 'year', 'quarter', 'fiscalPeriod']);
        const estimateEntries = Object.entries(row).filter(([key, value]) => /(estimate|eps|revenue|sales|consensus|mean|median|avg)/i.test(key) && Number.isFinite(Number(value)));
        return { period, values: Object.fromEntries(estimateEntries.map(([key, value]) => [key, Number(value)])) };
      }).filter((row) => Object.keys(row.values).length);
      return { rows, path };
    })
    .filter((candidate) => candidate.rows.length)
    .sort((a, b) => b.rows.length - a.rows.length);
  return candidates[0]?.rows || [];
}

function analyseEstimatePayload(payload) {
  const rows = findEstimateRows(payload);
  if (!rows.length) return { status: 'insufficient_data', reason: 'No estimate series was found.' };
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row.values)))];
  const trends = keys.map((key) => {
    const points = rows.map((row) => ({ period: row.period, value: row.values[key] })).filter((point) => Number.isFinite(point.value));
    if (points.length < 2) return { metric: key, points: points.length, direction: 'unknown', latest: points.at(-1)?.value ?? null };
    const change = points.at(-1).value - points[0].value;
    return {
      metric: key,
      points: points.length,
      earliest: points[0].value,
      latest: points.at(-1).value,
      absoluteChange: change,
      percentageChange: points[0].value !== 0 ? (change / Math.abs(points[0].value)) * 100 : null,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    };
  });
  return { status: 'complete', periods: rows.length, trends };
}

function compact(value, { depth = 0, maxDepth = 5, maxArray = 20, maxKeys = 40 } = {}) {
  if (depth > maxDepth) return '[truncated]';
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, maxArray).map((item) => compact(item, { depth: depth + 1, maxDepth, maxArray, maxKeys }));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).slice(0, maxKeys).map(([key, item]) => [key, compact(item, { depth: depth + 1, maxDepth, maxArray, maxKeys })]));
  return value;
}

module.exports = {
  analyseEstimatePayload,
  analyseMomentumPayload,
  analyseNewsPayload,
  collectNumericByKey,
  compact,
  extractPriceSeries,
  walk,
};
