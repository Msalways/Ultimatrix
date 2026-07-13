---
name: open-redirect
description: "Open redirect exploitation for OAuth token theft, phishing, and filter bypass techniques"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, followRedirects, evaluateRendered, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["open redirect", "url redirect", "redirect vulnerability", "open url redirect", "redirect injection", "oauth redirect", "phishing redirect", "url validation bypass", "302 redirect", "location header redirect"]
contextBoosts: [auth]
mitreAttack: ["T1189", "T1566"]
owaspRefs: ["OWASP Top 10 A01:2021 Broken Access Control"]
---

# Open Redirect Exploitation

## When to Use

Use this skill when the target application:
- Accepts user-controlled URLs for server-side or client-side redirects
- Has OAuth/SAML flows with callback or redirect_uri parameters
- Implements login, logout, or post-action redirect logic using query parameters
- Uses JavaScript-based or meta-refresh redirect mechanisms
- Has URL validation that can be bypassed via encoding, path tricks, or DNS variations

## Do Not Use

- When the application does not accept external URLs for redirection
- When redirect targets are hardcoded with no user input
- When a WAF or CDN strictly validates redirect destinations server-side
- When testing would cause account lockout or data loss on production systems without authorization

## Auth Context

Open redirects are most dangerous when chained with authentication flows:
- **OAuth/SAML**: Steal authorization codes or tokens during the callback phase
- **Password reset**: Redirect the reset link to an attacker-controlled page
- **Post-login redirect**: Phish credentials immediately after legitimate authentication
- **SSO transitions**: Intercept tokens during identity provider handoffs

Require authenticated session context (`contextBoosts: [auth]`) for full impact exploitation.

## Detection

### Parameter Enumeration

Test every redirect parameter systematically. Common parameter names:


### Detection Method

1. **Inject external URL** into each parameter: `https://evil.com`
2. **Observe response**: Check for 3xx status + `Location` header pointing to attacker domain
3. **Check JavaScript redirects**: Look for `window.location`, `document.location`, `location.href` assignments in response body
4. **Check meta refresh**: Look for `<meta http-equiv="refresh" content="0;url=...">` tags
5. **Follow the redirect**: Confirm the browser actually navigates to the external domain

### Evidence to Record

- HTTP request with injected redirect URL
- Full response headers (especially `Location`)
- Response body if JavaScript or meta redirect is used
- Browser behavior after following the redirect chain

## Basic Exploitation

### Server-Side Redirect (HTTP 3xx)


Expected response:

### Client-Side Redirect (JavaScript)

Response body contains:

### Meta Refresh Redirect


## Filter Bypass Techniques

### Protocol-Relative Redirect

If the application strips `https://` but not `//`:


Browser resolves `//evil.com` as `https://evil.com`.

### Subdomain Impersonation


Some validations only check if the domain ends with `target.com`. Use attacker-controlled subdomain or DNS to resolve.

### Path Traversal with @ (Authority Confusion)


Parsed as: user `target.com`, host `evil.com`. Some URL parsers misinterpret this.

### Backslash Authority Confusion


Some URL parsers treat backslash as a path separator, causing the authority to shift to `evil.com`.

### URL Encoding

Encode the `//` prefix to bypass string-based filters:


### Double URL Encoding

Encode the `%` character itself:


### Backslash Path Traversal


On some systems, backslash is treated as a path separator, redirecting to `evil.com`.

### Null Byte Injection


Older parsers may truncate at the null byte, treating the rest as invalid.

### DNS Name Variations


### Parameter Pollution

Send the same parameter twice with different values:


Server may use the first value for validation and the last for the redirect.

### Tab and Newline Characters


Some parsers ignore whitespace characters in the URL.

### Unicode and Special Characters


Unicode normalization or homograph attacks can confuse domain validation.

## OAuth Token Theft

### Attack Flow

1. **Identify OAuth callback URL**: Find `redirect_uri`, `callback`, `return_to` in OAuth flow
2. **Craft malicious redirect**: Set `redirect_uri=https://evil.com/callback`
3. **Wait for victim**: Victim clicks crafted link, authenticates with OAuth provider
4. **Steal authorization code**: OAuth provider redirects to attacker domain with `?code=AUTHORIZATION_CODE`
5. **Exchange code for token**: Attacker exchanges stolen code for access token

### Exploitation Steps


### OAuth Provider Variations

- **Authorization Code Flow**: Steal `code` parameter from callback
- **Implicit Flow**: Steal `access_token` from URL fragment (`#access_token=...`)
- **PKCE Bypass**: If `code_verifier` is not bound to `code_challenge`, intercept and reuse

### Impact Amplification

