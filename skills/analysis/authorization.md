---
name: authorization
description: "Authorization testing for broken access control, IDOR, privilege escalation, and session management"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, findEndpointsInResponse, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["authorization testing", "access control", "broken access control", "idor", "privilege escalation", "session management", "authorization flaws", "access control testing", "privilege testing", "security testing"]
---

# Authorization Testing

## Description
Authorization testing verifies that users can only access resources they're permitted to access. It checks whether the application properly enforces access controls across all endpoints, including horizontal and vertical privilege escalation.

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL and role to get real headers. Pass these in the `headers` parameter of httpRequest.

## Methodology

### Step 1: Map Authentication and Roles
Before testing authorization, understand the system:
- What authentication mechanisms exist? (session cookies, JWT, OAuth, API keys)
- What user roles are defined? (admin, user, guest, moderator)
- Which endpoints require authentication?
- Which endpoints require specific roles?

### Step 2: Multi-Role Testing Protocol

For each role (admin, user, guest):
1. Authenticate using browser tools — navigate to login, fill credentials, submit
2. After login, call **getCapturedHeaders** with the target URL to get real auth context
3. Test endpoints with role-specific auth context using httpRequest
4. Record which endpoints are accessible to each role
5. Compare responses between roles to find IDOR/privilege escalation

### Step 3: IDOR Testing (Insecure Direct Object Reference)

1. Identify endpoints with object IDs in URL params, request bodies, or headers:
   - `/api/users/123` → try `/api/users/124`
   - `/api/orders?id=456` → try `/api/orders?id=457`
   - `{"user_id": 789}` → try `{"user_id": 790}`

2. Test horizontal privilege escalation:
   - Authenticate as User A, capture headers
   - Access User B's resources using User A's headers
   - If you get User B's data, that's IDOR

3. Test vertical privilege escalation:
   - Authenticate as low-privilege user, capture headers
   - Access admin endpoints using low-privilege headers
   - If admin endpoints respond, that's broken access control

4. Test identifier predictability:
   - Sequential IDs: try incrementing by 1
   - UUID-based: check if other users' UUIDs are guessable
   - Composite IDs: check if both parts need to match

### Step 4: JWT Testing

1. Decode the JWT to examine structure and claims
2. Test algorithm confusion:
   - Change `alg: RS256` to `alg: HS256` (use public key as HMAC secret)
   - Try `alg: none` (no signature)
3. Test token manipulation:
   - Modify claims (sub, role, exp)
   - Remove signature entirely
   - Use an expired token
4. Test weak secrets:
   - Common passwords: `secret`, `password`, `key`
   - Brute-force with common JWT secrets

### Step 5: OAuth Testing

1. Test CSRF in OAuth flow: initiate flow without state parameter
2. Test redirect URI: modify `redirect_uri` to attacker-controlled URL
3. Test scope escalation: request higher privilege scopes
4. Test authorization code interception: capture and replay codes

### Step 6: Session Management

1. Test session fixation: does the app issue a new session after login?
2. Test session timeout: do sessions expire properly?
3. Test concurrent sessions: can a user have multiple active sessions?
4. Test session invalidation: does logout actually invalidate the token?

### Step 7: Forced Browsing

1. Access authenticated pages without credentials
2. Access admin pages with regular user credentials
3. Check if directory listing is enabled
4. Test for direct URL access to restricted resources

## What to Look For
- Endpoints that return data for other users (horizontal IDOR)
- Admin functionality accessible to regular users (vertical IDOR)
- Missing role checks on sensitive operations
- Predictable resource identifiers
- Inconsistent access control enforcement
- JWT algorithm confusion or weak secrets
- OAuth redirect URI validation bypass
- Session fixation or timeout issues

## Testing Approach
1. Map all endpoints and their required authorization levels
2. Authenticate with different roles and capture sessions
3. Test each endpoint with unauthorized roles
4. Test IDOR by swapping user identifiers
5. Test JWT/OAuth specific vulnerabilities
6. Test session management lifecycle

## Evidence to Collect
- HTTP request/response pairs showing unauthorized access
- Screenshots of admin panels accessed with regular user
- Decoded JWT tokens showing modified claims
- Session tokens and their behavior across roles

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every vulnerability you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.
