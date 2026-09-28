# Bug-Bounty Readiness Profile

Ultimatrix keeps the normal local/lab profile unchanged. For a live bounty engagement, enable the fail-closed `bounty` profile. Runtime construction then rejects the engagement unless authorization, a hard scope, explicit action categories, and hard budget enforcement are all present.

## Minimal authorized profile

```yaml
authorization:
  confirmed: true
  method: bounty
  target: https://example.com
  timestamp: 2026-09-25T00:00:00.000Z

bounty:
  enabled: true
  allowedCategories:
    - read
    - search
    - browser_action
    - create
    - modify
    - send
    - execute

scope:
  allowedDomains:
    - example.com
  allowedOrigins:
    - https://example.com
  allowedPorts:
    - 443
  # Set true only for a deliberately local lab target.
  allowPrivateAddresses: false
  allowedProtocols:
    - https
  enforcement: hard

budgetPolicy:
  enforcement: hard
  maxModelCallsPerTask: 15

rateLimit:
  requestsPerMinute: 10
  maxConcurrent: 1

externalTools:
  enabled: false
```

Set `ULTIMATRIX_SECRET_KEY` in the process environment before a bounty run. Durable browser-session exports are encrypted with that key; without it, live session persistence fails closed rather than writing plaintext.

Do not add `allowAny` to a live bounty profile. External adapters are rejected by the bounty preflight until they provide typed replay material and a finding-specific oracle.

## Pilot acceptance gate

A bounty pilot is not ready for broader use until all of these pass:

1. Browser navigation and state-changing actions stay within the hard scope.
2. A browser action produces correlated typed evidence.
3. A finding is persisted with a logical finding ID and an exploit proof.
4. An independent replay reproduces the expected response or browser effect.
5. A failed, unavailable, or policy-blocked replay never becomes `[CONFIRMED]`.
6. Two actor sessions are isolated and their evidence is attributable.
7. Provider failure, quota exhaustion, timeout, and crawl abort recover without a false completed status.
8. The final report contains reproducible request material, evidence IDs, proof status, and scope metadata.

Browser subresources, redirects, and popups are governed too; add every authorized asset origin to `scope.allowedOrigins` or the browser will block it.

The authorized firing range is suitable for the first browser/capture smoke test. A real bounty target should be added only after its written scope, allowed impact, authentication model, and rate limits are recorded in the authorization block.
