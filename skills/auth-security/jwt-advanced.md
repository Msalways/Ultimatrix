---
name: jwt-advanced
description: "Advanced JWT exploitation including algorithm confusion, key injection, and token manipulation attacks"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, encodeDecode, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["jwt attack", "jwt exploitation", "json web token", "jwt algorithm", "jwt confusion", "jwt key injection", "jwt bypass", "jwt manipulation", "token forgery", "jwt security testing"]
contextBoosts: [auth]
mitreAttack: ["T1190", "T1550"]
owaspRefs: ["OWASP Top 10 A02:2021 Cryptographic Failures", "OWASP JWT Cheat Sheet"]
toolChains:
  - name: jwt-analysis
    description: "Analyze JWT structure and detect algorithm weaknesses"
    steps: [httpRequest, parseResponse, encodeDecode, recordEvidence]
  - name: jwt-exploitation
    description: "Exploit JWT vulnerabilities for authentication bypass"
    steps: [httpRequest, parseResponse, encodeDecode, recordEvidence, writeFinding]
compositionRules:
  requires: [authorization]
  enhances: [web-pentest]
---

# JWT Advanced — Exploitation and Token Manipulation

## 1. When to Use / Do Not Use

### Use When
- Target uses JWTs for authentication or authorization (Bearer tokens, cookies, URL params)
- You observe `eyJ` prefixed tokens in requests or responses
- JWT header contains suspicious or interesting `alg`, `jku`, `x5u`, or `kid` values
- Server allows JWT signature verification to be bypassed
- You need to escalate privileges via token forgery
- Token introspection or JWKS endpoints are exposed

### Do Not Use When
- Target uses opaque session tokens (not JWT-encoded)
- Tokens are server-side sessions with random IDs
- Target uses SAML assertions instead of JWTs
- You are testing non-authentication token systems (e.g., CSRF tokens that are not JWTs)

## 2. Auth Context

JWTs are stateless tokens — the server trusts the token itself, not a session store. This means:
- If you can forge a valid token, the server accepts it without lookup
- The signing algorithm and key are the only trust boundary
- Misconfigured algorithm handling is the most common vulnerability class
- JWKS endpoint trust (JKU/X5U) extends the attack surface to external URLs

Collect JWT context before attacking:
- Identify all JWT-bearing requests (Authorization header, cookies, query params)
- Locate JWKS endpoint (`/.well-known/jwks.json`, `/.well-known/openid-configuration`)
- Determine token lifetime from `exp` claim
- Check if token is reissued on each request or persists across sessions
- Note which endpoints validate tokens and which skip validation

## 3. JWT Structure Overview

A JWT has three parts separated by dots: `header.payload.signature`


Each part is base64url-encoded (no padding, `-` and `_` instead of `+/`).

**Header** — declares algorithm and optional metadata:

**Payload** — claims about the subject:

**Signature** — `base64url(header).base64url(payload)` signed with the key declared in `alg`.

Key insight: the signature is computed over the **raw base64url strings**, not the decoded JSON. Modifying any character in the header or payload changes the signature.

## 4. Algorithm Confusion (RS256 → HS256)

The most impactful JWT attack. When a server uses RS256 (asymmetric) but also accepts HS256 (symmetric):

**Why it works:**
- RS256 uses a private key to sign and a public key to verify
- HS256 uses a symmetric secret
- If the server switches to HS256 verification, it uses the public key as the HMAC secret
- The public key is typically downloadable from the JWKS endpoint

**Step-by-step attack:**

1. Download the server's public key:

2. Convert the public key to PEM if needed (JWKS uses JWK format):

3. Use jwt_tool to forge a token:

4. Modify claims for privilege escalation:

5. Send the forged token and verify access escalation

**Manual verification:** Decode the public key, use it as HMAC secret with HS256, sign the modified payload. The server verifies with the same public key — signature matches.

## 5. Algorithm None Bypass

Some libraries accept `alg: none` — no signature verification at all.

