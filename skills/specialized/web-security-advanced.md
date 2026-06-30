---
name: web-security-advanced
description: "Advanced web attacks including CSP bypass, CORS misconfig, subdomain takeover, and DNS rebinding"
category: specialized
toolRefs: [httpRequest, parseResponse, evaluateRendered, checkWaf, omitHeader, findEndpointsInResponse, updateGraph, writeFinding]
---

# Advanced Web Security

## Description
Beyond standard web vulnerabilities lies a layer of advanced attack techniques targeting infrastructure, trust mechanisms, and browser security models. This skill covers CSP analysis, CORS misconfigurations, subdomain takeover, DNS rebinding, and prototype pollution.

## Methodology
1. **Analyze Content Security Policy** — Parse the CSP header. Identify unsafe-inline, unsafe-eval, overly broad script-src, and missing directives. Determine if the CSP can be bypassed through existing allowed origins.
2. **Test CORS Configuration** — Send requests with various Origin headers. Check if the server reflects arbitrary origins with credentials. Test for null origin, subdomain matching, and preflight bypass.
3. **Check for Subdomain Takeover** — Enumerate subdomains. Identify those pointing to external services (AWS S3, GitHub Pages, Heroku) with unclaimed resources. Verify CNAME records and HTTP responses.
4. **Test for DNS Rebinding** — Can you make the browser resolve a hostname to an internal IP after passing same-origin checks? Test with DNS that alternates between public and private IPs.
5. **Audit JavaScript Dependencies** — Check for prototype pollution vulnerabilities in client-side libraries. Test object merging functions with __proto__ and constructor properties.

## Key Concepts
- **CSP as Defense-in-Depth**: A strong CSP limits XSS impact but is often misconfigured with bypasses
- **CORS Trust Boundaries**: The Same-Origin Policy is the browser's security model — CORS misconfigurations break it
- **Subdomain as Attack Surface**: Every forgotten subdomain is a potential entry point or trust abuse vector
- **DNS Rebinding**: Bypassing network boundaries by making DNS names resolve to internal IPs
- **Prototype Pollution**: Client-side code injection through JavaScript object manipulation

## Evidence to Collect
- Full CSP header with analysis of each directive
- CORS test results showing reflected origins with credentials
- Subdomain takeover proof (HTTP response showing unclaimed resource)
- DNS rebinding proof (accessing internal service through browser)
- Prototype pollution PoC (object property injection in page context)

## Common Pitfalls
- Assuming CSP is effective without checking for bypasses
- Not testing CORS with credentials (Access-Control-Allow-Credentials)
- Forgetting to check wildcard subdomains and parked domains
- Ignoring DNS TTL and caching when testing rebinding
- Not verifying subdomain takeover with actual content control

## References
- OWASP Content Security Policy Cheat Sheet
- OWASP Testing for CORS Misconfiguration
- PortSwigger Research — DNS Rebinding
- OWASP Prototype Pollution
