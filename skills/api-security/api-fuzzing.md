---
name: api-fuzzing
domain: api-security
category: api-security
tier: balanced
description: Fuzz APIs with schema-aware mutation, parameter tampering, inventory discovery, and rate-limit bypass to surface hidden or fragile endpoints.
toolRefs:
  - httpRequest
  - parseResponse
  - compareResponses
  - findEndpointsInResponse
  - recordEvidence
  - writeFinding
  - getTargetSummary
triggers:
  - api fuzzing schema aware
  - api endpoint discovery inventory
  - parameter mutation testing
  - api rate limit bypass
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1190
  - T1083
  - T1078
owaspRefs:
  - A01:2021
  - A04:2021
  - A05:2021
---

# API Fuzzing & Inventory Discovery

## When to Use
Use against REST/JSON/gRPC-ish HTTP APIs, especially when an OpenAPI/Swagger spec is available or inferable. Targets: undiscovered endpoints, parameter-handling bugs, authz gaps, and weak rate limiting.

## Detection Approach
1. **Build the inventory.** Enumerate endpoints from specs, JS bundles, and `findEndpointsInResponse` on app pages. Record methods and expected parameters.
2. **Schema-aware mutation.** For each parameter, substitute boundary and malformed values (oversized strings, negative numbers, nested objects, unexpected types) and observe error vs handled responses via `compareResponses`.
3. **Discover hidden routes.** Probe common API path patterns and version prefixes (`/api/v1`, `/internal`, `/admin`) and watch for non-404s.
4. **Test authz via role swap.** Replay requests with removed/downgraded tokens to find endpoints that skip authorization checks.
5. **Test rate-limit bypass.** Repeat a throttled action while varying headers (`X-Forwarded-For`, client identifiers) and request shape to see if limits are keyed on a spoofable value.
6. **Switch logic.** If spec-driven fuzzing saturates, pivot to response-driven discovery (follow links/IDs in responses). If rate-limit holds, document as resilient.

## Pitfalls
- Fuzzing without an inventory — you miss unlinked endpoints.
- Treating 500s as vulnerabilities without confirming exploitability.
- Assuming rate-limit on one header means global protection.
- Ignoring that some "errors" are expected validation, not bugs.

## Verification & Impact
- **Confirmed:** Hidden endpoint reachable, parameter mutation triggers real fault/behavior change, or authz/rate-limit bypass demonstrated.
- **Suspected:** Inconsistent error handling or throttling anomalies.
- Document endpoint, payload shape, and consequence. Use `writeFinding` with request/response evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| Schema-aware fuzz | Mutate per declared type |
| Inventory | Map of all reachable endpoints |
| Rate-limit key | Value the limiter counts on |
