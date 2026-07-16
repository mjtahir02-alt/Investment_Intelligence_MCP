'use strict';

const { callAlias, callTool, listTools, sourceHealth, SOURCE_REGISTRY } = require('./mcp-client');
const { analyseEstimatePayload, analyseMomentumPayload, analyseNewsPayload, compact } = require('./analysis');

const SECURITY = [{ type: 'noauth' }];
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function schema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const SYMBOL = { type: 'string', minLength: 1, maxLength: 24, description: 'Ticker symbol, for example NVDA.' };
const COMMON_HISTORY = {
  symbol: SYMBOL,
  period: { type: 'string', description: 'Provider-specific range such as 1mo, 6mo, 1y or 5y.' },
  range: { type: 'string', description: 'Alternative provider-specific range.' },
  interval: { type: 'string', description: 'Price interval such as 1d or 1wk.' },
  start: { type: 'string', description: 'Optional start date.' },
  end: { type: 'string', description: 'Optional end date.' },
};

function tool(name, description, inputSchema) {
  return { name, description, inputSchema, securitySchemes: SECURITY, annotations: READ_ONLY };
}

const TOOLS = [
  tool('source_list_tools', 'List tools exposed by one underlying MCP without calling any other source.', schema({ source: { type: 'string', enum: Object.keys(SOURCE_REGISTRY) } }, ['source'])),
  tool('source_call_tool', 'Call one exact tool on one underlying MCP. This is the universal standalone escape hatch.', schema({ source: { type: 'string', enum: Object.keys(SOURCE_REGISTRY) }, tool: { type: 'string', minLength: 1, maxLength: 160 }, arguments: { type: 'object', additionalProperties: true, default: {} } }, ['source', 'tool'])),
  tool('source_health', 'Check one source or all configured upstream MCPs using MCP tool discovery.', schema({ source: { type: 'string', enum: [...Object.keys(SOURCE_REGISTRY), 'all'], default: 'all' } })),

  tool('yahoo_search_symbols', 'Search Yahoo Finance symbols only.', schema({ query: { type: 'string', minLength: 1, maxLength: 120 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['query'])),
  tool('yahoo_get_quote', 'Get a Yahoo Finance market quote only.', schema({ symbol: SYMBOL }, ['symbol'])),
  tool('yahoo_get_price_history', 'Get Yahoo Finance historical prices only.', schema(COMMON_HISTORY, ['symbol'])),
  tool('sec_search_companies', 'Search SEC company identifiers only.', schema({ query: { type: 'string', minLength: 1, maxLength: 160 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['query'])),
  tool('sec_list_filings', 'List SEC filings for a company only.', schema({ identifier: { type: 'string', maxLength: 180, description: 'Ticker, CIK, or company name.' }, symbol: SYMBOL, cik: { type: 'string', maxLength: 16 }, forms: { type: 'array', items: { type: 'string' }, maxItems: 20 }, form: { type: 'string', maxLength: 20 }, startDate: { type: 'string' }, endDate: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } })),
  tool('sec_get_filing', 'Retrieve bounded text or targeted excerpts from one recent SEC filing.', schema({ identifier: { type: 'string', maxLength: 180, description: 'Ticker, CIK, or company name.' }, symbol: SYMBOL, cik: { type: 'string', maxLength: 16 }, accessionNumber: { type: 'string', maxLength: 40 }, searchTerm: { type: 'string', maxLength: 200 }, startCharacter: { type: 'integer', minimum: 0 }, maxCharacters: { type: 'integer', minimum: 1000, maximum: 50000 } }, ['accessionNumber'])),
  tool('sec_get_company_facts', 'Retrieve standardized SEC XBRL company facts only.', schema({ identifier: { type: 'string', maxLength: 180, description: 'Ticker, CIK, or company name.' }, symbol: SYMBOL, cik: { type: 'string', maxLength: 16 }, taxonomy: { type: 'string', default: 'us-gaap' }, concepts: { type: 'array', items: { type: 'string' }, maxItems: 30 }, forms: { type: 'array', items: { type: 'string' }, maxItems: 20 }, limitPerConcept: { type: 'integer', minimum: 1, maximum: 50 } })),

  tool('finnhub_get_company_profile', 'Get a Finnhub company profile only.', schema({ symbol: SYMBOL }, ['symbol'])),
  tool('finnhub_get_quote', 'Get a Finnhub stock quote only.', schema({ symbol: SYMBOL }, ['symbol'])),
  tool('finnhub_get_analyst_consensus', 'Get Finnhub recommendation or analyst consensus only.', schema({ symbol: SYMBOL }, ['symbol'])),
  tool('finnhub_get_price_targets', 'Get Finnhub analyst price targets only.', schema({ symbol: SYMBOL }, ['symbol'])),
  tool('finnhub_get_earnings_estimates', 'Get Finnhub earnings estimates only.', schema({ symbol: SYMBOL, freq: { type: 'string', enum: ['annual', 'quarterly'] } }, ['symbol'])),
  tool('finnhub_get_company_news', 'Get Finnhub company news only.', schema({ symbol: SYMBOL, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['symbol'])),

  tool('gdelt_get_feed_status', 'Get GDELT raw-feed status only.', schema({})),
  tool('gdelt_search_latest_articles', 'Search the latest GDELT article metadata only.', schema({ query: { type: 'string', maxLength: 240 }, entity: { type: 'string', maxLength: 160 }, theme: { type: 'string', maxLength: 160 }, location: { type: 'string', maxLength: 160 }, domain: { type: 'string', maxLength: 253 }, batches: { type: 'integer', minimum: 1, maximum: 4 }, limit: { type: 'integer', minimum: 1, maximum: 100 } })),
  tool('gdelt_get_latest_events', 'Get latest GDELT coded events only.', schema({ actor: { type: 'string', maxLength: 160 }, country: { type: 'string', maxLength: 8 }, rootCode: { type: 'string', maxLength: 8 }, batches: { type: 'integer', minimum: 1, maximum: 4 }, limit: { type: 'integer', minimum: 1, maximum: 100 } })),
  tool('gdelt_get_entity_trends', 'Get recent GDELT entity trends only.', schema({ entityType: { type: 'string', enum: ['themes', 'persons', 'organizations', 'locations', 'sources'] }, query: { type: 'string', maxLength: 160 }, batches: { type: 'integer', minimum: 1, maximum: 4 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['entityType'])),

  tool('analyse_price_momentum', 'Analyse price momentum using a selected provider. Returns computed metrics and the source evidence.', schema({ symbol: SYMBOL, provider: { type: 'string', enum: ['yahoo'], default: 'yahoo' }, period: { type: 'string', default: '1y' }, interval: { type: 'string', default: '1d' } }, ['symbol'])),
  tool('analyse_news_signals', 'Analyse recent news signals from Finnhub, GDELT or both. Missing sources are reported, not scored as neutral.', schema({ symbol: SYMBOL, companyName: { type: 'string', maxLength: 160 }, provider: { type: 'string', enum: ['finnhub', 'gdelt', 'all'], default: 'all' }, from: { type: 'string' }, to: { type: 'string' }, batches: { type: 'integer', minimum: 1, maximum: 4, default: 2 } }, ['symbol'])),
  tool('analyse_estimate_revisions', 'Analyse Finnhub estimate direction while preserving the underlying evidence.', schema({ symbol: SYMBOL, freq: { type: 'string', enum: ['annual', 'quarterly'], default: 'quarterly' } }, ['symbol'])),

  tool('research_build_equity_snapshot', 'Build a modular equity snapshot. Modules and sources are explicit; each source reports success or failure independently.', schema({ symbol: SYMBOL, companyName: { type: 'string', maxLength: 160 }, modules: { type: 'array', items: { type: 'string', enum: ['quote', 'profile', 'price_momentum', 'sec_facts', 'analyst_consensus', 'price_targets', 'estimate_revisions', 'news'] }, default: ['quote', 'profile', 'price_momentum', 'sec_facts', 'analyst_consensus', 'price_targets', 'estimate_revisions', 'news'] }, newsProvider: { type: 'string', enum: ['finnhub', 'gdelt', 'all'], default: 'all' }, period: { type: 'string', default: '1y' }, interval: { type: 'string', default: '1d' } }, ['symbol'])),
  tool('research_compare_companies', 'Compare up to five companies using the same selected modules and disclose missing source data.', schema({ symbols: { type: 'array', minItems: 2, maxItems: 5, items: SYMBOL }, modules: { type: 'array', items: { type: 'string', enum: ['quote', 'profile', 'price_momentum', 'sec_facts', 'analyst_consensus', 'price_targets', 'estimate_revisions', 'news'] } }, newsProvider: { type: 'string', enum: ['finnhub', 'gdelt', 'all'], default: 'all' }, period: { type: 'string', default: '1y' }, interval: { type: 'string', default: '1d' } }, ['symbols'])),
  tool('research_generate_investment_thesis', 'Generate an evidence frame with bull signals, risk signals, unknowns and invalidation checks. It is research support, not a personalised recommendation.', schema({ symbol: SYMBOL, companyName: { type: 'string', maxLength: 160 }, newsProvider: { type: 'string', enum: ['finnhub', 'gdelt', 'all'], default: 'all' }, period: { type: 'string', default: '1y' } }, ['symbol'])),
];

const ALIASES = {
  yahoo_search_symbols: ['search-market-symbols', 'search_market_symbols', 'search_symbols', 'symbol_search'],
  yahoo_get_quote: ['get-market-quotes', 'get_market_quotes', 'stock_quote', 'get_quote', 'quote'],
  yahoo_get_price_history: ['get-price-history', 'get_price_history', 'price_history', 'historical_prices'],
  sec_search_companies: ['search-sec-companies', 'search_sec_companies', 'sec_search_companies'],
  sec_list_filings: ['list-sec-filings', 'list_sec_filings', 'sec_list_filings'],
  sec_get_filing: ['get-sec-filing', 'get_sec_filing', 'sec_get_filing'],
  sec_get_company_facts: ['get-sec-company-facts', 'get_sec_company_facts', 'sec_get_company_facts', 'company_facts'],
  finnhub_get_company_profile: ['company_profile', 'get_company_profile'],
  finnhub_get_quote: ['stock_quote', 'get_quote', 'quote'],
  finnhub_get_analyst_consensus: ['get_analyst_consensus', 'analyst_consensus', 'recommendation_trends'],
  finnhub_get_price_targets: ['get_price_targets', 'price_targets'],
  finnhub_get_earnings_estimates: ['get_earnings_estimates', 'earnings_estimates'],
  finnhub_get_company_news: ['get_company_news', 'company_news'],
  gdelt_get_feed_status: ['get_feed_status'],
  gdelt_search_latest_articles: ['search_latest_articles'],
  gdelt_get_latest_events: ['get_latest_events'],
  gdelt_get_entity_trends: ['get_entity_trends'],
};

function argsWithoutUndefined(args) {
  return Object.fromEntries(Object.entries(args || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

async function direct(name, source, args) {
  return callAlias(source, ALIASES[name], argsWithoutUndefined(args));
}

function subtractPeriod(period) {
  const now = new Date();
  const match = /^(\d+)(d|wk|mo|y)$/i.exec(String(period || '1y').trim());
  if (!match) return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'd') now.setUTCDate(now.getUTCDate() - amount);
  else if (unit === 'wk') now.setUTCDate(now.getUTCDate() - amount * 7);
  else if (unit === 'mo') now.setUTCMonth(now.getUTCMonth() - amount);
  else now.setUTCFullYear(now.getUTCFullYear() - amount);
  return now.toISOString();
}

function companyIdentifier(args) {
  const value = args.identifier || args.symbol || args.cik;
  if (!value) throw new TypeError('identifier, symbol, or cik is required.');
  return String(value);
}

async function yahooQuote(args) {
  return callAlias('yahoo_sec', ALIASES.yahoo_get_quote, { symbols: [String(args.symbol).toUpperCase()] });
}

async function yahooHistory(args) {
  const period1 = args.period1 || args.start || subtractPeriod(args.period || args.range || '1y');
  const period2 = args.period2 || args.end || new Date().toISOString();
  return callAlias('yahoo_sec', ALIASES.yahoo_get_price_history, argsWithoutUndefined({
    symbol: String(args.symbol).toUpperCase(),
    period1,
    period2,
    interval: args.interval || '1d',
    maxPoints: args.maxPoints || 500,
  }));
}

async function secListFilings(args) {
  return callAlias('yahoo_sec', ALIASES.sec_list_filings, argsWithoutUndefined({
    identifier: companyIdentifier(args),
    forms: args.forms || (args.form ? [args.form] : undefined),
    startDate: args.startDate,
    endDate: args.endDate,
    limit: args.limit,
  }));
}

async function secGetFiling(args) {
  return callAlias('yahoo_sec', ALIASES.sec_get_filing, argsWithoutUndefined({
    identifier: companyIdentifier(args),
    accessionNumber: args.accessionNumber,
    searchTerm: args.searchTerm,
    startCharacter: args.startCharacter,
    maxCharacters: args.maxCharacters,
  }));
}

async function secGetFacts(args) {
  return callAlias('yahoo_sec', ALIASES.sec_get_company_facts, argsWithoutUndefined({
    identifier: companyIdentifier(args),
    taxonomy: args.taxonomy,
    concepts: args.concepts,
    forms: args.forms,
    limitPerConcept: args.limitPerConcept,
  }));
}

async function safe(label, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return { label, status: 'success', latencyMs: Date.now() - started, evidence: compact(value) };
  } catch (error) {
    return { label, status: 'failed', latencyMs: Date.now() - started, error: error.message, details: compact(error.details) };
  }
}

async function priceMomentum(args) {
  const evidence = await yahooHistory({ symbol: args.symbol, period: args.period || '1y', interval: args.interval || '1d', maxPoints: 500 });
  return { symbol: args.symbol, provider: 'yahoo_sec', analysis: analyseMomentumPayload(evidence.data ?? evidence.text ?? evidence.raw), evidence: compact(evidence) };
}

async function newsSignals(args) {
  const provider = args.provider || 'all';
  const calls = [];
  if (provider === 'finnhub' || provider === 'all') calls.push(safe('finnhub_news', () => direct('finnhub_get_company_news', 'finnhub', argsWithoutUndefined({ symbol: args.symbol, from: args.from, to: args.to, limit: 50 }))));
  if (provider === 'gdelt' || provider === 'all') calls.push(safe('gdelt_news', () => direct('gdelt_search_latest_articles', 'gdelt', argsWithoutUndefined({ query: args.companyName || args.symbol, entity: args.companyName, batches: args.batches || 2, limit: 50 }))));
  const results = await Promise.all(calls);
  const successfulPayloads = results.filter((result) => result.status === 'success').map((result) => result.evidence);
  return { symbol: args.symbol, provider, analysis: analyseNewsPayload(successfulPayloads), sources: results };
}

async function estimateRevisions(args) {
  const evidence = await direct('finnhub_get_earnings_estimates', 'finnhub', { symbol: args.symbol, freq: args.freq || 'quarterly' });
  return { symbol: args.symbol, provider: 'finnhub', analysis: analyseEstimatePayload(evidence.data ?? evidence.text ?? evidence.raw), evidence: compact(evidence) };
}

async function buildSnapshot(args) {
  const modules = new Set(args.modules?.length ? args.modules : ['quote', 'profile', 'price_momentum', 'sec_facts', 'analyst_consensus', 'price_targets', 'estimate_revisions', 'news']);
  const tasks = [];
  if (modules.has('quote')) tasks.push(safe('quote', async () => {
    const yahoo = await safe('yahoo_quote', () => yahooQuote({ symbol: args.symbol }));
    if (yahoo.status === 'success') return yahoo;
    return safe('finnhub_quote', () => direct('finnhub_get_quote', 'finnhub', { symbol: args.symbol }));
  }));
  if (modules.has('profile')) tasks.push(safe('profile', () => direct('finnhub_get_company_profile', 'finnhub', { symbol: args.symbol })));
  if (modules.has('price_momentum')) tasks.push(safe('price_momentum', () => priceMomentum(args)));
  if (modules.has('sec_facts')) tasks.push(safe('sec_facts', () => secGetFacts({ symbol: args.symbol })));
  if (modules.has('analyst_consensus')) tasks.push(safe('analyst_consensus', () => direct('finnhub_get_analyst_consensus', 'finnhub', { symbol: args.symbol })));
  if (modules.has('price_targets')) tasks.push(safe('price_targets', () => direct('finnhub_get_price_targets', 'finnhub', { symbol: args.symbol })));
  if (modules.has('estimate_revisions')) tasks.push(safe('estimate_revisions', () => estimateRevisions({ symbol: args.symbol, freq: 'quarterly' })));
  if (modules.has('news')) tasks.push(safe('news', () => newsSignals({ symbol: args.symbol, companyName: args.companyName, provider: args.newsProvider || 'all', batches: 2 })));
  const sections = await Promise.all(tasks);
  const successfulSections = sections.filter((section) => section.status === 'success').length;
  return {
    symbol: args.symbol.toUpperCase(),
    generatedAt: new Date().toISOString(),
    status: successfulSections === sections.length ? 'complete' : successfulSections ? 'partial' : 'failed',
    requestedModules: [...modules],
    sections: Object.fromEntries(sections.map((section) => [section.label, section])),
    disclosure: 'This is an evidence-organising research output, not personalised investment advice. Verify material facts at the original source.',
  };
}

function thesisFromSnapshot(snapshot) {
  const bull = [];
  const risk = [];
  const unknowns = [];
  const momentum = snapshot.sections?.price_momentum;
  if (momentum?.status === 'success') {
    const analysis = momentum.evidence?.analysis || momentum.evidence?.evidence?.analysis;
    if (analysis?.trend === 'positive') bull.push({ finding: 'Price trend is positive over the selected window.', evidence: analysis });
    else if (analysis?.trend === 'negative') risk.push({ finding: 'Price trend is negative over the selected window.', evidence: analysis });
    if (typeof analysis?.maxDrawdownPct === 'number' && analysis.maxDrawdownPct < -20) risk.push({ finding: 'The selected period includes a drawdown greater than 20%.', evidence: { maxDrawdownPct: analysis.maxDrawdownPct } });
  } else unknowns.push('Price momentum was unavailable.');
  const estimates = snapshot.sections?.estimate_revisions;
  if (estimates?.status === 'success') {
    const trends = estimates.evidence?.analysis?.trends || [];
    const up = trends.filter((trend) => trend.direction === 'up').length;
    const down = trends.filter((trend) => trend.direction === 'down').length;
    if (up > down) bull.push({ finding: 'More extracted estimate series are rising than falling.', evidence: trends });
    else if (down > up) risk.push({ finding: 'More extracted estimate series are falling than rising.', evidence: trends });
  } else unknowns.push('Estimate revisions were unavailable.');
  const news = snapshot.sections?.news;
  if (news?.status === 'success') {
    const signal = news.evidence?.analysis?.signal;
    if (signal === 'positive') bull.push({ finding: 'Recent media signals skew positive.', evidence: news.evidence.analysis });
    else if (signal === 'negative') risk.push({ finding: 'Recent media signals skew negative.', evidence: news.evidence.analysis });
  } else unknowns.push('Recent news signals were unavailable.');
  for (const [name, section] of Object.entries(snapshot.sections || {})) if (section.status === 'failed') unknowns.push(`${name}: ${section.error}`);
  return {
    symbol: snapshot.symbol,
    generatedAt: new Date().toISOString(),
    bullCaseEvidence: bull,
    riskEvidence: risk,
    unknowns: [...new Set(unknowns)],
    invalidationChecks: [
      'Compare the next reported results with current revenue, margin and cash-flow expectations.',
      'Check whether analyst estimates continue moving in the same direction.',
      'Review new SEC filings for dilution, liquidity, litigation and material contract changes.',
      'Reassess the thesis if price action and operating fundamentals diverge materially.',
    ],
    conclusion: 'No buy, sell or hold recommendation is produced. The output organises evidence for further research.',
    snapshot,
  };
}

async function executeTool(name, args = {}) {
  switch (name) {
    case 'source_list_tools': return { source: args.source, tools: await listTools(args.source), retrievedAt: new Date().toISOString() };
    case 'source_call_tool': return callTool(args.source, args.tool, args.arguments || {});
    case 'source_health': {
      const sources = args.source && args.source !== 'all' ? [args.source] : Object.keys(SOURCE_REGISTRY);
      const results = await Promise.all(sources.map(sourceHealth));
      return { status: results.every((item) => item.status === 'healthy') ? 'healthy' : results.some((item) => item.status === 'healthy') ? 'partial' : 'unavailable', sources: results };
    }
    case 'yahoo_search_symbols': return direct(name, 'yahoo_sec', args);
    case 'yahoo_get_quote': return yahooQuote(args);
    case 'yahoo_get_price_history': return yahooHistory(args);
    case 'sec_search_companies': return direct(name, 'yahoo_sec', args);
    case 'sec_list_filings': return secListFilings(args);
    case 'sec_get_filing': return secGetFiling(args);
    case 'sec_get_company_facts': return secGetFacts(args);
    case 'finnhub_get_company_profile': return direct(name, 'finnhub', args);
    case 'finnhub_get_quote': return direct(name, 'finnhub', args);
    case 'finnhub_get_analyst_consensus': return direct(name, 'finnhub', args);
    case 'finnhub_get_price_targets': return direct(name, 'finnhub', args);
    case 'finnhub_get_earnings_estimates': return direct(name, 'finnhub', args);
    case 'finnhub_get_company_news': return direct(name, 'finnhub', args);
    case 'gdelt_get_feed_status': return direct(name, 'gdelt', args);
    case 'gdelt_search_latest_articles': return direct(name, 'gdelt', args);
    case 'gdelt_get_latest_events': return direct(name, 'gdelt', args);
    case 'gdelt_get_entity_trends': return direct(name, 'gdelt', args);
    case 'analyse_price_momentum': return priceMomentum(args);
    case 'analyse_news_signals': return newsSignals(args);
    case 'analyse_estimate_revisions': return estimateRevisions(args);
    case 'research_build_equity_snapshot': return buildSnapshot(args);
    case 'research_compare_companies': {
      const results = [];
      for (const symbol of args.symbols) results.push(await buildSnapshot({ ...args, symbol }));
      return { generatedAt: new Date().toISOString(), symbols: args.symbols, results };
    }
    case 'research_generate_investment_thesis': return thesisFromSnapshot(await buildSnapshot({ ...args, modules: ['quote', 'profile', 'price_momentum', 'sec_facts', 'analyst_consensus', 'price_targets', 'estimate_revisions', 'news'] }));
    default: throw new TypeError(`Unknown tool: ${name}`);
  }
}

module.exports = { ALIASES, TOOLS, executeTool, buildSnapshot, thesisFromSnapshot, subtractPeriod, companyIdentifier };
