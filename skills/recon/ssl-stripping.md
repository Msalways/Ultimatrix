---
name: ssl-stripping
description: "SSL/TLS stripping attacks including HTTPS downgrade, HSTS bypass, and certificate validation testing"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["ssl stripping", "https downgrade", "mitmproxy", "sslstrip", "https downgrade attack", "tls stripping", "ssl attack", "certificate bypass", "https interception", "tls downgrade"]
contextBoosts: [endpoints]
mitreAttack: ["T1557", "T1559"]
owaspRefs: ["OWASP Top 10 A02:2021 Cryptographic Failures"]
---

# SSL Stripping

SSL stripping intercepts the initial HTTPS handshake and downgrades the connection to HTTP before the client ever establishes a secure channel. The attacker acts as a transparent man-in-the-middle, serving a HTTP copy of the target site while the victim believes they are on HTTPS.

---

## When to Use

- Target uses HTTPS but does not enforce HSTS or HSTS preload.
- Redirect from HTTP to HTTPS is a server-side 302/301, not an HSTS-enforced upgrade.
- Application serves mixed content (some resources over HTTP).
- Testing whether HSTS headers are correctly set and enforced.
- Assessing cookie security attributes (`Secure`, `HttpOnly`, `SameSite`) under downgrade.

## Do Not Use

- Target already uses HSTS preload (browser will refuse HTTP before any request).
- Target uses certificate pinning and you cannot control the TLS stack.
- You are testing a non-web protocol (SSH, TLS-native APIs) — SSL stripping is HTTP-specific.
- Legal scope excludes MITM or network-layer interception.

---

## Auth Context

SSL stripping is most dangerous during authentication flows. If a login form is served over HTTP after stripping, credentials are transmitted in cleartext. Capture the following auth artifacts during a strip:

- Login form action URLs (verify they are HTTP after strip).
- Session cookie set on HTTP origin — `Secure` flag should prevent this, but misconfigurations exist.
- OAuth redirect URIs — if the authorization code is returned over HTTP, it can be intercepted.
- CSRF tokens — HTTP-served CSRF tokens are visible to the network observer.

Record each auth flow endpoint and its transport protocol in the graph.

---

## SSL Stripping Basics

### How It Works

1. Client requests `http://target.com` (or is redirected from an HTTP link).
2. Attacker intercepts and forwards the request to `https://target.com` over TLS.
3. Attacker receives the HTTPS response, strips TLS headers, and serves the content as HTTP to the client.
4. All subsequent client requests go through the attacker in plaintext.

### What Gets Stripped

- `Strict-Transport-Security` header — removed to prevent browser from remembering HTTPS-only.
- `Secure` flag on cookies — rewritten so the browser sends cookies over HTTP.
- `https://` links in HTML body — rewritten to `http://` or protocol-relative `//`.
- Content-Security-Policy `upgrade-insecure-requests` directive — removed.
- Any `301`/`302` redirect to HTTPS — intercepted, the attacker proxies the HTTPS version back as HTTP.

### What Cannot Be Stripped

- Preloaded HSTS entries (Google, Facebook, etc.) — browsers refuse HTTP before any request leaves.
- HSTS `includeSubDomains` on the apex domain — prevents subdomain stripping.
- Client-side certificate authentication (mutual TLS).
- WebSocket upgrades over HTTPS (wss://) — the TLS handshake happens at the protocol level.

---

## Tools

### mitmproxy

```
mitmproxy --mode transparent --set upstream_cert=false
```

- Transparent mode: intercepts all traffic at the network layer.
- `upstream_cert=false`: disables upstream certificate verification for testing.
- Use `--set connection_strategy=lazy` to avoid DNS resolution failures on stripped requests.
- Script with `--scripts strip_hsts.py` to automate HSTS header removal.

### sslstrip (legacy)

```
sslstrip -l 8080
```

- Listens on port 8080, redirects HTTP traffic through the stripper.
- Patches `iptables` rules to capture port 80/443 traffic.
- No longer maintained; use mitmproxy for modern targets.
- Known limitation: does not handle HSTS preload list checking.

### bettercap

```
bettercap -iface eth0 -eval "http.proxy on; http.proxy.script strip.js"
```

- ARP spoofing + HTTP proxy in one tool.
- JavaScript-based stripping scripts for link rewriting.
- Better for LAN-based attacks than remote testing.

### Burp Suite

- Proxy tab → Options → Proxy Listeners: enable invisible proxying.
- Repeater for manual HTTP downgrade testing of individual endpoints.
- Intruder for fuzzing redirect chains to find HTTP fallback paths.

---

## HSTS Bypass

### First-Visit Attack

If the user has never visited the site (or cleared browser data), the HSTS preload list is the only defense. Testing steps:

1. Check `chrome://net-internals/#hsts` — query the domain's preload status.
2. If not preloaded, the first HTTP request can be intercepted before any HSTS header is received.
3. Check if the site sends HSTS on the HTTP→HTTPS redirect response (should be on the HTTPS response).

### Subdomain Not Covered

- `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`) — subdomains are unprotected.
- Test `http://app.target.com` or `http://api.target.com` separately.
- Subdomains may serve login pages or sensitive content without HSTS.

