---
name: security-headers-audit
domain: web-attacks
category: web-attacks
tier: balanced
description: Audit HTTP responses for missing or misconfigured security headers (CSP, HSTS, framing, content-type, referrer, permissions) and insecure cookie flags.
toolRefs:
  - httpRequest
  - parseResponse
  - getCapturedHeaders
  - recordEvidence
  - writeFinding
  - getTargetSummary
triggers:
  - security headers audit
  - csp hsts missing check
  - cookie flags secure flag
  - http response header review
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1185
  - T1078
owaspRefs:
  - A05:2021
---

# Security Headers & Cookie Flags Audit

## When to Use
Use on any HTTP response surface to verify defensive headers and cookie attributes. Trigger on requests to harden-review a site, confirm clickjacking/XSS/downgrade protections, or validate session-cookie hygiene.

## Detection Approach
1. **Capture raw headers.** Fetch the target's primary response and any auth/set-cookie responses via `getCapturedHeaders`; do not rely on rendered output.

```bash
# Capture full response headers on the landing page
curl -sSI https://target.com/

# Capture headers on the login flow (Set-Cookie lives here)
curl -sSI https://target.com/login

# Follow redirects and inspect every hop — HSTS must be sent on each
curl -sS -D - -o /dev/null -L https://target.com/

# Compare an authenticated API route — headers often differ from the SPA shell
curl -sS -D - -o /dev/null https://target.com/api/v1/me -H "Authorization: Bearer <token>"

# Check HSTS on subdomains and the bare HTTP origin
curl -sSI http://target.com/
curl -sSI https://api.target.com/
```

2. **Check each header's presence and value:**
   - `Content-Security-Policy` — present and not `unsafe-inline`/`unsafe-eval` broadly; no `*` in sensitive directives.
   - `Strict-Transport-Security` — present with `max-age` and ideally `includeSubDomains`/`preload`.
   - `X-Frame-Options` or CSP `frame-ancestors` — to block clickjacking.
   - `X-Content-Type-Options: nosniff` — to stop MIME sniffing.
   - `Referrer-Policy` — restrictive (e.g. `no-referrer`, `same-origin`).
   - `Permissions-Policy` — limits powerful features.

   **Weak / dangerous policy examples to flag:**

```http
# Weak CSP: allows inline script + wildcard sources — effectively no XSS protection
Content-Security-Policy: default-src * 'unsafe-inline' 'unsafe-eval'

# CSP present but report-only — never enforced
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report

# HSTS too short and missing subdomains — SSL-stripping still viable on api.target.com
Strict-Transport-Security: max-age=300

# Framing blocked only for this origin's top path — clickjacking open elsewhere
X-Frame-Options: ALLOW-FROM https://trusted-partner.example

# Missing nosniff combined with user-controlled upload = stored XSS via MIME confusion
X-Content-Type-Options:

# Permissive referrer leak — tokens in query strings sent cross-origin
Referrer-Policy: unsafe-url

# Powerful features granted to everyone
Permissions-Policy: camera=*, microphone=*, geolocation=*
```

3. **Audit cookies.** For every `Set-Cookie`, confirm `Secure`, `HttpOnly`, `SameSite` (Lax/Strict), and `Path`/`Domain` scoping. Flag missing `Secure`/`HttpOnly`.

```http
# BAD: session cookie without Secure, HttpOnly, or SameSite — stealable via XSS + sent over HTTP
Set-Cookie: session=abc123; Path=/

# BAD: overly broad Domain scope — any subdomain (incl. compromised ones) receives it
Set-Cookie: session=abc123; Domain=.target.com; Path=/

# GOOD reference shape
Set-Cookie: session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax

# BAD: SameSite=None without Secure — browsers reject it, and if honored, full CSRF exposure
Set-Cookie: cart=x; SameSite=None
```

4. **Test enforceability.** For HSTS/CSP, confirm the header is sent on all relevant hosts/redirects, not just the landing page.
5. **Switch logic.** If headers are absent on one route but present on others, probe consistency across auth flows. If present but misvalued, document the specific weakness.

```bash
# Automated sweep with a well-known auditor (read-only checks)
nmap --script http-security-headers -p 443 target.com

# Diff header sets between routes to find inconsistent enforcement
for p in / /login /api/v1/me /admin /static/app.js; do
  echo "== $p =="; curl -sSI "https://target.com$p" | grep -Ei 'content-security|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|set-cookie';
done
```

## Pitfalls
- Checking only the homepage — auth and API responses often differ.
- Treating CSP presence as strength without reading directives.
- Missing `SameSite` cookie gaps that enable CSRF.
- Confusing report-only CSP with enforcing CSP.

## Verification & Impact
- **Confirmed:** A protective header is absent or a cookie lacks `Secure`/`HttpOnly` on a security-relevant flow.
- **Suspected:** Header present but weakly valued.
- Document each missing/misconfigured header and the associated risk (clickjacking, MIME sniff, SSL strip, cookie theft). Use `writeFinding` with captured header evidence.

When framing protections are absent, prove clickjacking is possible with a minimal frame wrapper:

```html
<!-- Clickjacking PoC: loads target over a decoy button -->
<div style="position:relative; width:300px; height:60px; overflow:hidden">
  <div style="position:absolute; top:0; left:0; z-index:2">Win a prize — Click!</div>
  <iframe src="https://target.com/settings/delete-account"
          style="position:absolute; top:-40px; left:-100px; opacity:0.0001;
                 width:800px; height:600px; z-index:1"></iframe>
</div>
```

## Key Concepts
| Term | Meaning |
|------|---------|
| CSP | Content Security Policy |
| HSTS | HTTP Strict Transport Security |
| nosniff | Blocks MIME-type sniffing |
| SameSite | Cookie cross-site sending policy |
