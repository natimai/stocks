# Staging and Rollout Plan

## Environments

- Development:
  - local frontend + local backend
- Staging:
  - dedicated Firebase project
  - dedicated secrets
  - same runtime class and env variables as production
- Production:
  - gradual traffic rollout by revision

## Promotion Flow

1. Merge to `main`.
2. CI gates:
   - frontend lint/build
   - backend contract tests
   - smoke checks
   - security scans
3. Deploy to staging.
4. Execute critical flow validation:
   - Home -> Stock
   - timeframe/date/share
   - analysis + chat
   - portfolio CRUD
   - admin user toggle
5. Promote to production with progressive rollout.

## Progressive Rollout

- Step 1: `10%` traffic for 30-60 min
- Step 2: `50%` traffic for 60-120 min
- Step 3: `100%` traffic

Advance only when all checks are stable:

- no runtime crash spikes
- no unexpected increase in `5xx`
- p95 latency remains within SLO band

## Rollback Strategy

- Trigger rollback when:
  - `5xx` exceeds baseline by >2x for 10 minutes
  - core path runtime failures reproduce in staging/prod
  - auth/admin flows are broken
- Rollback action:
  - route traffic to previous stable revision
  - pause rollout
  - open incident and capture request IDs + logs