- Chain with phishing: Redirect to login page clone, then steal tokens
- Chain with session fixation: Set session cookie before redirect, hijack after login
- Chain with SSRF: Use stolen token to access internal APIs

## Tabnabbing (Reverse Tabnabbing)

### Attack Mechanism

When a page opens a link with `target="_blank"` and `rel="opener"` (or no `rel`), the opened page can navigate the opener via `window.opener.location`.

### Exploitation

1. **Find outbound links** with `target="_blank"` and no `rel="noopener noreferrer"`
2. **Host attacker page** that performs: `window.opener.location = 'https://evil.com/phishing'`
3. **Victim clicks link** → attacker page loads → original tab silently redirects to phishing page

### Detection

Search response HTML for:

Missing `noopener` or `noreferrer` in `rel` attribute is vulnerable.

### Impact

Victim returns to the original tab expecting a legitimate site but sees a phishing clone. Particularly effective against:
- OAuth login pages
- Banking and email portals
- SSO authentication flows

## JavaScript-Based Redirects

### Common Patterns


### Meta Refresh


### Evaluation in Sandboxed Contexts

Use `evaluateRendered` to observe actual browser behavior after JavaScript execution. Static HTML analysis alone may miss runtime redirects.

## Impact Documentation

### Severity Classification

- **High**: OAuth token theft, credential phishing via post-login redirect
- **Medium**: General phishing, session fixation chaining
- **Low**: Open redirect without authentication context (limited direct impact)

### Attack Scenarios to Document

1. **Credential Theft**: Phishing page captures username and password
2. **OAuth Abuse**: Stolen authorization code grants account access
3. **Malware Distribution**: Redirect to drive-by download page
4. **Session Hijacking**: Chain with session fixation for account takeover
5. **SSRF Chaining**: Redirect to internal network endpoints

## Anti-Hallucination

- **Verify every redirect**: Use `followRedirects` and confirm the browser navigates to the injected domain
- **Record HTTP evidence**: Capture full request/response including headers before claiming a redirect exists
- **Do not assume**: A parameter being present does not mean it is vulnerable — test with external URLs
- **Distinguish client vs server redirect**: Server-side (3xx headers) vs client-side (JavaScript/meta) have different exploitation paths
- **Check for DOM-based sinks**: Use `evaluateRendered` to confirm JavaScript actually executes the redirect
- **Do not fabricate bypass results**: If a filter blocks your payload, report it as filtered — do not claim success
- **Log failed attempts**: Record which bypasses were blocked to help refine the filter analysis

## Trigger Conditions

Activate when the application accepts user-controlled URLs for redirection — `redirect`, `return`, `next`, `url`, `to`, `continue` params, post-login/ logout/action redirects, OAuth/SAML `redirect_uri`/`callback`, `window.location`/meta-refresh in responses, or JavaScript-based navigation. Also trigger for tabnabbing (links with `target="_blank"` lacking `rel="noopener"`). Do not trigger when redirect targets are hardcoded with no user input, or filters strictly validate destinations server-side.

## Detection Approach

Enumerate every redirect-bearing parameter and inject an external URL (`https://evil.com`), then check for a 3xx `Location` to the attacker domain, a JS `window.location` assignment, or a meta-refresh. Follow the redirect (`followRedirects`) and confirm the browser actually lands on the external domain. If a naive payload is filtered, escalate through bypass families: protocol-relative `//evil.com`, subdomain suffix matching (`evil-target.com`), `@`/backslash authority confusion, URL/percent/double encoding, parameter pollution (first validated, last used), and unicode/homograph tricks. For OAuth, set a malicious `redirect_uri` and confirm the provider returns the code/token to your host. Confirm the impact context (authenticated vs anonymous) before rating severity.

## Pitfalls

- Assuming a parameter is vulnerable just because it exists — test with an external URL and observe the actual navigation.
- Treating a filtered payload as success — report it as blocked honestly.
- Conflating server-side (3xx) vs client-side (JS/meta) redirects — different exploitation paths.
- Claiming OAuth token theft without confirming the provider honors the malicious `redirect_uri`.
- Missing DOM-based redirects that only appear at runtime — use `evaluateRendered`, not static HTML alone.
- Overrating impact of an anonymous open redirect with no auth/phishing chain.

## Verification & Impact

CONFIRMED when the browser navigates to the attacker-controlled domain (verified via `followRedirects` + response `Location`/body), or a victim's OAuth code/token is delivered to the attacker host. SUSPECTED when a redirect param exists but navigation to evil isn't reproduced — record as candidate. Document impact by the chain enabled: OAuth/code/token theft (High), credential phishing via post-login redirect, session fixation, tabnabbing, SSRF chaining, or standalone phishing (Medium/Low). Capture the request, redirect response, and followed destination via `recordEvidence`.
