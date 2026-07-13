---
name: information-disclosure
description: "Information disclosure testing for verbose errors, sensitive data exposure, debug leaks, and exposed secrets"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, findEndpointsInResponse, evaluateRendered, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["information disclosure", "data exposure", "verbose errors", "sensitive data", "debug leaks", "exposed secrets", "info disclosure", "data leaks", "security leaks", "sensitive information"]
mitreAttack: ["T1592", "T1046"]
owaspRefs: ["OWASP Top 10 A01:2021 Broken Access Control"]
---

# Information Disclosure Testing

## Description
Information disclosure testing identifies unintended data exposure through responses, error messages, headers, JavaScript bundles, HTML source, and other channels. This includes exposed API keys, credentials, internal paths, and sensitive configuration data.

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context.

## Methodology

### Step 1: Response Header Analysis
Examine ALL response headers for information leaks:
- `Server` header — technology and version (e.g., `Apache/2.4.41`)
- `X-Powered-By` — framework info (e.g., `Express`, `PHP/7.4`)
- `X-AspNet-Version` — ASP.NET version
- `X-Debug-Token` — debug mode indicators
- Custom headers with internal paths or tokens
- `Strict-Transport-Security` — absence indicates no HTTPS enforcement

### Step 2: HTML Source Analysis (CRITICAL — Do Not Skip)
Examine the full HTML source of EVERY page:

1. **HTML comments** — developers often leave sensitive data:

2. **Hidden form fields** — may contain tokens, user IDs, or default values:

3. **Meta tags** — may expose internal information:

4. **Inline scripts** — configuration objects with sensitive defaults:

### Step 3: JavaScript Bundle Analysis (CRITICAL — Most Common Miss)
This is where exposed API keys and secrets are most often found:

1. **Find all JavaScript files:**
   - Look for `<script src="...">` tags
   - Check `/static/`, `/assets/`, `/js/`, `/dist/` directories
   - Look for webpack chunks: `/static/js/main.abc123.js`

2. **Analyze each JS file for:**
   - **API keys**: `sk_live_`, `sk_test_`, `AKIA`, `AIza`, `ghp_`, `glpat-`
   - **Hardcoded credentials**: `password:`, `secret:`, `token:`, `apiKey:`
   - **Internal endpoints**: URLs not linked from the UI (`/internal/`, `/admin/`, `/debug/`)
   - **Configuration objects**: `window.__CONFIG__`, `window.__NEXT_DATA__`, `window.__NUXT__`
   - **Source map URLs**: `//# sourceMappingURL=main.js.map` — reveals original source

3. **Check SSR payloads (Next.js, Nuxt.js, etc.):**
   - `window.__NEXT_DATA__` — contains ALL page data as JSON, often including internal API responses
   - `window.__NUXT__` — same for Nuxt.js
   - `__INITIAL_STATE__` — Vue/React server-rendered state

### Step 4: Error Response Analysis
Trigger error responses and check for information disclosure:
- Send invalid inputs (special characters, very long strings, wrong data types)
- Check for stack traces, database error messages, internal file paths
- Look for debug endpoints: `/debug`, `/trace`, `/actuator`, `/phpinfo.php`
- Check for verbose error messages that reveal SQL query structure

### Step 5: Exposed Files and Directories
Probe for commonly exposed sensitive files:
- `.env`, `.env.local`, `.env.production` — environment variables with secrets
- `package.json`, `composer.json`, `Gemfile` — dependency lists (may reveal versions)
- `.git/`, `.svn/`, `.hg/` — version control metadata (can leak full source)
- `robots.txt`, `sitemap.xml` — disallowed paths reveal admin panels
- `/swagger.json`, `/openapi.json` — API documentation
- `/server-status`, `/server-info` — Apache server info
- `/wp-config.php.bak`, `/config.php.bak` — backup config files

### Step 6: API Response Analysis
Review API responses for excessive data:
- Do responses include fields the client doesn't need? (mass data exposure)
- Are internal IDs, timestamps, or paths exposed?
- Do error responses reveal internal implementation details?
- Check GraphQL responses for introspection data

## What to Look For
- Server headers revealing technology versions
- Error messages with database details, file paths, or stack traces
- HTML comments with sensitive information
- **API keys, tokens, or secrets in JavaScript bundles**
- **Exposed configuration objects (window.__NEXT_DATA__, etc.)**
- **Internal API endpoints in client-side code**
- API responses with unnecessary fields
- Debug modes enabled in production
- Exposed .env files or config backups

## Testing Approach
1. Fetch the main page and examine HTML source thoroughly
2. Find and analyze all JavaScript files
3. Trigger error responses with invalid inputs
4. Probe for common exposed files
5. Review all API responses for excessive data
6. Check for debug endpoints and verbose logging

## Evidence to Collect
- Full HTML source showing comments, hidden fields, inline scripts
- JavaScript file content showing embedded secrets
- Error responses with stack traces or internal paths
- Screenshots of exposed data

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every discovery you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.

## Trigger Conditions

Activate during any assessment as a continuous recon/disclosure pass: on every page fetch, JavaScript bundle, error response, and API response. Trigger specifically when responses expose headers revealing tech/version, HTML comments/hidden fields, embedded config objects (`window.__NEXT_DATA__`), API keys/secrets in JS, debug endpoints, or verbose stack traces. Also trigger when probing common exposed files (`.env`, `.git`, `robots.txt`, `swagger.json`). Do not treat disclosure as out of scope for any other skill — it is cross-cutting.

## Detection Approach

Reason systematically across channels. Start with response headers (capture all) — `Server`, `X-Powered-By`, debug tokens, and absent `Strict-Transport-Security`. Then fetch and fully read the HTML source for comments, hidden inputs, and inline config. Next, enumerate and fetch every JS bundle and grep for key patterns (`sk_live_`, `AKIA`, `ghp_`, internal `/admin`/`/internal` URLs, source-map references). Trigger errors with malformed/invalid input to surface stack traces and SQL structure. Probe well-known sensitive paths. Finally, review API responses for over-broad fields. Escalate each finding by confirming the data is real and sensitive (not a placeholder), then route to the relevant exploitation skill (e.g., discovered endpoint → web-pentest; key → note for credential use).

## Pitfalls

- Scanning only the landing page — secrets live in JS bundles and admin/debug routes.
- Claiming a "secret" from a placeholder or example value — confirm it is live/credential-shaped.
- Missing source-map references that expose original source.
- Treating an error page as a vuln without checking it actually leaks internals.
- Stopping at headers — HTML comments and inline config are the most common misses.
- Assuming no disclosure because the main page is clean.

## Verification & Impact

CONFIRMED when a captured response/body actually contains the disclosed data — a real API key, stack trace with paths, internal endpoint, or config object with sensitive values. SUSPECTED when a file/path is guessed but unverified — record as candidate. Document impact by what leaked: technology fingerprint (low), internal paths/endpoints (medium), or live credentials/keys/PII (high/critical). Always attach the exact source (header name, file, line context) via `recordEvidence`.
