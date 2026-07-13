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
2. **Check each header's presence and value:**
   - `Content-Security-Policy` — present and not `unsafe-inline`/`unsafe-eval` broadly; no `*` in sensitive directives.
   - `Strict-Transport-Security` — present with `max-age` and ideally `includeSubDomains`/`preload`.
   - `X-Frame-Options` or CSP `frame-ancestors` — to block clickjacking.
   - `X-Content-Type-Options: nosniff` — to stop MIME sniffing.
   - `Referrer-Policy` — restrictive (e.g. `no-referrer`, `same-origin`).
   - `Permissions-Policy` — limits powerful features.
3. **Audit cookies.** For every `Set-Cookie`, confirm `Secure`, `HttpOnly`, `SameSite` (Lax/Strict), and `Path`/`Domain` scoping. Flag missing `Secure`/`HttpOnly`.
4. **Test enforceability.** For HSTS/CSP, confirm the header is sent on all relevant hosts/redirects, not just the landing page.
5. **Switch logic.** If headers are absent on one route but present on others, probe consistency across auth flows. If present but misvalued, document the specific weakness.

## Pitfalls
- Checking only the homepage — auth and API responses often differ.
- Treating CSP presence as strength without reading directives.
- Missing `SameSite` cookie gaps that enable CSRF.
- Confusing report-only CSP with enforcing CSP.

## Verification & Impact
- **Confirmed:** A protective header is absent or a cookie lacks `Secure`/`HttpOnly` on a security-relevant flow.
- **Suspected:** Header present but weakly valued.
- Document each missing/misconfigured header and the associated risk (clickjacking, MIME sniff, SSL strip, cookie theft). Use `writeFinding` with captured header evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| CSP | Content Security Policy |
| HSTS | HTTP Strict Transport Security |
| nosniff | Blocks MIME-type sniffing |
| SameSite | Cookie cross-site sending policy |
