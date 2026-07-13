---
name: authorization
description: "Authorization testing for broken access control, IDOR, privilege escalation, and session management"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, findEndpointsInResponse, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
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

## JWT Attack Techniques

### Decode and Inspect

1. Split the token on `.` — header (alg, kid, jku), payload (claims), signature
2. Base64-decode each segment; look for: `alg`, `kid`, `jku`, `x5u`, `typ`, `iss`, `aud`, `exp`, `sub`
3. Check if `alg` matches what the server expects (e.g., server says RS256 in JWKS but token uses HS256)
4. Look for weak claims: missing `aud`, overly broad `iss`, no `exp`, or `nbf` far in the past

Use **httpRequest** to call a JWKS endpoint if discovered:

```
GET /.well-known/jwks.json
GET /oauth2/certs
GET /.well-known/openid-configuration  → extract "jwks_uri" value
```

Fetch the JWKS, extract the key matching the token's `kid`, and check if it's RSA (RS256) or symmetric (oct).

### Algorithm Confusion (RS256 → HS256)

When server uses RS256 but accepts HS256, sign with the public key as HMAC secret:

1. Fetch the public key from `jwks_uri` (the full PEM or the `n`/`e` values from the JWK)
2. Set the JWT header `alg` to `HS256`
3. Use the RSA public key (PEM string) as the HMAC signing secret
4. Server verifies the HMAC using the same public key — it matches because it uses the public key for both signature verification and HMAC verification
5. Sign with a tool: `jwt_tool.py -X k -S HS256 -k public.pem`

Indicators: server returns a valid response for an HS256-signed token using the RS256 public key.

### alg:none Attack

Strip signature entirely, set alg to none:

1. Decode the JWT, keep header and payload
2. Set `alg` to `none` in header
3. Remove the signature segment (keep the trailing dot): `header.payload.`
4. Send the token in the `Authorization: Bearer` header
5. If the server accepts it → critical vulnerability

If server rejects `none`, try mixed-case bypass:
- `None`, `NONE`, `nOnE`, `null`, `NaN`
- Some libraries only check lowercase `none` exactly

### jku / x5u Header Injection

If server validates JWT via JKU (JWK Set URL) or X5U:

1. Host your own JWKS at an attacker-controlled URL (e.g., `https://evil.com/jwks.json`)
2. Generate an RSA key pair for your malicious JWKS
3. Modify the JWT header: set `jku` to your URL
4. Sign the token with your private key
5. Server fetches your JWKS, finds the matching key, and validates your forged token
6. Same technique works for `x5u` (X.509 certificate URL)

Additional tricks:
- Try `jku: //evil.com/jwks.json` (protocol-relative bypass)
- Try `jku: https://evil.com%40real-server.com/jwks.json` (URL parsing confusion)
- If server uses `new URL(jku)`, test `jku: https://evil.com\@real-server.com/` (backslash confusion on some parsers)

### Token Manipulation Payloads

- **Role escalation**: Change `"role": "user"` → `"role": "admin"` in payload
- **User impersonation**: Change `"sub": "12345"` → `"sub": "admin"` or `"sub": "1"`
- **Audience bypass**: Change `"aud": "internal-api"` → `"aud": "public-api"` if server uses multiple validation paths
- **Expiry extension**: Change `"exp": 1700000000` → `"exp": 9999999999`
- **Issuer spoofing**: Change `"iss": "app"` → `"iss": "app-admin"` if issuer controls role assignment
- **Claims injection**: Add `"admin": true`, `"permissions": ["*"]`, `"email": "admin@target.com"`

### Weak Secret Brute Force

If `alg` is HS256/HS384/HS512, brute force the signing secret:

1. Try common secrets: `secret`, `password`, `key`, `jwt-secret`, `changeme`, app name
2. Try wordlist attack with `hashcat -m 16500 jwt.txt wordlist.txt`
3. Try `jwt_tool.py -X s -S HS256 -p common-passwords.txt`
4. If token is issued by the app (not external IdP), the secret may be in source code, config files, or environment variables

### Key Confusion Detection

If you see `kid` (Key ID) in JWT header:

