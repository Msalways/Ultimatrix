---
name: crypto-toolkit
description: "Cryptographic weakness assessment including weak algorithms, padding oracles, and TLS misconfiguration"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, encodeDecode, jwtDecode, updateGraph, writeFinding]
triggers: ["crypto testing", "cryptographic assessment", "weak algorithms", "jwt vulnerabilities", "tls issues", "crypto analysis", "encryption testing", "cryptography", "crypto flaws", "security assessment"]
---

# Cryptographic Issues

## Description
Cryptographic weaknesses undermine the confidentiality and integrity guarantees that applications depend on. This skill covers weak algorithms, padding oracles, key management flaws, TLS misconfiguration, and certificate validation issues.

## Methodology
1. **Identify Cryptographic Usage** — Find where encryption, hashing, signing, or key exchange occurs. Check both application code and configuration (TLS certificates, JWT signing keys, database encryption).
2. **Assess Algorithm Strength** — Identify weak or deprecated algorithms: MD5, SHA1, DES, RC4, RSA with small keys. Check for hardcoded keys and insufficient entropy.
3. **Test Padding and Mode** — For block ciphers, identify the mode (ECB, CBC, CTR). Test for padding oracle vulnerabilities by modifying ciphertext and observing error behavior.
4. **Evaluate TLS Configuration** — Check protocol versions, cipher suites, certificate chain, key exchange parameters. Test for known vulnerabilities (BEAST, POODLE, Heartbleed).
5. **Audit Key Management** — Where are keys stored? How are they rotated? Are there backdoor keys? Is key derivation (PBKDF2, bcrypt, argon2) properly configured?
6. **Check Randomness** — Are nonces, tokens, and session IDs generated with cryptographically secure randomness? Can patterns be predicted?

## Key Concepts
- **Algorithm Deprecation**: MD5 and SHA1 are broken for collision resistance. DES and 3DES have small key sizes. Always check versions.
- **Padding Oracle**: If the server responds differently to valid vs invalid padding, you can decrypt ciphertext without the key
- **Mode Matters**: ECB mode leaks patterns. CBC with static IV leaks information. CTR/CTR mode requires unique nonces.
- **TLS is Not Magic**: A valid certificate does not mean secure configuration. Protocol version and cipher suite selection matter.
- **Key Lifecycle**: Hardcoded keys, unrotated keys, and keys in source code are all critical findings

## Evidence to Collect
- Identified algorithms with version numbers
- TLS configuration details (protocol versions, cipher suites)
- Certificate chain analysis (expiry, key size, signature algorithm)
- Any padding oracle or decryption proof
- Key management documentation or code showing key storage

## Common Pitfalls
- Assuming HTTPS means everything is encrypted (it only protects transport)
- Not checking for mixed content (HTTP resources on HTTPS pages)
- Ignoring client-side cryptography (localStorage encryption, WebCrypto usage)
- Focusing only on algorithms and missing configuration issues (weak DH parameters, CBC suites)
- Not testing for timing side channels in cryptographic comparisons

## References
- OWASP Cryptographic Failures
- CWE-327: Use of a Broken or Risky Cryptographic Algorithm
- Qualys SSL Labs — SSL/TLS Best Practices
- CWE-330: Use of Insufficiently Random Values
