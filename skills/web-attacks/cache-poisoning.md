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

## 2. Auth Context

### Cache Poisoning Authentication Requirements:
- **Anonymous pages** (homepage, search, public product pages): Full cache poisoning surface — any visitor can poison and any visitor receives poisoned content
- **Authenticated pages**: Cache poisoning only affects users with matching `Cookie` or `Authorization` if those headers are part of cache key. If they are NOT keyed, poisoning affects all users including authenticated ones — high impact
- **Login-required content**: Typically not cached. If it IS cached, it's a critical misconfiguration exposing PII via cache poisoning
- **CDN-level auth**: Some CDNs cache authenticated content (API responses, personalized pages). Check if `Authorization` is in the cache key. If not, poisoned cached responses can leak tokens or session data

### Auth-Aware Poisoning Strategy:

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

## 4. Unkeyed Headers

### Commonly Unkeyed Headers:

**`X-Forwarded-Host`** — Poisons cache with attacker-controlled Host header:

**`X-Original-URL`** / **`X-Rewrite-URL`** — Access restricted paths:

**`X-HTTP-Method-Override`** — Change request semantics:

**`X-Forwarded-For`** — IP-based cache key bypass:

### Unkeyed Header Discovery Methodology:
1. Send request, note response headers and body
2. Add `X-Forwarded-Host: evil.com`, resend
3. Compare responses — if body differs, header is unkeyed and affects backend
4. Check if new response is cached (send original request again, compare)
5. Repeat for `X-Original-URL`, `X-Rewrite-URL`, `X-HTTP-Method-Override`, `X-Forwarded-For`, `X-Original-Remote-Addr`

## 5. Parameter Cloaking

### Semicolon Cloaking Technique:
When cache uses query string splitting on `&` but backend splits on `;`:

### Fragment Cloaking:

### Parameter Pollution as Cloaking:

### Path Parameter Cloaking:

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

### HTTP/1.0 Smuggling:

### Fat GET Detection:
1. Send POST with body that triggers different behavior than GET
2. Convert to GET with same body content
3. Check if response differs (backend processed body)
4. Check if response is cached (X-Cache: HIT on second request)
5. Verify Fat GET affects cache key correctly

### Fat GET to XSS:

## 7. Normalization Bypass

### Case Normalization Differences:

### Encoding Normalization:

### Path Normalization:

### Host Normalization:

### Normalization Bypass Strategy:
1. Test case variations on URL path: `/admin`, `/Admin`, `/ADMIN`
2. Test encoding variations: `%2e`, `%2E`, `.` (dot), `%2f`, `/`
3. Test path parameters: `/page;1`, `/page;param=value`
4. Compare cache keys (timing analysis) with backend behavior (response content)
5. Find normalization discrepancy → poison cache with alternate form

## 8. Vary Header Bypass

### Vary Header Basics:

### Vary Header Exploitation:

**Vary: Accept-Encoding — Compression Mismatch:**

**Vary: User-Agent — Browser-Specific Poisoning:**

**Vary: Cookie — Auth Bypass via Cache:**

### Vary Header Fingerprinting:
1. Send request, note `Vary` header in response
2. Re-send with modified value for each Vary-listed header
3. Compare `X-Cache` status: MISS = that header is in cache key
4. If MISS does not occur → header listed in Vary but NOT in cache key (vulnerability)
5. Exploit gap between declared Vary and actual cache key composition

## 9. Cache Deception

### Path Confusion:

### Path Confusion Variants:

**Leading Dot Confusion:**

**Null Byte Injection:**

**URL Parameter Confusion:**

**Double Extension:**

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

**Step 2: Test cacheability of reflected request**

**Step 3: Identify unkeyed input for cache key manipulation**

**Step 4: Verify poisoning persistence**

### XSS via Cache Poisoning — Advanced Vectors:

**JSONP Endpoint Poisoning:**

**CSS-Based XSS via Cache:**

## 11. Cache Poisoning DoS

### Redirect Loop Poisoning:

### Error Page Poisoning:

### Resource Exhaustion via Cache:

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

### Evidence Capture Commands:

## Trigger Conditions

Activate when the target sits behind a caching layer — CDN/reverse proxy indicated by `X-Cache`, `CF-Cache-Status`, `X-Varnish`, `Age`, `Via`, or `Server` headers — and reflects request input (params, headers, cookies) into responses. Strong signals: `Cache-Control`/`ETag`/`Expires` on user-facing pages, `Vary` headers with possible key/backend mismatch, or reflected XSS/header-injection reachable via cache. Also trigger for cache deception (sensitive content served under asset-like paths). Do not trigger with no caching layer, consistent `no-store`/`no-cache`, or cache keys that encompass all distinguishing inputs.

## Detection Approach

First confirm caching is active via timing/header analysis (repeat a request with a unique unkeyed param: first MISS/Age:0, then HIT/Age>0). Then map the cache key: vary query params and headers (`X-Forwarded-Host`, `Accept-Language`, `User-Agent`, `X-Original-URL`) one at a time and observe whether a second clean request returns the modified response — if so, that input is unkeyed. Look for normalization discrepancies (case/encoding/path) between cache key and backend, and `Vary` declarations not actually enforced in the key. Only after a real reflection+unkeyed input is found, craft a poisoned response (XSS, redirect, error) and verify it persists: a *separate, clean* request must receive the poisoned content. Confirm blast radius by testing from a different context (IP/UA). Reserve DoS only for explicit scope.

## Pitfalls

- Claiming "poisoned" from `X-Cache: HIT` alone — that only proves caching, not that your content is served to others.
- Calling a header "unkeyed" from a single request — require ≥3 comparisons (with/without) showing the key excludes it.
- Assuming all users are affected — CDNs may segment cache by geo/client; verify across contexts.
- Guessing the CDN without its identifying header (`Server: cloudflare`, `X-Varnish`).
- Conflating parameter cloaking/Fat GET success without confirming the GET response is actually cached.
- Treating a cached 200 as proof of error-page or deception caching — test the specific condition.

## Verification & Impact

CONFIRMED when a clean follow-up request (no attack params) returns your poisoned content with a cache HIT, ideally reproduced from a different client context, and impact is demonstrated (XSS fires, redirect to attacker, sensitive data in cached asset). SUSPECTED when caching is present and an input looks unkeyed but persistence isn't reproduced — record as candidate. Document impact by what the poisoned cache delivers (mass XSS, credential/token theft, redirect/phishing, info disclosure) and the affected URL scope. Capture original, poisoned, and clean-follow-up exchanges via `recordEvidence`.
