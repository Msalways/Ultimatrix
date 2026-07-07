---
name: hsts-bypass
description: "HSTS (HTTP Strict Transport Security) bypass techniques including downgrade attacks and subdomain issues"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["hsts bypass", "strict transport security", "https downgrade", "hsts preloading", "ssl stripping", "hsts header", "transport security", "downgrade attack", "hsts bypass technique"]
contextBoosts: [endpoints]
mitreAttack: ["T1557", "T1559"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# HSTS Bypass

## When to Use

- Target sends `Strict-Transport-Security` header and you need to find bypass vectors
- Auditing whether HSTS implementation is actually effective
- Checking if subdomains, preloading, or cookie handling weaken the policy
- Verifying that first-visit connections are protected (or not)
- Assessing mixed-content or downgrade attack surfaces

## Do Not Use

- Target has no HSTS header at all (nothing to bypass — report as missing HSTS instead)
- HSTS preload list with `max-age >= 31536000`, `includeSubDomains`, and `preload` on the apex domain — preloaded domains are bypass-resistant at the browser level
- Target is a mobile app or API-only service (HSTS is a browser mechanism)

## Auth Context

HSTS bypass is most impactful when:
- User is authenticated over HTTPS and cookies lack the `Secure` flag
- Login page is served over HTTP first, then redirects to HTTPS
- Subdomains hold sensitive content (admin panels, APIs, staging)
- The application serves mixed content (HTTP resources on HTTPS pages)

---

## HSTS Detection

### Header Inspection

Check for the `Strict-Transport-Security` header on every HTTPS response:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Required fields to check:**

| Directive | Meaning | Risk if Missing |
|-----------|---------|-----------------|
| `max-age` | Seconds HSTS policy is cached | If absent, policy is ignored by browsers |
| `includeSubDomains` | Applies policy to all subdomains | Subdomains can be accessed over HTTP |
| `preload` | Eligible for browser preload lists | Not preloaded means first visit is unprotected |

### Detection Method

```
httpRequest(method="HEAD", url="https://TARGET/")
parseResponse → extract Strict-Transport-Security header
```

If the header is absent on the initial HTTPS response, HSTS is not enforced and there is nothing to bypass. Report it as a missing HSTS configuration issue instead.

If the header is present, proceed with the bypass techniques below.

---

## First Visit Downgrade

### Concept

HSTS only takes effect **after** the browser receives and caches the header. On the very first visit, the browser has no cached policy and will happily connect over HTTP if the server responds on port 80.

### Attack Window

```
User clicks http://TARGET/
  → Browser sends HTTP request (no cached HSTS)
  → Attacker intercepts (MITM, DNS hijack, BGP)
  → Server responds on HTTP (no redirect yet)
  → Session cookie transmitted in cleartext
  → Attacker captures cookie
  → User eventually reaches HTTPS, HSTS header cached
  → Too late — session already stolen
```

### Testing

1. Use a fresh browser profile (no cached HSTS state)
2. Make an HTTP request to the target before any HTTPS visit
3. Check if the server responds with content or a redirect on port 80
4. If content is served over HTTP on the first request, the downgrade window exists

```
httpRequest(method="GET", url="http://TARGET/")
parseResponse → check for 200 OK (vulnerable) vs redirect to HTTPS (safe)
```

### Mitigation Note

Preloaded domains are immune because the browser knows the HSTS policy before the first request. Without preloading, this window always exists.

---

## Subdomain HSTS Bypass

### Concept

If the `Strict-Transport-Security` header lacks the `includeSubDomains` directive, subdomains are not covered by the policy. An attacker can force connections to subdomains over plain HTTP.

### Attack Vectors

1. **Subdomain not receiving HSTS header** — Even if the apex has HSTS, a subdomain like `api.TARGET.com` may not send the header. The browser won't enforce HSTS for it.

2. **DNS subdomain takeover** — If a subdomain points to an external service (CNAME, Heroku, GitHub Pages) that is no longer active, an attacker can claim it and serve HTTP content.

3. **Internal subdomains** — Intranet subdomains (`admin.internal.TARGET.com`) are often excluded from HSTS and may only be accessible over HTTP.

### Testing

```
For each discovered subdomain:
  httpRequest(method="GET", url="https://SUBDOMAIN.TARGET.com/")
  parseResponse → check for Strict-Transport-Security header

  httpRequest(method="GET", url="http://SUBDOMAIN.TARGET.com/")
  parseResponse → check if HTTP content is served (not redirected)
```

If any subdomain serves content over HTTP without redirecting to HTTPS, it is a bypass vector.

### Subdomain Takeover Check

```
For each subdomain with a dangling CNAME:
  Check if the external service (Heroku, GitHub Pages, Azure) allows claiming
  If claimable → report as subdomain takeover leading to HSTS bypass
```

---

## Preload List Issues

### Concept

The HSTS preload list is a hardcoded list of domains in browsers (Chrome, Firefox, Safari). A domain must meet **all** criteria to be preloaded:

1. `max-age >= 31536000` (1 year)
2. `includeSubDomains` present
3. `preload` directive present
4. Redirect from HTTP to HTTPS
5. Serve HSTS header on the HTTPS response

### Common Weaknesses

| Issue | Impact |
|-------|--------|
| `preload` directive missing | Domain not submitted to preload list |
| `max-age` below 31536000 | Rejected by preload submission |
| Subdomain not explicitly added | Subdomain not in preload list even if apex is |
| Non-standard port (8443, 4443) | Preload only works on standard port 443 |
| Internal domains excluded | Internal domains cannot be preloaded — always vulnerable |

### Testing

1. Check the preload status at `https://hstspreload.org/?domain=TARGET.com`
2. Verify all preload requirements are met in the actual HTTP response
3. Check subdomains — the apex being preloaded does not cover subdomains unless they are also in the preload list

```
httpRequest(method="GET", url="https://TARGET.com/")
parseResponse → verify max-age >= 31536000, includeSubDomains, preload
```

---

## SSL Stripping

### Concept

SSL stripping is an active attack where a MITM attacker intercepts the initial HTTP request and modifies the response to:

1. Remove HTTPS links and replace with HTTP
2. Remove the `Strict-Transport-Security` header from the response
3. Proxy all requests to the real server over HTTPS, but serve the client over HTTP

### Attack Flow

```
User → http://TARGET.com (HTTP)
  → Attacker intercepts
  → Attacker connects to TARGET.com over HTTPS
  → Target returns HSTS header → Attacker STRIPS it
  → Attacker serves content to user over HTTP
  → All user data visible in cleartext
```

### Tools for SSL Stripping

- `sslstrip` — Classic tool for HTTP downgrade
- `mitmproxy` with sslstrip addon
- Custom proxy that removes HSTS headers from responses

### Detection Indicators

- HTTP links present in the page that should be HTTPS
- Mixed content warnings in browser console
- Login form action pointing to HTTP endpoint
- No redirect from HTTP to HTTPS on the initial connection

### Testing

```
httpRequest(method="GET", url="http://TARGET.com/")
parseResponse → check:
  1. Is content served over HTTP? (200 OK, not redirect)
  2. Are links in the response HTTP instead of HTTPS?
  3. Is there a login form with an HTTP action?
```

---

## HSTS Caching Attack

### Concept

HSTS policies are cached by the browser for the duration of `max-age`. An attacker with access to the browser profile can manipulate the cache:

1. **Clear HSTS cache** — Remove all cached HSTS policies, resetting the first-visit window
2. **Override HSTS** — Some browsers allow manual HSTS overrides (e.g., `chrome://net-internals/#hsts`)
3. **Session reset** — Force a fresh profile with no cached policies

### Browser-Specific HSTS Cache Locations

| Browser | Platform | Cache Location |
|---------|----------|----------------|
| Chrome | Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Preloads` |
| Chrome | macOS | `~/Library/Application Support/Google/Chrome/Default/Preloads` |
| Firefox | All | `cert9.db` in Firefox profile directory |
| Safari | macOS | `~/Library/Cookies/HSTS.plist` |

### Testing

Use a fresh browser profile or clear the HSTS cache before testing:

```
# Chrome: clear HSTS cache
# Navigate to chrome://net-internals/#hsts
# Delete domain security policies for TARGET.com

# Then test:
httpRequest(method="GET", url="http://TARGET.com/")
parseResponse → check if HTTP content is served
```

---

## Cookie-based Downgrade

### Concept

If session cookies lack the `Secure` flag, they will be transmitted over HTTP connections. Combined with an HSTS bypass, this allows session hijacking.

### Attack Chain

1. User authenticates over HTTPS
2. Session cookie is set without `Secure` flag
3. Attacker triggers HTTP connection (first-visit, subdomain, DNS hijack)
4. Browser sends session cookie over HTTP
5. Attacker captures the cookie

### Testing

```
httpRequest(method="GET", url="https://TARGET.com/login")
parseResponse → extract Set-Cookie headers
check each cookie for:
  - Secure flag (required for HTTPS-only cookies)
  - HttpOnly flag (prevents JavaScript access)
  - SameSite attribute (prevents CSRF)
```

If any session cookie lacks `Secure`, it is vulnerable to downgrade-based theft.

### Cookie Flags to Check

| Flag | Required | Risk if Missing |
|------|----------|-----------------|
| `Secure` | Yes | Cookie sent over HTTP |
| `HttpOnly` | Yes | Cookie accessible via XSS |
| `SameSite=Strict` | Recommended | Cookie sent in cross-origin requests |

---

## Testing Methodology

### Step 1: Header Analysis

```
httpRequest(method="GET", url="https://TARGET.com/")
parseResponse → extract all security headers
  - Strict-Transport-Security (value, directives)
  - Content-Security-Policy (upgrade-insecure-requests)
  - X-Content-Type-Options
  - Set-Cookie (Secure, HttpOnly, SameSite flags)
```

### Step 2: HTTP Response Check

```
httpRequest(method="GET", url="http://TARGET.com/")
parseResponse → check:
  - Status code (200 = vulnerable, 301/302 redirect = partially safe)
  - Is the redirect to HTTPS? Or to HTTP?
  - Is content served before redirect?
```

### Step 3: Subdomain Enumeration

```
For each subdomain:
  httpRequest(method="GET", url="https://SUB.TARGET.com/")
  parseResponse → check for HSTS header

  httpRequest(method="GET", url="http://SUB.TARGET.com/")
  parseResponse → check for HTTP content
```

### Step 4: Preload Verification

```
Check https://hstspreload.org/?domain=TARGET.com
Verify all preload requirements in actual response headers
Check if subdomains are individually preloaded
```

### Step 5: Cookie Analysis

```
For authenticated sessions:
  Extract all Set-Cookie headers
  Check each for Secure, HttpOnly, SameSite flags
  Identify cookies that would be sent over HTTP
```

### Step 6: Document Findings

```
writeFinding({
  type: "hsts-bypass",
  severity: "high" | "medium" | "low",
  title: "HSTS bypass via [technique]",
  description: "Detailed description of the bypass",
  evidence: "HTTP response showing missing HSTS or HTTP content",
  recommendation: "How to fix the issue"
})

recordEvidence({
  type: "http-response",
  data: <response>,
  context: "HSTS bypass testing"
})
```

### Tools for Manual Testing

- `curl -I http://TARGET.com` — Check HTTP response headers
- `curl -I https://TARGET.com` — Check HTTPS response headers and HSTS
- Browser DevTools → Network tab → filter by HSTS header
- `hsts-primer` — Tool to force HSTS preload for testing
- `chrome://net-internals/#hsts` — View and clear HSTS cache in Chrome
- `openssl s_client -connect TARGET.com:443` — Check TLS configuration

---

## Anti-Hallucination

**Every claim about HSTS must be backed by an actual HTTP response.**

- Do NOT claim a header is missing without making the request and parsing the response
- Do NOT claim a subdomain is vulnerable without testing both HTTP and HTTPS
- Do NOT claim preloading is effective without checking the preload list
- Do NOT assume cookie flags without extracting Set-Cookie headers from a real response
- Do NOT infer HSTS status from documentation or configuration files — test the live endpoint

**Required evidence for each finding:**
1. The raw HTTP request sent (method, URL)
2. The raw HTTP response received (status line, headers, body excerpt)
3. The specific header or flag that indicates the vulnerability
4. A clear explanation of why the finding constitutes an HSTS bypass

**What NOT to do:**
- Do not guess about `max-age` values without reading the actual header
- Do not assume `includeSubDomains` is present without verifying
- Do not claim preload eligibility without checking all 5 requirements
- Do not report findings based on browser behavior you cannot reproduce
