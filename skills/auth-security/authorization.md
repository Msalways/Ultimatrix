---
name: authorization
description: "Authorization testing for broken access control, IDOR, privilege escalation, and session management"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, findEndpointsInResponse, followRedirects, compareResponses, updateGraph, writeFinding, recordEvidence, getCapturedHeaders, runPrimitive, requestAsActor, listActors]
primitives: [authBypass, idorSwapper, authzMatrix, tenantIsolation]
triggers: ["authorization testing", "access control", "broken access control", "idor", "privilege escalation", "session management", "authorization flaws", "access control testing", "privilege testing", "security testing"]
contextBoosts: [auth]
mitreAttack: ["T1190", "T1078"]
owaspRefs: ["OWASP Top 10 A01:2021 Broken Access Control", "OWASP Top 10 A07:2021 Identification and Authentication Failures"]
toolChains:
  - name: idor-detection
    description: "Detect Insecure Direct Object References via parameter manipulation"
    steps: [httpRequest, parseResponse, compareResponses, recordEvidence, writeFinding]
  - name: authz-bypass
    description: "Test authorization bypass via role manipulation"
    steps: [httpRequest, parseResponse, getCapturedHeaders, recordEvidence, writeFinding]
compositionRules:
  enhances: [jwt-advanced, web-pentest]
requires:
  capabilities:
    - network.request
    - response.compare
    - session.actor-context
    - primitive.execute
procedure:
  stages:
    - id: baseline
      goal: Capture authorized owner behavior for each identified endpoint.
    - id: alternate-actor
      goal: Replay equivalent request under a different actor (user B, guest, or unauthenticated).
    - id: mutate-identity
      goal: Change one ownership dimension (user ID, object ID, tenant, role).
    - id: compare
      goal: Compare normalized observations — status, body, headers, timing.
    - id: reproduce
      goal: Reproduce a material difference to confirm exploitability.
verification:
  coverage:
    - id: owner-baseline
      required: true
    - id: alternate-actor
      required: true
    - id: controlled-difference
      required: true
    - id: independent-retest
      required: true
output:
  schema: AuthorizationConclusion
---

# Authorization Testing

## When to Use
- Any endpoint returning user-specific data (profiles, orders, files, messages)
- Admin panels, dashboards, settings pages
- API endpoints with object IDs in path or body
- Applications using JWT, OAuth2, SAML, or session cookies
- After capturing traffic from a logged-in user with different roles
- When the graph shows AuthFlow or RBACMatrix nodes

## Do Not Use
- Static assets (CSS, JS, images) with no auth logic
- Public endpoints explicitly documented as unauthenticated
- When you have zero authenticated sessions — get one first

## Auth Context

Before making HTTP requests, call **getCapturedHeaders** with the target URL and role to get real headers. Pass these in the `headers` parameter of httpRequest.

Decision tree for auth mechanism:

1. **Check response headers** for auth indicators:
   - `Set-Cookie` with session token → Session-based auth
   - `Authorization: Bearer <token>` → JWT or opaque token
   - `X-Auth-Token` / `X-API-Key` → Custom token auth
   - Redirect to login page with `code` / `state` params → OAuth/OIDC
2. **Inspect token structure**:
   - Three dot-separated base64 segments → JWT
   - Random string (32+ chars) → Opaque session token
   - SAML XML assertion → SAML-based
3. **Test token validation**:
   - Modify payload → send → does server reject?
   - Expire the token → does server enforce expiry?
   - Remove signature → does server still accept?
4. **Determine validation location**:
   - Stateless JWT: server validates signature locally (check for `jwks_uri` or embedded public key)
   - Session token: server looks up in database (check for session store side effects)
   - OAuth token: server introspects at authorization server endpoint

## Knowledge Fragments

Detailed attack knowledge lives in focused sub-documents. Load the relevant
fragment based on the target's auth mechanism before diving deep:

| Fragment ID | When to Load |
|---|---|
| `jwt-attacks` | Target uses JWT (three-segment tokens, `Authorization: Bearer`) |
| `oauth-testing` | Target uses OAuth2/OIDC (redirects, authorization codes, consent screens) |
| `idor-automation` | Target has object-reference endpoints (user IDs, file paths, order numbers) |
| `rbac-testing` | Target has multiple roles (admin/user/guest, role-based endpoints) |
| `session-management` | Target uses session cookies (login/logout flows, session IDs) |
| `forced-browsing` | Target is a SPA or has hidden admin paths (direct URL access) |

## Anti-Hallucination

Your claims will be verified against real tool output. Never fabricate findings.

Every vulnerability you report MUST have a corresponding tool call response that proves it.

If a tool call fails, say so honestly — do not invent a success.

Do NOT claim:
- "Endpoint X is vulnerable" without sending a request to endpoint X
- "JWT is vulnerable to alg:none" without actually modifying and sending the token
- "IDOR exists" without showing the comparison between two user sessions
- "Admin panel accessible" without a response body showing admin content

Do NOT assume:
- Auth mechanism based on response headers alone
- That a 200 response means authorization is bypassed (check response body)
- That a 403 means the endpoint is secure (may be missing endpoint entirely)

Always verify:
- Response status code AND body content
- That returned data belongs to the authenticated user, not a hardcoded response
- That session regeneration occurred after login
- That tokens are actually validated server-side, not just present in the request

## Detection Approach

Capture auth context via `getCapturedHeaders` per role. For IDOR, run the protocol: authenticate as A, capture the resource request noting all object references; replay with B's token (and without a token) — if A's data returns in B's session, horizontal IDOR; admin endpoints from a regular user = vertical. For RBAC, build a role matrix and test each endpoint per role, probing method-based and version-based access differences. For session management, test fixation (fixed session accepted post-login), timeout, concurrent sessions, and invalidation on logout. For JWT/OAuth, apply the JWT techniques (alg confusion, none, jku) and OAuth redirect/scope issues. Always verify status AND body — a 200 with generic content or a 403 from a missing endpoint are not findings.

## Pitfalls

- Claiming an endpoint vulnerable without sending a request to it.
- Claiming IDOR without comparing two distinct user sessions.
- Claiming `alg:none` JWT bypass without modifying and sending the token.
- Claiming admin access without a response body showing admin content.
- Assuming a 200 = bypass (check body) or a 403 = secure (may be missing endpoint).
- Assuming auth mechanism from headers alone rather than testing validation.

## Verification & Impact

CONFIRMED when reproduced evidence shows cross-user/role data access (IDOR/BOLA/BFLA), accepted forged JWT, successful OAuth redirect/scope abuse, or session flaw (fixation/non-invalidation). SUSPECTED when an anomaly appears but isn't reproduced — record as candidate. Document impact by access-control class (A01 Broken Access Control, A07 Auth Failures) and severity (data exposure, privilege escalation). Capture request/response pairs, role comparisons, and token evidence via `recordEvidence`.

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `authBypass` | login bypass / default creds / JWT alg:none |
| `idorSwapper` | object-reference swap across sessions |
| `authzMatrix` | role x endpoint authorization matrix |
| `tenantIsolation` | cross-tenant isolation checks |
