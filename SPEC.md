# Investment Intelligence MCP Specification

## Purpose
A modular, read-only investment research MCP that exposes each data source independently and also provides normalized analysis and cross-source research workflows.

## Existing upstream MCPs
- Yahoo + SEC EDGAR: `https://mcp-yahoo-edgar.vercel.app/mcp`
- Finnhub: `https://finnhub-mcp.vercel.app/mcp`
- GDELT: `https://gdelt-mcp.vercel.app/mcp`

## Design principles
1. Every upstream source is independently queryable.
2. Curated source wrappers never silently query another provider.
3. Cross-source tools explicitly disclose which sources succeeded, failed, or were unavailable.
4. Missing data is never converted into a neutral or zero score.
5. Every response includes source, tool, timestamp, status, and evidence.
6. Upstream MCP tool names are discovered dynamically and matched through aliases.
7. The server remains useful when one source is unavailable.
8. All tools are read-only and declare no-auth security metadata.

## Tool surfaces

### Generic source access
- `source_list_tools`
- `source_call_tool`
- `source_health`

### Yahoo / market data
- `yahoo_search_symbols`
- `yahoo_get_quote`
- `yahoo_get_price_history`

### SEC / EDGAR
- `sec_search_companies`
- `sec_list_filings`
- `sec_get_filing`
- `sec_get_company_facts`

### Finnhub
- `finnhub_get_company_profile`
- `finnhub_get_quote`
- `finnhub_get_analyst_consensus`
- `finnhub_get_price_targets`
- `finnhub_get_earnings_estimates`
- `finnhub_get_company_news`

### GDELT
- `gdelt_get_feed_status`
- `gdelt_search_latest_articles`
- `gdelt_get_latest_events`
- `gdelt_get_entity_trends`

### Analysis modules
- `analyse_price_momentum`
- `analyse_news_signals`
- `analyse_estimate_revisions`

### Aggregated research
- `research_build_equity_snapshot`
- `research_compare_companies`
- `research_generate_investment_thesis`

## Deployment
- Stateless MCP Streamable HTTP at `/mcp` and `/api/mcp`.
- Health at `/health` and `/api/health`.
- Vercel serverless deployment.
- No secrets required by the aggregator itself; upstream servers retain their own configuration.

## First-release boundaries
- No trading execution.
- No personalised investment recommendation or guaranteed-return language.
- No scoring of missing data.
- FRED, CFTC, insider trading and ETF holdings are future adapters.
