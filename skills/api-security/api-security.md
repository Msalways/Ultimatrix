---
name: api-security
description: "REST API security testing covering mass assignment, BOLA, rate limiting bypass, and API versioning attacks"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, findEndpointsInResponse, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders, arjun]
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

## API Discovery

### OpenAPI/Swagger Enumeration

Check for exposed API documentation before testing:

Parse discovered schemas to extract all endpoints, parameters, and models. Every endpoint in the schema is a testing target.

### Common API Paths

Systematically probe these paths for hidden or undocumented endpoints:

### Version Detection

Test multiple version formats simultaneously:

## BOLA (Broken Object Level Authorization)

BOLA is the most common API vulnerability. Test by manipulating object references across authorization boundaries.

### Sequential ID Enumeration


### UUID Manipulation


### Nested Object Access


### Cross-Tenant Access


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


### Mass Assignment Vectors


### Detection Strategy


## Rate Limiting Bypass

### IP Rotation Techniques


### Chunked Transfer Encoding


### Parameter Pollution


### Method-Based Bypass


### Timing Attacks


## API Versioning Attacks

### Deprecated Version Testing


### Version Enumeration


## HTTP Method Tampering

### Method Override Headers


### PATCH Bypass


### TRACE Method (XST)


## Content-Type Manipulation

### Format Switching


### Content-Type Confusion


## Error Information Disclosure

### Verbose Error Probing


### Stack Trace Detection


### Debug Mode Detection


## JWT/API Key Security

### Token Leakage via URL


### Weak Signing Detection


### Key Rotation Issues


### Algorithm Downgrade


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
