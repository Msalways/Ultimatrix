---
name: ctf-crypto
description: "CTF cryptographic challenges: RSA attacks, padding oracles, hash extension, and encoding chains"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, encodeDecode, jwtDecode, updateGraph, writeFinding]
triggers: ["ctf crypto", "cryptographic challenges", "rsa attacks", "padding oracles", "hash extension", "crypto puzzles", "ctf challenges", "cryptography", "crypto competition", "encryption challenges"]
mitreAttack: ["T1190", "T1552"]
owaspRefs: ["OWASP Top 10 A02:2021 Cryptographic Failures"]
---

# CTF Cryptographic Challenges

## Description
CTF crypto challenges test understanding of cryptographic primitives, their weaknesses, and mathematical attacks. This skill covers classical ciphers, RSA vulnerabilities, hash length extension, ECB mode analysis, and padding attacks.

## Methodology
1. **Identify the Algorithm** — Determine what cryptographic primitive is being used: substitution cipher, RSA, AES, custom construction. Check for hints in the challenge description.
2. **Check for Implementation Flaws** — The most common CTF crypto weakness is not the algorithm itself but how it is used: small key sizes, reused nonces, ECB mode, custom constructions.
3. **Test for Mathematical Attacks** — For RSA: small public exponent, common modulus attack, Wiener's attack on small private exponent. For AES: ECB detection, CBC bit flipping.
4. **Exploit Padding Weaknesses** — PKCS#7 padding oracle attacks allow decryption of CBC ciphertext. Check if the application leaks padding validity.
5. **Try Known Attacks** — Hash length extension (MD5, SHA1, SHA256 with secret prefix), Bleichenbacher's attack on PKCS#1 v1.5, timing attacks on comparisons.
6. **Decode and Deobfuscate** — CTF crypto often involves multiple encoding layers: base64, hex, rot13, custom alphabets. Decode systematically.

## Key Concepts
- **RSA Vulnerabilities**: Small e (e=3 with small message), common modulus, factorization of n (small primes, Fermat factorization), padding issues
- **AES Weaknesses**: ECB mode leaks patterns, CBC mode enables bit flipping, CTR mode nonce reuse allows plaintext recovery
- **Hash Length Extension**: If MAC = H(secret || message) and you know the length, you can compute H(secret || message || padding || extension) without knowing the secret
- **Encoding Layers**: CTF crypto rarely uses one encoding. Strip base64, hex, URL encoding, and custom transformations systematically
- **Tool Awareness**: Know when to use Python (SymPy, Crypto library), when to use online tools, and when to do manual calculation

## Core Attack Scripts

### XOR Single-Byte Brute Force

```python
def xor_brute(data):
    for key in range(256):
        dec = bytes(b ^ key for b in data)
        if all(32 <= c < 127 or c in (9, 10, 13) for c in dec):
            print(key, dec)
```

For repeated-key XOR, find key length via Hamming-distance/Friedman analysis, then solve each column independently as single-byte XOR.

### RSA Small Public Exponent (e=3) — Cube Root

```python
from gmpy2 import iroot

c = <ciphertext_int>
m, exact = iroot(c, 3)
assert exact  # no padding → m = cbrt(c)
print(bytes.fromhex(hex(int(m))[2:]))
```

### RSA Factorization of n (factordb / sympy)

```python
from sympy import factorint
n = <modulus_int>
p, q = sorted(factorint(n).keys())
phi = (p - 1) * (q - 1)
d = pow(e, -1, phi)
m = pow(c, d, n)
```

Or query factordb directly:

```bash
curl -s "http://factordb.com/api?query=<n_decimal>"
```

### Common Modulus Attack

Same `n`, two exponents `e1`, `e2` with `gcd(e1, e2) == 1`:

```python
def common_modulus(n, c1, c2, e1, e2):
    _, s1, s2 = extended_gcd(e1, e2)   # e1*s1 + e2*s2 = 1
    m = (pow(c1, s1 % abs(s1) and s1, n) * pow(c2, s2, n)) % n if s1 >= 0 else \
        (pow(pow(c1, -1, n), -s1, n) * pow(c2, s2, n)) % n
    return m
```

### Wiener's Attack (Small Private Exponent)

```bash
pip install owiener
```

```python
import owiener
d = owiener.attack(e, n)   # returns None if not applicable
if d:
    m = pow(c, d, n)
```

### ECB Mode Detection

Repeated 16-byte blocks betray ECB:

```python
blocks = [ct[i:i+16] for i in range(0, len(ct), 16)]
print(f"repeats: {len(blocks) - len(set(blocks))}/{len(blocks)}")
```

Visual confirmation — encrypt a uniform-color bitmap; ECB renders the silhouette ("ECB penguin").

### Hash Length Extension

If `MAC = SHA256(secret || msg)` and secret length is known:

```bash
pip install hashpumpy
```

```python
import hashpumpy
# (digest, original_msg, data_to_append, secret_len)
new_digest, new_msg = hashpumpy.hashpump(mac, msg, b"&admin=true", len_secret)
```

### CBC Bit Flipping

Flip ciphertext bits to alter the NEXT decrypted plaintext block:

```
delta = target_byte ^ current_byte
ct[i] ^= delta          # corrupts block i, modifies plaintext of block i+1
```

## Evidence to Collect
- Algorithm identification with parameters (key size, mode, IV)
- Mathematical analysis showing the weakness
- Exploitation script with output
- Recovered plaintext or key
- Explanation of why the attack works mathematically

## Common Pitfalls
- Trying to brute-force RSA (factor large n) when there is an implementation flaw
- Not checking for ECB mode (repeated 16-byte blocks in ciphertext)
- Forgetting that XOR of two ciphertexts with same nonce cancels the key stream
- Not trying base64/rot13/hex before assuming it is encrypted
- Overlooking XOR ciphers with repeated key (frequency analysis)

## References
- CryptoPals challenges (cryptopals.com)
- Handbook of Applied Cryptography
- CWE-327: Broken Crypto
