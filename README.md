# Investment Intelligence MCP

A modular, read-only investment research MCP that preserves standalone access to each source while adding reusable analysis and cross-source workflows.

## Architecture

1. **Standalone sources**: Yahoo/SEC EDGAR, Finnhub and GDELT can be queried independently.
2. **Analysis modules**: price momentum, news signals and estimate revisions.
3. **Aggregated research**: equity snapshots, company comparisons and evidence-framed theses.

The aggregator dynamically discovers tool names from upstream MCPs and maps aliases, so the individual source servers remain the systems of record.

## Endpoints

- MCP: `/mcp` or `/api/mcp`
- Health: `/health` or `/api/health`
- Deep health: `/health?deep=1`

## Configuration

No secret is required by the aggregator. Optional endpoint overrides:

```text
YAHOO_EDGAR_MCP_URL=
FINNHUB_MCP_URL=
GDELT_MCP_URL=
```

The upstream Finnhub MCP must have its own `FINNHUB_API_KEY` configured to return Finnhub data.

## Important limitations

- Research support only; no trading execution.
- Missing sources are shown as failed or unavailable, never scored as zero.
- Automated news tone and keyword indicators are descriptive signals, not verified facts.
- Always verify material conclusions in the original filing, market-data provider or news source.