### max-age=0 Race

- `max-age=0` tells the browser to immediately expire the HSTS entry.
- If the site sends this during a legitimate maintenance window, an attacker can exploit the window.
- Test: request the site and check if HSTS header value is `0` or absent.

### HSTS Header Validation

Check for these misconfigurations:

- Missing `max-age` directive entirely.
- `max-age` value too low (< 31536000 / 1 year).
- Missing `includeSubDomains` when subdomains exist.
- Missing `preload` directive when aiming for preload list inclusion.
- HSTS header set only on HTTP responses (ineffective — must be on HTTPS responses).
- Multiple HSTS headers — browsers may use only the first or last value.

---

## Certificate Pinning Bypass

### sslstrip2 / sslstrip+

- `sslstrip2`: adds DNS spoofing capability to bypass some HSTS implementations.
- `sslstrip+`: patches sslstrip to work with DNS-based attack vectors.
- Both are legacy tools; prefer mitmproxy with custom scripts.

### mitmproxy with --ignore-ssl-pin

```
mitmproxy --mode regular --set ignore_ssl_pin=true
```

- Requires root/admin for certificate installation.
- `--set ssl_insecure=true` to skip upstream verification.
- Use `--set upstream_cert=false` when the target uses certificate transparency.
- Custom CA must be trusted by the client (install on device or in test browser profile).

### Obsolete Pinning Methods

- Public key pinning (HPKP) is deprecated in all major browsers.
- If the target still uses HPKP, it is a finding — risk of bricking the site if pin is lost.
- Modern pinning is done at the application level (mobile apps, custom clients) — not bypassable via proxy.

---

## Transparent Proxy MITM

### ARP Spoofing

- Send gratuitous ARP replies to poison the gateway's ARP table.
- Tools: `arpspoof`, `bettercap`, ` Ettercap`.
- Requires same Layer 2 network as the target.
- Detection: static ARP entries, ARP monitoring (arpwatch).

### DNS Spoofing

- Respond to DNS queries with attacker-controlled IP.
- Tools: `dnsspoof`, `bettercap`, custom DNS server.
- Works even across subnets if the attacker controls DNS resolution.
- Detection: DNSSEC validation, DNS-over-HTTPS.

### Rogue Access Point

- Create a Wi-Fi AP with the same SSID as a known network.
- Clients connect automatically (if previously connected to that SSID).
- Combined with DNS spoofing, all traffic is intercepted.
- Detection: 802.1X/EAP authentication, wireless IDS.

---

## Partial HTTPS

Some resources are loaded over HTTP even on an HTTPS page. This creates exploitation opportunities:

### Mixed Content

- **Passive mixed content** (images, video): browser allows it but shows warning.
- **Active mixed content** (scripts, iframes, XHR): browser blocks it by default.
- Test by stripping the page and checking which resources still load over HTTP.

### Mixed Content Exploitation

- If JavaScript loads over HTTP, the attacker can inject arbitrary code.
- If CSS loads over HTTP, the attacker can exfiltrate data via `url()` background-image requests.
- If an iframe loads over HTTP, the attacker can serve a phishing page within the legitimate origin.

### Testing Mixed Content

1. Strip the page to HTTP.
2. Check browser console for mixed content warnings.
3. Identify which resources loaded successfully over HTTP.
4. Test if those resources can be modified in transit (injection, defacement).

---

## Cookie Downgrade

### Attack Flow

