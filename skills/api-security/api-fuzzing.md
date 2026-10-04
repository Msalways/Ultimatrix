---
name: api-fuzzing
domain: api-security
category: api-security
tier: balanced
description: Assess observed APIs with schema-aware input mutation, authorization checks, and bounded response comparisons.
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
  - api inventory from observed routes
  - parameter mutation testing
  - api rate limit assessment
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1190
  - T1078
owaspRefs:
  - API1:2023 Broken Object Level Authorization
  - API3:2023 Broken Object Property Level Authorization
  - API4:2023 Unrestricted Resource Consumption
  - API5:2023 Broken Function Level Authorization
  - API9:2023 Improper Inventory Management
---

# API Fuzzing & Inventory Discovery

## When to Use
Use against REST/JSON/gRPC-ish HTTP APIs when routes come from captured traffic, delivered client code, or target-provided links/specifications. Assess input handling, authorization, inventory gaps, and resource limits on that observed surface.

## Detection Approach
1. **Build the inventory.** Enumerate endpoints from captured requests, target-linked specs, delivered JS bundles, and `findEndpointsInResponse` on app pages. Record methods and expected parameters with a source reference. Never invent routes with a wordlist.

```bash
# Use the exact JavaScript bundle URL captured from the target page
curl -sS "$OBSERVED_BUNDLE_URL" | grep -oE '"/(api|v[0-9])/[a-zA-Z0-9/_-]+"'

# Pull every path+operation from a target-linked spec URL captured as evidence
curl -sS "$OBSERVED_SPEC_URL" | jq -r '.paths | to_entries[] |
  .key as $p | .value | keys[] | "\(.ascii_upcase) $p"' 2>/dev/null || \
curl -sS "$OBSERVED_SPEC_URL" | jq -r '.paths | keys[]'
```

2. **Schema-aware mutation.** For each parameter, substitute boundary and malformed values (oversized strings, negative numbers, nested objects, unexpected types) and observe error vs handled responses via `compareResponses`.

```json
{"id": -1}
{"id": 99999999999999999999}
{"id": {"unexpected": "value"}}
{"id": [1, 2, 3]}
{"id": {"nested": {"deep": true}}}
{"amount": 0.000000001}
{"amount": 1e309}
{"name": ""}
{"name": "A"}
{"email": "a@b.c", "extra_field": "unexpected"}
```

```bash
# Replay one captured request at a time. Keep its actor, route, content type,
# and unrelated fields; change only one observed input per experiment.
```

3. **Expand the inventory from evidence.** Follow routes linked from captured responses, target-delivered client code, or a target-provided API specification. Preserve the source reference for each route and method. Do not probe conventional path lists, guessed version prefixes, or wordlists.

4. **Test authz on an observed route.** Replay the captured request with an authorized lower-privilege actor or no actor, preserving the observed method, path, and resource identifier. Do not invent an administrative route or substitute a victim-owned identifier.

Compare the captured request as the owner, as an authorized lower-privilege actor, and without credentials when the route is expected to require authentication. Use a test-owned object or a route observed to operate on the current actor's object. Record each actor and keep the resource identifier constant.

5. **Assess rate limits.** Repeat only an observed, low-impact request at a bounded pace. Record when throttling begins and the response. Stop at the first limit, instability, or unexpected cost. Do not rotate spoofed client IP headers or run concurrency against a live service.

6. **Switch logic.** Follow links, identifiers, and resource relationships returned by observed responses. If rate limiting engages, document the threshold and stop.

## Pitfalls
- Treating the observed inventory as complete; mark unexplored route families as unknown and expand only from target evidence.
- Treating 500s as vulnerabilities without confirming exploitability.
- Assuming a rate-limit result for one actor and workflow proves the control is consistent everywhere.
- Ignoring that some "errors" are expected validation, not bugs.

## Verification & Impact
- **Confirmed:** An evidence-sourced operation demonstrates unauthorized object/function access, a reproducible input-handling fault, or a resource-limit failure with measured impact.
- **Suspected:** Inconsistent error handling or throttling anomalies.
- Document endpoint, payload shape, and consequence. Use `writeFinding` with request/response evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| Schema-aware fuzz | Mutate per declared type |
| Inventory | Map of all reachable endpoints |
| Rate-limit key | Actor or request property the observed limiter uses |

---

## Cheat Sheet — API Fuzzing Payloads

### Type Confusion

```json
{"id": -1}
{"id": 99999999999999999999}
{"id": [1, 2, 3]}
{"amount": 1e309}
{"name": ""}
```

### Rate Limit Assessment

Use a low request budget against an observed operation. Record the threshold, status, retry guidance, and actor or key associated with the limit. Do not rotate spoofed client-IP headers or use concurrent load to evade the control.

### Route Provenance

Add routes only when found in captured requests, target-delivered code, responses, or target-provided specifications. Keep the source reference so each test can explain why the route was in scope.

## Knowledge Sources

- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x00-header/) — current API risk taxonomy, including authorization, resource consumption, and inventory management.
- [OWASP REST Assessment Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Assessment_Cheat_Sheet.html) — per-operation authorization and bounded rate-limit assessment guidance.