**Variations to test (case-sensitive bypass):**
- `"alg":"none"` — lowercase, most common
- `"alg":"None"` — capital N
- `"alg":"nOnE"` — mixed case
- `"alg":"NONE"` — all caps
- `"alg":"null"` — some broken parsers
- `""` — empty string

**Attack steps:**

1. Decode the JWT header
2. Change `alg` to `"none"` (or variations)
3. Remove the signature part (keep the trailing dot)
4. Modify claims as needed
5. Re-encode and send


**Important:** The trailing dot is required — `header.payload.` not `header.payload`

## 6. JKU/X5U Header Injection

**JKU (JWK Set URL)** — Points to the server that hosts the signing keys.
**X5U (X.509 URL)** — Points to the X.509 certificate chain used for verification.

If the server trusts these URLs without validation:

**Attack:**
1. Identify `jku` or `x5u` in the JWT header
2. Generate your own RSA key pair
3. Host your public key at an attacker-controlled URL
4. Set `jku` to your URL: `"jku":"https://evil.com/keys.json"`
5. Sign the token with your private key
6. Server fetches your key and verifies your signature


**Defense bypass:** Some servers only allow `jku` from the same origin. Test with:
- Same-origin URL variations (`/../../../evil.com/keys.json`)
- Open redirect on the target domain
- URL parsing inconsistencies (`https://target.com@evil.com/keys.json`)

## 7. KID Path Traversal

The `kid` (Key ID) header parameter tells the server which key to use. If the server uses `kid` to look up a file:

**Null byte injection:**

**Path traversal:**

**Why `/dev/null` works:** If the server reads `/dev/null` as the key file, it gets an empty key. You can then sign with an empty string.


**SQL injection via KID:**

If the server uses `kid` in a SQL query without parameterization, classic SQL injection applies.

## 8. Weak Secret Brute Force

If the algorithm is HS256, the signature is an HMAC with a shared secret. Brute force the secret:

**Hashcat (GPU-accelerated):**

**John the Ripper:**

**Common weak secrets to test manually:**
- `secret`, `password`, `key`, `test`
- Application name variations
- Base64-encoded empty string: `==`
- Common JWT secrets from public lists

**Custom wordlist generation:**

## 9. Token Claim Manipulation

Modify specific claims to escalate privileges or bypass checks:

**Critical claims to target:**
- `role` / `admin` / `isAdmin` — privilege escalation
- `sub` (subject) — identity spoofing
- `exp` (expiration) — extend token lifetime
- `iat` (issued at) — backdate token
- `iss` (issuer) — spoof issuer if server validates
- `aud` (audience) — cross-service token reuse
- `jti` (JWT ID) — replay protection bypass
- `scope` / `permissions` — authorization escalation

**Technique:** Decode → modify → re-sign with same algorithm:

**Nested claim attacks:** If claims are nested in arrays or objects, test for mass assignment:

## 10. Mixed-Case Bypass

Some validators perform case-insensitive algorithm comparison while others are case-sensitive. Test variations:

| Original | Variation 1 | Variation 2 | Variation 3 |
|----------|-------------|-------------|-------------|
| `RS256` | `rs256` | `Rs256` | `rS256` |
| `HS256` | `hs256` | `Hs256` | `hS256` |
| `HS384` | `hs384` | `Hs384` | `hS384` |
| `HS512` | `hs512` | `Hs512` | `hS512` |

**Attack flow:**
1. Decode JWT header
2. Try each case variation of the algorithm
3. Sign with the appropriate key for the lowercase version
4. If server normalizes to lowercase before verification, your asymmetric key works as HMAC secret


## 11. Cross-JWT Confusion

**JWT vs JWE vs JWS:**
- **JWS** (JSON Web Signature) — signed, not encrypted. Standard JWT.
- **JWE** (JSON Web Encryption) — encrypted. If server accepts both, inject a JWE-wrapped JWS.
- **JWS nested in JWE** — encrypt a forged JWS inside JWE. Server decrypts, then verifies the inner JWS with your key.

