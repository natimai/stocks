# Production Runbook

## Services and Owners

- Frontend (`Next.js`): Web owner
- API (`FastAPI`): Backend owner
- Auth + Data (`Firebase Auth` / `Firestore`): Platform owner
- External providers:
  - Market data: Yahoo/yfinance
  - LLM: Gemini

## Incident Triage

1. Identify impacted flow:
   - Home search
   - Stock dashboard (chart/analysis/chat)
   - Portfolio
   - Admin
2. Correlate logs by `requestId` from browser/network response header.
3. Classify failure:
   - `4xx` (auth/config/rate limit)
   - `5xx` (server/provider/runtime)
   - client runtime (captured by `/api/client-errors`)

## Common Failure Modes

### `INVALID_TICKER` / contract errors

- Confirm request payload and route params.
- Validate frontend guard normalization in stock/chart consumers.

### Provider timeout or degradation

- Check structured logs for:
  - `SEARCH_PROVIDER_FAILED`
  - `QUICK_STATS_PROVIDER_FAILED`
  - `CHART_PROVIDER_FAILED`
- Verify cache fallback behavior and stale-while-revalidate responses.

### LLM failures

- Check:
  - `AGENT_CHAT_FAILED`
  - `GEMINI_KEY_MISSING`
- Verify secret presence and provider status.

### Auth and admin access issues

- Validate Firebase ID token and expiration.
- For admin:
  - verify role claim (`ADMIN_CLAIM_KEY`) or email allowlist (`ADMIN_EMAILS`).

## Emergency Actions

1. Contain
   - Disable expensive features via env flags/limits.
   - Lower retry pressure for provider outages.
2. Recover
   - Redeploy last known-good revision.
   - Flush in-memory pressure by restarting affected instance.
3. Verify
   - Health checks pass.
   - Key paths `/`, `/api/search`, `/api/chart`, `/api/quick-stats` return 200.
   - Error rates return below SLO thresholds.

## Rollback Checklist

- Keep previous build artifact/revision available.
- Revert deployment to previous revision.
- Confirm:
  - 200 on smoke paths
  - no spike in `/api/client-errors`
  - p95 and 5xx trending back to baseline

## Post-Incident

- Create timeline with exact timestamps (UTC + local).
- Record root cause, blast radius, and permanent fixes.
- Add/update test coverage (contract/resilience).
