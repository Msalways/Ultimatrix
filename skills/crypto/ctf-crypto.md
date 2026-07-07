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
