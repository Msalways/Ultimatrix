---
name: graphql-attacks
description: "GraphQL API exploitation including introspection abuse, batching attacks, alias brute force, and nested query DoS"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, encodeDecode, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["graphql attack", "graphql introspection", "graphql exploitation", "graphql security", "graphql brute force", "graphql batching", "graphql dos", "graphql api testing", "graphql enumeration", "graphql mutation abuse"]
contextBoosts: [graphql, api]
mitreAttack: ["T1190", "T1499"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection", "OWASP API Security Top 10 API8:2023 Security Misconfiguration"]
---

# GraphQL Attack Surface

## When to Use

- Target exposes a GraphQL endpoint (confirmed or suspected)
- API documentation mentions GraphQL, or network tab reveals `/graphql`, `/gql`, `/query`
- SPA frontend makes XHR requests with `query` or `mutations` in the body
- Content-Type `application/json` POST bodies containing `query` string field
- GET requests with `query` parameter in URL
- Server responds to `Content-Type: application/graphql` header
- WebSocket connections on upgrade (subscriptions)
- Any REST-like endpoint that also accepts `{"query":"..."}` body

## Do Not Use

- Pure REST APIs with no GraphQL surface
- SOAP/XML-only endpoints
- Server-Side Events (SSE) streams unrelated to GraphQL
- gRPC or Protocol Buffer transports
- When you have explicit written permission scope that excludes API abuse testing

## Auth Context

GraphQL endpoints inherit the same auth as the underlying transport. Before attacking:

1. Capture an unauthenticated request to the GraphQL endpoint. Note cookies, headers, tokens.
2. Send a introspection query without auth. If it succeeds, the entire schema is public.
3. Send the same introspection query with auth headers. Compare the schema — some resolvers are auth-gated and only appear when authenticated.
4. Test authorization on individual resolvers by sending queries with expired/invalid/different-role tokens.
5. Note any `X-Request-ID`, `X-Apollo-Tracing`, or `Server` headers — these leak implementation details.

---

## Endpoint Discovery

GraphQL endpoints are not always at `/graphql`. Probe systematically.

### Common Paths

| Path | Method | Notes |
|------|--------|-------|
| `/graphql` | POST | Most common |
| `/gql` | POST | Shorthand alias |
| `/query` | POST | Apollo Server default |
| `/api/graphql` | POST | Nested API prefix |
| `/v1/graphql` | POST | Versioned |
| `/v2/graphql` | POST | Versioned |
| `/graph` | POST | Alternate |
| `/graphql/console` | GET | GraphiQL IDE (info leak) |
| `/altair` | GET | Altair IDE |
| `/playground` | POST | GraphQL Playground |
| `/.well-known/graphql` | POST | Discovery endpoint |

### Discovery Technique


**Expected responses:**
- `"data":{"__typename":"Query"}` — confirmed GraphQL, introspection may be open
- `{"errors":[{"message":"Must provide query string."}]}` — endpoint exists, needs valid query
- `{"errors":[{"message":"Query must not contain selection set"}]}` — endpoint exists but restricted
- `404` or HTML — not a GraphQL endpoint
- `405` — wrong method, try GET

Also test with GET:

If both GET and POST work, the server is likely Apollo Server or similar permissive implementation.

---

## Introspection Attack

Introspection reveals the entire API surface — every type, field, mutation, argument, and enum.

### Full Introspection Query


### Schema Extraction — What to Look For

After retrieving the full schema, prioritize:

1. **Mutations** — These are the write operations. Every mutation is a potential attack vector.
   - `login`, `signIn`, `authenticate` — credential testing targets
   - `createUser`, `register`, `signUp` — mass registration, privilege escalation
   - `updateUser`, `updateProfile` — IDOR, mass assignment
   - `deleteUser`, `removeItem` — destructive operations to test authorization
   - `uploadFile`, `importData` — file upload abuse, SSRF

2. **Queries with sensitive fields** — `me`, `user(id:)`, `admin`, `internal`, `debug`
   - Fields returning `User`, `Admin`, `Session`, `Token`, `ApiKey` types
   - Queries accepting `ID`, `UUID`, `email` arguments — enumerable

3. **Enum values** — Leak valid roles (`ADMIN`, `USER`, `SUPER_ADMIN`), statuses (`ACTIVE`, `SUSPENDED`), and internal states

4. **Input types** — `CreateUserInput`, `UpdateUserInput` reveal expected fields including hidden ones like `role`, `isAdmin`, `permissions`

5. **Interfaces and unions** — Reveal polymorphic types that may expose internal implementation details

### Record Evidence

After introspection succeeds, save the full schema response. This is a finding — introspection should be disabled in production. Use `writeFinding` with severity `medium` and the full schema as evidence.

---

## When Introspection is Disabled

If introspection queries return `"Introspection has been disabled"` or errors, use these alternative techniques.

### Error-Based Schema Reconstruction

Send intentionally malformed queries to extract field names from error messages:


Each error leaks field names, types, and argument names. Iterate until you have a complete map of the visible schema.

### `__typename` Probing

`__typename` is always available even when introspection is disabled:


Use `__typename` to determine the structure of nested types without full introspection.

### Field Suggestion Abuse

GraphQL servers often return helpful suggestions when fields are close to valid names:


Systematically try misspellings of common field names to map the schema via suggestions.

### Clairvoyance Technique

If the server uses Apollo or similar, try the `apollo-federation` header:


Or try sending `{"extensions":{"tracing":true}}` in the request — some servers expose the full query plan in tracing extensions even when introspection is disabled.

---

## Batching Attacks

GraphQL allows sending multiple operations in a single HTTP request as a JSON array. This bypasses rate limits that count HTTP requests rather than operations.

### Basic Batching


If rate limiting is per-request (not per-operation), this allows 5x the normal request volume.

### Batch Enumeration

Use batching to enumerate IDs faster:


### Batch Mutation Abuse

If mutations are not rate-limited per-operation:


This sends N password reset requests in a single HTTP call.

### Detection

- Compare response time: batch of 10 should take roughly 1x single query time if truly parallel
- If response is an array of N results, batching is enabled
- If response is a single error about "batch not supported", batching is disabled

---

## Alias Brute Force

Aliases let you send multiple calls to the same resolver in one query, each with different arguments. This is the primary technique for GraphQL credential stuffing.

### Basic Alias Brute Force


### Detecting Valid Credentials

- **Success**: `{"alias2":{"token":"eyJ...","user":{"role":"ADMIN"}}}` — valid password found
- **Rate limit hit mid-query**: partial results or 429 — server rate-limits per-operation (good defense)
- **Same error for all aliases**: server may be applying uniform rejection (check error message differences)
- **Different errors per alias**: some passwords get "invalid password", others get "user not found" — user enumeration possible

### Multi-User Alias Brute Force

Combine user enumeration with password guessing:


### Limit Bypass

Many GraphQL servers limit aliases to 10-50 per query. Test the actual limit:


The server may accept 10 aliases but reject 100. Find the boundary and batch accordingly.

---

## Nested Query DoS

GraphQL allows deeply nested queries that can exhaust server CPU and memory. This is a denial-of-service vector.

### Basic Nested Query


If the `friends` field is a self-referential relationship, each level multiplies the result set. At depth 6 with 100 users each having 10 friends, this returns 100 * 10^6 = 100 million objects.

### Circular Fragment Abuse

Some servers do not detect circular references when using fragments:


This creates an infinite loop. If the server does not limit fragment depth, it crashes or hangs.

### Resource-Intensive Field Chains

Combine fields known to be expensive:


### Batch + Nested DoS

Combine batching with nesting for amplified effect:


### Defense Signals

- Server returns `"Query is too nested"` — depth limiting is active
- Server returns timeout after N seconds — server-side timeout exists
- Server returns 413 or 431 — request size limiting
- Response time scales linearly with depth — no protection, attack is viable

---

## Mutation Abuse

Mutations change server state. Every mutation is a potential attack surface.

### IDOR via Mutations


Test with:
- Sequential IDs: `1`, `2`, `3`...
- UUIDs leaked from other queries
- The current user's own ID with elevated fields: `input: { role: "ADMIN" }`

### Mass Assignment

GraphQL mutations often accept input objects. If the server does not whitelist allowed fields:


The server may silently accept fields it should not expose in the mutation input.

### Authorization Bypass on Mutations

Test if mutations enforce the same authorization as queries:


### Mutation Error Analysis

Error messages from mutations leak implementation details:

- `"Cannot query field "role" on type "UpdateUserInput"` — reveals input type structure
- `"Variable "$input" got invalid value..."` — reveals expected type shape
- `"Not authorized to perform this action"` — mutation exists but auth blocks it (try bypassing)
- `"Record not found"` — IDOR possible if you can guess valid IDs

---

## Subscription Abuse

GraphQL subscriptions use WebSocket connections for real-time data. They are often less protected than queries and mutations.

### Subscription Discovery

Look for WebSocket upgrade requests in network traffic:


### Subscription DoS

Open many WebSocket connections to exhaust server resources:


Each connection holds server memory and potentially a database subscription. Servers with limited connection pools will reject legitimate users.

### Data Exfiltration via Subscriptions

If subscriptions are not authorization-gated per-field:


Subscribe to high-sensitivity events. Even if queries restrict these fields, subscriptions may return them.

### Subscription Protocol Abuse

GraphQL over WebSocket has a protocol (`graphql-transport-ws`). Send malformed messages:

- Send `GQL_START` without `GQL_CONNECTION_INIT` — test protocol enforcement
- Send multiple `GQL_START` on same connection — test multiplexing limits
- Send very large payloads in `GQL_START` — test message size limits

---

## GraphQL-Specific SSRF

GraphQL can be a vector for Server-Side Request Forgery through several mechanisms.

### `@deprecated` Directive URLs

Introspection may reveal `@deprecated(reason: "See https://internal-api.corp.local/v2/docs")`. These internal URLs are exposed via the schema.

### File Upload Mutations

If the schema has a `Upload` scalar or file upload mutation:


Upload a file containing:
- Internal URLs for SSRF: `http://169.254.169.254/latest/meta-data/` (cloud metadata)
- SVG with embedded external requests
- ZIP files with path traversal

### Scalar Injection

Custom scalars may accept URLs or connection strings:


### Directive Arguments

Some GraphQL servers support custom directives that accept URLs:


---

## Anti-Hallucination

Every finding must be backed by a concrete tool response. Do not claim:

- "The server is vulnerable to X" without sending the actual payload and receiving the confirming response
- "Introspection is enabled" without showing the `__typename` or schema response
- "Batching bypasses rate limiting" without comparing batch response vs single response behavior
- "Credentials were found" without showing the successful auth token or response
- "The mutation accepts unauthorized input" without showing the mutation response with unauthorized data

Do not speculate about what a field "might" return. If you cannot query it, say the field could not be reached.

Do not assume schema structure from field names alone. Error messages and introspection results are the only evidence.

Do not hallucinate server-side protections. If you did not test rate limiting, do not claim it exists.

When a technique fails, record exactly what the server responded with. The error message itself is evidence of the server's implementation.

Save all raw responses with `recordEvidence` before drawing conclusions.

## Trigger Conditions

Activate when a GraphQL surface exists or is suspected — `/graphql`, `/gql`, `/query`, `application/graphql`, request bodies with a `query` field, or subscription WebSockets. Trigger for schema/introspection exposure, batching/alias abuse (rate-limit/credential stuffing), nested-query DoS, IDOR/mass-assignment via mutations, and GraphQL-specific SSRF. Do not trigger on pure REST/SOAP/gRPC/SSE-with-no-GraphQL; respect explicit scope excluding API abuse.

## Detection Approach

First confirm the endpoint (introspection probe; note `405`→try GET, error shapes that reveal existence). If introspection is open, extract the full schema and prioritize mutations, sensitive queries (`me`, `admin`), enums (roles), and input types (hidden `role`/`isAdmin`). If disabled, reconstruct via error messages, `__typename` probing, and field suggestions. For batching/alias abuse, send arrays of operations/aliases to a single HTTP request and compare response vs per-request limits — confirm it actually bypasses counting. For nested-query DoS, send deep self-referential queries and observe depth/timeout/size defenses (measure response time scaling). For mutations, test IDOR (swap IDs), mass assignment (add fields), and authz parity with queries. Always confirm with the actual response — don't speculate on field returns.

## Pitfalls

- Claiming introspection enabled without the schema/`__typename` response.
- Claiming batching bypasses rate limiting without comparing batch vs single behavior.
- Claiming credentials found without a successful auth token/response.
- Assuming a mutation accepts unauthorized input without the mutation response.
- Speculating field returns from names alone — error messages/introspection are the only evidence.
- Hallucinating server-side protections (depth limits, rate caps) you didn't actually test.

## Verification & Impact

CONFIRMED when evidence shows: full introspection schema returned (info disclosure), batch/alias volume exceeding per-operation limits, a successful credential-stuffing token, a nested query causing measurable resource exhaustion/timeout, or a mutation accepting unauthorized input/ID. SUSPECTED when a technique is attempted but impact isn't reproduced — record as candidate. Document impact by class (introspection info-leak, auth bypass, DoS, SSRF via schema URLs/uploads) and severity. Capture raw queries/responses via `recordEvidence`.
