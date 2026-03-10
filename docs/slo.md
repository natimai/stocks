# API SLO Baseline

This document defines the initial SLOs for staging and production rollout.

## Scope

- `GET /api/search`
- `GET /api/chart/{ticker}`
- `GET /api/quick-stats/{ticker}`
- `GET /api/analyze/{ticker}`

## Targets (Rolling 30 Days)

- Availability:
  - Core read endpoints (`search`, `chart`, `quick-stats`): `99.9%`
  - AI endpoints (`analyze`, `chat_agent`, `portfolio-doctor/chat`): `99.5%`
- Error Budget:
  - 5xx error rate on core read endpoints: `< 0.5%`
  - 5xx error rate on AI endpoints: `< 1.0%`
- Latency:
  - `search` p95: `< 900ms`
  - `chart` p95: `< 1200ms`
  - `quick-stats` p95: `< 1200ms`
  - `analyze` time-to-first-event p95: `< 5000ms`

## Measurement

- Correlation key: `requestId` (`X-Request-ID` response header and error payload field).
- Structured logs fields:
  - `endpoint`, `userId`, `ticker`, `latencyMs`, `provider`, `errorCode`.
- Weekly review:
  - Compare current period against previous period for p95 + 5xx trend.
  - Track cache hit ratio for `search`, `chart`, `quick-stats`.

## Alert Policy

- Page:
  - Availability below target for 10+ minutes.
  - `5xx` above threshold for 5+ minutes.
- Ticket:
  - Budget threshold warnings for provider/LLM calls.
  - Elevated fallback/stale response usage.