**Nested JWT attack:**
1. Create a valid JWS with forged claims
2. Encrypt it with the server's public JWE key (from JWKS)
3. Send the JWE — server decrypts to get your forged JWS
4. If inner JWS verification uses a weak key or algorithm confusion, you win

**Cross-service confusion:**
- Token A valid for Service X is sent to Service Y
- Service Y has a different signing key
- If Service Y falls back to HS256 with an empty or default key, forge with that key

**Key confusion in multi-tenant:**
- Server has multiple signing keys per tenant
- If `kid` is user-controlled, point to a weak key or empty key

## 12. Anti-Hallucination

### Verification Rules
- **Decode the actual JWT** from the request/response before claiming anything about its contents
- **Do not assume** the algorithm — always decode the header and check `alg`
- **Do not assume** the signature is valid — test with jwt_tool or manual verification
- **Do not claim** a JWT is "secure" or "insecure" without testing the specific bypass vectors listed above
- **Do not assume** the server validates all claims — test each claim independently

### Evidence Requirements
When reporting a JWT vulnerability, provide:
1. The **original JWT** (redact real payloads but show structure)
2. The **modified JWT** with forged claims
3. The **server response** showing the forged token was accepted
4. The **specific algorithm** that was vulnerable (e.g., HS256 with public key)
5. The **exact tool or command** used to forge the token

### Common Hallucinations to Avoid
- "The server uses RS256" — verify by decoding the header, not guessing from cookie names
- "The JWT is properly signed" — signature validity requires cryptographic verification, not visual inspection
- "Algorithm confusion is possible" — test it, don't assume based on algorithm presence
- "The secret is weak" — brute force results are conclusive, not estimates
- "KID is vulnerable to injection" — test with actual traversal payloads, not theoretical analysis

### Structured Output for Findings

## Trigger Conditions

Activate when the target uses JWTs for authn/authz — `eyJ`-prefixed Bearer tokens, cookies, or URL params, or a JWKS/`openid-configuration` endpoint. Trigger on suspicious header fields (`alg`, `jku`, `x5u`, `kid`), possible algorithm confusion (RS256 endpoint that may accept HS256), `none` acceptance, key-injection vectors, or weak HMAC secrets. Do not trigger on opaque/random session tokens, SAML-only flows, or non-JWT CSRF tokens.

## Detection Approach

Decode the actual token first; never assume `alg` from cookie names. Build a decision path: (1) try `alg:none` (and case variants) — if accepted, signature verification is off; (2) test algorithm confusion by re-signing an RS256-issued token with the public key as HMAC secret (HS256) — works only if the server accepts HS256; (3) if `jku`/`x5u` present, host your own key and point the header there (test same-origin/open-redirect bypasses); (4) if `kid` present, test path traversal/SQLi/empty-key (`/dev/null`) lookup; (5) for HS256, brute-force the shared secret; (6) manipulate claims (`role`, `sub`, `exp`, `scope`) after forging. Verify each bypass with a server response that accepts the forged token — a re-encoded token alone proves nothing. Capture the original, the forged token, and the accepting response.

## Pitfalls

- Guessing the algorithm instead of decoding the header.
- Claiming algorithm confusion without actually re-signing and getting acceptance.
- Claiming a secret is weak from an estimate rather than a conclusive brute-force result.
- Assuming `kid` injection without testing real traversal/SQLi payloads.
- Treating a re-encoded token as "working" — the server must accept it.
- Overlooking that JWKS trust and `jku`/`x5u` extend the attack surface to external URLs.

## Verification & Impact

CONFIRMED when a forged/modified token is accepted by the server and yields the intended effect (privilege escalation, identity spoofing, extended session, or auth bypass), backed by original + forged token and accepting response. SUSPECTED when a weakness is theorized but not reproduced — record as candidate. Document impact by capability (auth bypass, privilege escalation to admin, token forgery) and severity (typically High/Critical). Capture structure, forged token, and server response via `recordEvidence`.