1. The server uses `kid` to select the verification key from its JWKS
2. Test **path traversal**: set `kid` to `../../dev/null` — some servers read the key file by path and `/dev/null` is empty, causing HMAC verification with empty key
3. Test **SQL injection in kid**: `kid': ' OR '1'='1' --` if the server stores keys in a database
4. Test **known key override**: if the JWKS has multiple keys, pick a weaker one (e.g., RSA-256 instead of RSA-4096)

### JWT Tool Commands

```bash
# Decode JWT
jwt_tool.py <token>

# Tamper claims
jwt_tool.py <token> -T -S HS256 -p "your-secret"

# Test alg:none
jwt_tool.py <token> -X k -S none

# Brute force HS256
jwt_tool.py <token> -X s -S HS256 -p wordlist.txt

# Fetch JWKS and verify
jwt_tool.py <token> -j <jwks_uri>

# Forge token with custom claims
jwt_tool.py -I -pc role -pv admin -S HS256 -p "secret"

# Test JKU injection
jwt_tool.py <token> -X u -pk attacker-jwks.pem -S RS256
```

## OAuth Testing

### Redirect URI Bypass

1. **Exact match bypass**: If server uses prefix matching, try:
   - `https://app.com/callback` → `https://app.com/callback/../admin`
   - `https://app.com/callback` → `https://app.com/callback?extra=/admin`
   - `https://app.com/callback` → `https://app.com/callback/` (trailing slash)
2. **Subdomain wildcard**: If server allows `*.app.com`:
   - Register `evil-app.com` or use `attacker.app.com`
   - Test `https://attacker.app.com/callback`
3. **Protocol confusion**: Test `http://app.com/callback` when `https://app.com/callback` is registered
4. **Domain confusion**: `https://app.com.evil.com` (subdomain of attacker domain)
5. **Port manipulation**: `https://app.com:443/callback` vs `https://app.com:8443/callback`
6. **Fragment bypass**: `https://app.com/callback#evil` — some servers strip fragments before comparison
7. **Open redirect chain**: `https://app.com/callback → /login?next=https://evil.com` → if the IdP follows the redirect, the auth code goes to attacker

### CSRF in OAuth Flow

1. Check if the OAuth flow uses `state` parameter:
   - No `state` → CSRF vulnerability: attacker can initiate a login with their account, link it to victim's session
   - `state` present but static/predictable → same issue
2. Test: Intercept the OAuth authorize URL, remove the `state` parameter, complete the flow. If it succeeds → CSRF present
3. Check if `state` is validated on callback (not just present)
4. **Login CSRF**: Register an attacker account with victim's email → victim logs in → attacker's account linked to victim

### Scope Escalation

1. Intercept the authorization request and modify `scope` parameter:
   - `openid profile` → `openid profile email admin api:write`
   - Add scopes not requested originally
2. Check if the token response includes all requested scopes or only what was authorized
3. Test with over-requested scopes: `scope=read write admin delete`
4. Check if scope validation happens server-side (token introspection) or if the client trusts the token's scope claim
5. If the authorization server has a scope approval page, check if modifying scope post-approval affects the token

### Authorization Code Interception

1. **Code replay**: Use the same authorization code twice — first exchange should work, second should fail
2. **Code injection**: Modify the `code` parameter in the callback before token exchange
3. **Code fixation**: Force a specific code value into the flow (if server accepts client-provided codes)
4. **PKCE bypass**: If PKCE is not enforced:
   - Steal the authorization code and exchange it without the code_verifier
   - If PKCE is enforced but weak (e.g., short code_verifier), test brute force