1. User authenticates on `https://target.com` — session cookie set with `Secure` flag.
2. Attacker strips the HTTPS connection to HTTP.
3. The `Secure` flag should prevent the browser from sending the cookie over HTTP.
4. If `Secure` flag is missing, the cookie is sent in plaintext.

### Testing Steps

1. Authenticate over HTTPS.
2. Strip the connection to HTTP.
3. Check if session cookies are sent in HTTP requests (use `mitmproxy` logging).
4. If cookies are sent, the session can be hijacked.
5. Check if `SameSite=None` is set without `Secure` — this is a misconfiguration.

### HttpOnly Bypass via Downgrade

- `HttpOnly` prevents JavaScript from reading the cookie — but it is still sent in HTTP requests.
- The attacker does not need to read the cookie value; they intercept the HTTP request containing it.
- `HttpOnly` protects against XSS, not MITM/SSL stripping.

---

## Testing Methodology

### Step 1: Redirect Handling

```
GET http://target.com/ HTTP/1.1

Expected (secure): 301/302 → https://target.com/
Expected (vuln):   200 OK with HTTP content, no redirect
```

- If the HTTP request returns a 200 with content (no redirect), the site is immediately vulnerable.
- If it redirects to HTTPS, check if HSTS header is present on the HTTPS response.

### Step 2: HSTS Header Analysis

```
GET https://target.com/ HTTP/1.1
```

Check response headers for:
- `Strict-Transport-Security` present and correctly configured.
- `max-age` ≥ 31536000.
- `includeSubDomains` present if subdomains exist.
- `preload` directive if targeting preload list.

### Step 3: Preload Status

- Check https://hstspreload.org for the domain.
- If not preloaded and HSTS is not set, the site is vulnerable to first-visit stripping.
- Note: preload requires `includeSubDomains` and a `max-age` ≥ 31536000.

### Step 4: Cookie Security

- After authentication, check all cookies for `Secure` and `SameSite` attributes.
- Test if cookies are sent over HTTP after stripping.
- Check if `Session` cookies lack `Secure` flag.

### Step 5: Mixed Content Audit

- Load the HTTPS version and check for HTTP-loaded resources.
- Use browser developer tools to identify mixed content warnings.
- Test if HTTP resources can be intercepted and modified.

### Step 6: Subdomain Enumeration

- List all subdomains (from DNS records, certificate transparency logs).
- Test each subdomain for HSTS coverage.
- Subdomains without HSTS are viable stripping targets.

---

## Anti-Hallucination

This skill provides attack techniques and testing methodologies. Every claim must be verified against actual tool output.

### Evidence Requirements

- **HTTP response**: Record the full HTTP response when testing for HTTP-to-HTTPS redirect behavior. Include status code, headers, and body.
- **HSTS header**: Capture the exact `Strict-Transport-Security` header value from HTTPS responses. If absent, state "HSTS header not present" — do not assume it exists.
- **Cookie attributes**: Log the full `Set-Cookie` header with `Secure`, `HttpOnly`, and `SameSite` flags. If any flag is absent, record the exact header value as evidence.
- **Mixed content**: List each HTTP-loaded resource URL and its type (script, image, iframe, etc.). Do not claim "mixed content exists" without listing specific URLs.
- **Preload status**: Record the exact response from hstspreload.org or the browser's HSTS state. Do not claim preload status without verification.

### What This Skill Does NOT Do

- This skill does not perform real-time MITM attacks against live targets. It provides testing methodology and evidence collection guidance.
- This skill does not bypass HSTS preload. If a domain is preloaded, state that directly — do not fabricate bypass techniques.
- This skill does not decode or decrypt TLS traffic. It describes interception techniques that require network access and tool configuration.
- This skill does not claim a site is vulnerable without testing. Every finding requires a captured HTTP response as evidence.

### Common Hallucinations to Avoid

- Claiming HSTS is "disabled" when the header is simply not present on HTTP responses (it should be on HTTPS responses).
- Claiming a site is "vulnerable to SSL stripping" without testing the actual HTTP→HTTPS redirect behavior.
- Claiming cookies lack `Secure` flag without capturing the full `Set-Cookie` header.
- Claiming preload status without checking hstspreload.org.
- Claiming certificate pinning exists without evidence of HPKP headers or mobile app pinning.
- Confusing `HttpOnly` (XSS protection) with `Secure` (MITM protection).
