---
name: api-methodology
description: "Structured methodology for API security testing — REST, GraphQL, WebSocket, gRPC"
category: methodology
tier: balanced
toolRefs: [httpRequest, parseResponse, loadSkillReference, getCapturedHeaders, writeFinding, updateGraph, encodeDecode, runPrimitive, searchSkills]
triggers: ["api", "rest api", "graphql", "websocket", "grpc", "api security"]
---

# API Security Testing Methodology

## Phase 1: API Discovery & Documentation

1. **Endpoint inventory** — Read all Endpoint nodes from graph. Map base URLs, versioning patterns, naming conventions.
2. **Documentation sources** — Check for OpenAPI/Swagger specs, GraphQL introspection, WSDL, API docs pages.
3. **Content-type analysis** — Map which endpoints accept JSON, XML, form-data, multipart. Test content-type switching attacks.
4. **Versioning** — Identify API versions. Test deprecated endpoints (often less protected).

## Phase 2: Authentication & Authorization

1. **Auth mechanism** — Identify: API key, OAuth2, JWT, bearer token, mutual TLS, HMAC signing.
2. **Token analysis** — Decode JWTs (use `encodeDecode`). Check algorithm, expiry, claims. Test algorithm confusion (none → HS256).
3. **Scope testing** — For OAuth2: test scope escalation. For API keys: test key isolation across tenants.
4. **Role-based access** — Map each endpoint → required role. Test access with wrong role, no role, expired token.

## Phase 3: Input Validation

1. **Parameter fuzzing** — Test each parameter: type confusion, injection payloads, boundary values.
2. **Mass assignment** — Add unexpected fields to requests. Does the API accept and process them?
3. **Pagination/limit** — Test unlimited pagination, offset manipulation, page size overflow.
4. **File upload** — If applicable: test file type bypass, path traversal in filename, content-type spoofing.
5. **Rate limiting** — Test per-endpoint rate limits. Can they be bypassed via IP rotation, header manipulation?

## Phase 4: Business Logic

1. **Idempotency** — Can critical operations (payment, transfer) be replayed?
2. **State transitions** — Can resources be moved to invalid states? (e.g., draft → paid without payment)
3. **Race conditions** — Concurrent requests on shared resources (balances, inventory, seats)
4. **Workflow bypass** — Skip required steps in multi-step operations

## Phase 5: Data Exposure

1. **Excessive data** — Does the API return more fields than the client needs?
2. **Error messages** — Do errors leak stack traces, SQL queries, internal paths?
3. **GraphQL** — Test introspection, nested queries (DoS), field suggestion leakage.
4. **WebSocket** — Test message injection, cross-site WebSocket hijacking, broadcast storms.

## Phase 6: Infrastructure

1. **CORS** — Test origin whitelisting, wildcard patterns, credential handling.
2. **Headers** — Check security headers (CSP, HSTS, X-Content-Type-Options).
3. **TLS** — Test for weak ciphers, certificate validation bypass.
4. **GraphQL depth** — Test query depth limits, complexity analysis bypass.

## Exploitation & Proof

For each confirmed finding:
1. Minimal PoC with raw request/response
2. Impact assessment (data breach, privilege escalation, denial of service)
3. Structured evidence via `writeFinding`

## Anti-Patterns

- Do not fuzz without understanding the API schema first
- Do not skip auth testing on "public" endpoints
- Do not assume JSON-only — test XML, form-data, URL-encoded
- Do not ignore GraphQL-specific attack surface