5. **Redirect interception**: Capture the code from the redirect URL (it's in the query string)

### Token Leakage via Referrer

1. Check if tokens appear in URLs (query parameters):
   - `https://app.com/callback?access_token=xyz`
   - If a page includes an external link or image, the token leaks via Referer header
2. Check if the callback URL retains the token after exchange
3. Test: Load a page that has an external `<img>` or `<a>` tag, check if Referer header contains the token
4. Check for tokens in JavaScript-accessible storage: `localStorage`, `sessionStorage`, `document.cookie`
5. Check for tokens in browser history (URL bar)

## IDOR Automation

### Pattern Recognition

IDOR typically appears in these parameter patterns:

- **Path parameters**: `/api/users/12345` → change `12345` to `12346`
- **Query parameters**: `?user_id=abc` → change to `?user_id=def`
- **Request body**: `{"id": 100}` → `{"id": 101}`
- **Headers**: `X-User-Id: 100` → `X-User-Id: 101`
- **Encoded values**: UUID (`550e8400-e29b...`), numeric ID, base64-encoded ID
- **Composite keys**: `?file=user1/document.pdf` → `?file=user2/document.pdf`

### IDOR Test Protocol

1. Authenticate as User A, capture request/response
2. Note all object references: URLs, params, body fields, headers
3. Authenticate as User B
4. Replay User A's request with User B's session
5. If User A's data appears → Horizontal IDOR
6. Repeat for admin endpoints with User A's session → Vertical IDOR

### Bulk IDOR Enumeration

1. Capture a request that lists objects: `/api/users/12345/orders`
2. Extract the object ID pattern (numeric: iterate ±100; UUID: note the format)
3. Automate with a loop:
   - For numeric IDs: iterate from `id-100` to `id+100`
   - For UUIDs: capture UUIDs from another endpoint (e.g., user list) and replay
4. Check response differences:
   - 200 with data → IDOR
   - 403 with same-length response → access control present (good)
   - 404 → ID doesn't exist (not IDOR)
   - Different response size → possible data leak

### IDOR via API Versioning

1. Test `/api/v1/users/123` → `/api/v2/users/123` (newer version may skip auth checks)
2. Test `/api/internal/users/123` vs `/api/public/users/123`
3. Test with different `Accept` headers:
   - `Accept: application/json` vs `Accept: text/html` — different versions may have different auth
4. Test with `X-API-Version: 1` header — version via header may bypass path-based checks

### Parameter Pollution

1. Submit the same parameter twice:
   - `?user_id=attacker&user_id=victim` — server may use the first or last
   - Some servers use the first occurrence (attacker's), some use the last (victim's)
2. Test in different positions:
   - Query string: `?id=1&id=2`
   - Body (form): `id=1&id=2`
   - Headers: duplicate header values
3. Check if the authorization check uses one value while the data retrieval uses another

## RBAC Testing Protocol

### Role Matrix

For each endpoint, test with every role:
| Endpoint | Guest | User | Moderator | Admin |
|----------|-------|------|-----------|-------|
| /api/public | ? | ? | ? | ? |
| /api/users/me | ? | ? | ? | ? |
| /api/admin/users | ? | ? | ? | ? |
| /api/admin/settings | ? | ? | ? | ? |

### Test Commands

1. **Get captured headers for each role**:
   ```
   getCapturedHeaders → target URL + role="guest"
   getCapturedHeaders → target URL + role="user"
   getCapturedHeaders → target URL + role="admin"
   ```
2. **Send the same request with each role's headers**:
   ```
   httpRequest → same URL, headers from User role
   httpRequest → same URL, headers from Admin role
   httpRequest → same URL, no auth headers
   ```
3. **Compare responses**:
   - Status code: 200 vs 403 vs 401
   - Response body: different data or same generic content
   - Response size: admin response larger → likely different data access

### Privilege Escalation Vectors

1. **Function-level**: User can call `/api/admin/create-user` even though UI hides the button
2. **Object-level**: User A can modify User B's profile by changing `user_id` in the request
3. **Multi-step**: Step 1 requires auth, Step 2 doesn't recheck — manipulate step 2 with elevated role
4. **Parameter manipulation**: Change `"role": "user"` → `"role": "admin"` in profile update request
5. **HTTP method confusion**: `GET /api/admin/users` returns 403, but `POST /api/admin/users` with JSON body bypasses
6. **Batch operations**: Submit multiple operations in one request — admin ops mixed with user ops may not be individually checked

### Method-Based Access Control

1. Test each endpoint with different HTTP methods:
   - `GET /api/users` → 403
   - `POST /api/users` → 200 (create user — no auth check)
   - `PUT /api/users/123` → 200 (update — no auth check)
   - `DELETE /api/users/123` → 200 (delete — no auth check)
2. Use `OPTIONS` to discover supported methods
3. Test `PATCH`, `HEAD`, `TRACE` — less common methods may skip auth middleware

## Session Management Testing

### Session Fixation

1. Request a session ID before login (unauthenticated request)
2. Log in with valid credentials
3. Check if the session ID changed after login:
   - Same session ID → Session Fixation vulnerability
   - Different session ID → Session regenerated (secure)
4. If vulnerable: set the known session ID as a cookie before victim logs in → hijack their session

### Session Timeout

1. Log in and note the session token and timestamp
2. Wait for the server's idle timeout (typically 15-30 min)
3. Make a request after the timeout — does it return 401?
4. Test **absolute timeout**: remain active (send requests every minute) but reach the max session duration (e.g., 8 hours) — does the server enforce?
5. Check if the token itself contains expiry (`exp` claim in JWT) — is it enforced server-side?

### Concurrent Sessions

1. Log in from two different browsers/locations with the same credentials
2. Check if both sessions are active simultaneously
3. Test if logout from one session invalidates the other
4. Test if the server enforces a maximum number of concurrent sessions
5. Check if new login invalidates old sessions (should be optional but recommended)

### Session Invalidation on Logout

1. Log in, capture the session token
2. Log out
3. Replay the old session token in a request
4. If the server accepts it → Session Invalidation failure
5. Check both frontend (cookie removal) and backend (token revocation)
6. For JWT: check if the token is blacklisted/revoked server-side or simply discarded client-side

### Token Storage Analysis

1. Check where tokens are stored client-side:
   - `localStorage` → XSS can steal it
   - `sessionStorage` → XSS can steal it (but not persist across tabs)
   - `document.cookie` → XSS can steal it (check `HttpOnly` flag)
   - In-memory JavaScript variable → harder to extract but still vulnerable to DOM XSS
2. Check for tokens in URL query parameters → Referer leakage
3. Check for tokens in browser history
4. Check for tokens cached by the browser or proxy

## Forced Browsing

1. **Directory traversal**: Access known-sensitive paths directly without authentication:
   - `/admin`, `/dashboard`, `/internal`, `/debug`, `/api/`, `/swagger`, `/graphql`
   - `/admin/users`, `/admin/config`, `/admin/logs`
   - `/.env`, `/config.json`, `/package.json`, `/wp-config.php.bak`
2. **Direct URL access**: If the app requires login but has predictable URLs:
   - Try `/dashboard` after logging out
   - Try `/user/profile?id=1` with no session
   - Try `/api/users` with no auth header
3. **Path fuzzing**: Use wordlists to discover hidden paths:
   - Common admin paths: `/administrator`, `/admin.php`, `/cpanel`, `/phpmyadmin`
   - API docs: `/swagger.json`, `/openapi.json`, `/api-docs`, `/graphql`
   - Backup files: `/backup.zip`, `/db.sql`, `/dump.sql`
4. **Response comparison**: Compare authenticated vs unauthenticated responses:
   - Same 200 response with same body → forced browsing works
   - 200 but body is a redirect/JS → client-side auth only (bypassable)
   - 403 vs 404 → check which is returned for non-existent paths to determine which means "exists but forbidden"
5. **Framework-specific paths**:
   - Next.js: `/_next/data/`, `/api/` routes, `/__nextjs_original_stack_frames`
   - React/Angular: `/static/js/`, `/chunk-vendors.js` — may contain hardcoded routes
   - Spring Boot: `/actuator/env`, `/actuator/health`, `/swagger-ui.html`

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

## Trigger Conditions

Activate on any endpoint returning user-specific data, admin panels/dashboards, API object-ID endpoints, or apps using JWT/OAuth2/SAML/session cookies — especially after capturing traffic from users with different roles. Trigger for IDOR, broken object/function-level access control, privilege escalation, and session-management flaws. Do not trigger on static assets, explicitly public endpoints, or when you have zero authenticated sessions (obtain one first).

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
