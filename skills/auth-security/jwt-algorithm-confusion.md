---
name: jwt-algorithm-confusion
domain: auth-security
category: auth-security
tier: balanced
description: Test JWT implementations for the "none" algorithm acceptance and RS/HS key-confusion flaws that allow token forgery.
toolRefs:
  - httpRequest
  - parseResponse
  - jwtDecode
  - recordEvidence
  - writeFinding
  - getTargetSummary
triggers:
  - jwt none algorithm attack
  - jwt algorithm confusion
  - rs hs key confusion
  - jwt token forgery test
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1078
  - T1609
owaspRefs:
  - A02:2021
  - A07:2021
---

# JWT `none` Algorithm & Key-Confusion Attacks

## When to Use
Use when the application authenticates via JWTs (Authorization bearer tokens, session cookies). Target the two classic forgery classes: acceptance of the `none` algorithm and asymmetric/symmetric key-type confusion.

## Detection Approach
1. **Capture a valid token.** Obtain a legitimate JWT from an authenticated request and decode its header and payload with `jwtDecode` to read `alg`, issuer, and claims.
2. **Test `none` algorithm.** Re-sign (or leave unsigned) the token with `alg:"none"` and an empty signature. Submit it. If the server accepts it as the original identity, the `none` check is missing.
3. **Test algorithm downgrade.** If the original `alg` is asymmetric (RS256/ES256), forge a token using the *public* key (which is often publicly retrievable) as the HMAC secret with `alg:"HS256"`. Libraries that skip key-type validation will verify it.
4. **Test HS→RS confusion.** Conversely, if the server expects RSA but you can register an RSA public key you control as the signing secret, craft a symmetric token.
5. **Validate impact.** Use the forged token against protected endpoints via `httpRequest` and confirm access via `parseResponse`.
6. **Switch logic.** If `none` is rejected, move to key-confusion using the exposed public key. If both fail, record algorithm enforcement as sound.

## Pitfalls
- Forgetting that `none` may be blocked only when lowercase — try `None`, `NONE`.
- Using the wrong public key (JWKS endpoint vs embedded cert) — fetch the exact verifying key.
- Assuming a 200 on a non-protected endpoint proves forgery; retest on a privileged route.
- Leaving the signature non-empty when testing `none` (some parsers require empty sig).

## Verification & Impact
- **Confirmed:** Forged token (none or confused-alg) is accepted and grants the targeted identity/role.
- **Suspected:** Token accepted but only on low-privilege routes.
- Document the token flow, the flawed algorithm handling, and the privilege gained. Use `writeFinding` with decoded/forged token evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| `none` alg | Unsigned token, signature skipped |
| Key confusion | Symmetric/asymmetric type mismatch |
| JWKS | JSON Web Key Set (public keys) |
