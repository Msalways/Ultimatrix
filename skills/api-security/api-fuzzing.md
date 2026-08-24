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

```bash
# Extract API paths from JavaScript bundles
curl -sS https://target.com/static/app.js | grep -oE '"/(api|v[0-9])/[a-zA-Z0-9/_-]+"'

# Parameter mining with arjun (GET + POST)
arjun -u https://target.com/api/v1/users -m GET
arjun -u https://target.com/api/v1/users -m POST

# Route discovery with a dedicated API wordlist
ffuf -u https://target.com/api/FUZZ -w /usr/share/seclists/Discovery/Web-Content/api/objects.txt \
     -mc all -fc 404 -t 25

# Pull every path+operation from an exposed spec
curl -sS https://target.com/openapi.json | jq -r '.paths | to_entries[] |
  .key as $p | .value | keys[] | "\(.ascii_upcase) $p"' 2>/dev/null || \
curl -sS https://target.com/openapi.json | jq -r '.paths | keys[]'
```

2. **Schema-aware mutation.** For each parameter, substitute boundary and malformed values (oversized strings, negative numbers, nested objects, unexpected types) and observe error vs handled responses via `compareResponses`.

```json
{"id": -1}
{"id": 99999999999999999999}
{"id": "1 OR 1=1"}
{"id": {"$ne": null}}
{"id": [1, 2, 3]}
{"id": {"nested": {"deep": true}}}
{"amount": 0.000000001}
{"amount": 1e309}
{"name": ""}
{"name": "A"}
{"email": "a@b.c", "extra_field": {"role": "admin"}}
```

```bash
# Type-confusion fuzz: send each declared-string param as number/array/object/null
ffuf -u https://target.com/api/v1/orders -X POST \
     -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' \
     -w mutations.txt -fr '"error":null' -t 10
```

3. **Discover hidden routes.** Probe common API path patterns and version prefixes (`/api/v1`, `/internal`, `/admin`) and watch for non-404s.

```bash
wfuzz -z file,/usr/share/seclists/Discovery/Web-Content/Api-Security/api-endpoints-prefix.txt \
      --hc 404 https://target.com/FUZZ

for p in /api/internal /api/admin /actuator /debug /metrics /health \
         /api/v0 /api/beta /api/graphql /rpc; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "https://target.com$p")
  [ "$code" != "404" ] && echo "$p → $code"
done
```

4. **Test authz via role swap.** Replay requests with removed/downgraded tokens to find endpoints that skip authorization checks.

```http
GET /api/v1/admin/stats HTTP/1.1
Authorization: Bearer <regular-user-token>

GET /api/v1/admin/stats HTTP/1.1

GET /api/v1/admin/stats HTTP/1.1
Authorization: Bearer <expired-token>
```

5. **Test rate-limit bypass.** Repeat a throttled action while varying headers (`X-Forwarded-For`, client identifiers) and request shape to see if limits are keyed on a spoofable value.

```bash
# Confirm the limit first, then vary the spoofable key per request
for i in $(seq 1 60); do
  curl -sS -o /dev/null -w "%{http_code} " https://target.com/api/v1/items \
       -H "X-Forwarded-For: 10.1.$((i/250)).$((i%250+1))"
done; echo
```

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
