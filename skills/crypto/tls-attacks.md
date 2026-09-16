---
name: tls-attacks
description: "TLS/SSL attacks: POODLE, DROWN, BEAST, CRIME, Heartbleed, certificate pinning bypass, HSTS bypass, and mTLS attacks"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, measureTiming, encodeDecode, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["tls attack", "ssl attack", "poodle", "drown", "beast", "crime", "heartbleed", "certificate pinning bypass", "hsts bypass", "mtls attack", "ssl downgrade", "tls downgrade", "certificate validation"]
mitreAttack: ["T1557", "T1040", "T1190"]
owaspRefs: ["OWASP Top 10 A02:2021 Cryptographic Failures"]
---

# TLS/SSL Attacks

## When to Use

- You are testing TLS/SSL implementation security
- You need to assess certificate validation and pinning
- You are testing whether downgrade attacks are possible
- Evaluating whether the server supports weak protocols or ciphers

## Do Not Use

- Against systems you do not own or have permission to test
- To intercept traffic beyond the agreed engagement scope
- On production systems where testing could cause service disruption

## Auth Context

TLS attacks target the transport layer. For any intercepted traffic, use **httpRequest** with **getCapturedHeaders** for auth context on replayed requests.

---

## Protocol Downgrade Attacks

### POODLE (CVE-2014-3566)

```bash
# Attack SSLv3 CBC padding oracle
# Requires: server supports SSLv3

# Test with testssl.sh
testssl.sh --ssl-poodle target.com:443

# Or nmap
nmap --script ssl-poodle -p 443 target.com

# Exploitation requires:
# - SSLv3 enabled on server
# - Attacker can inject requests (MITM position)
# - CBC cipher in use
```

### DROWN (CVE-2016-0800)

```bash
# Cross-protocol attack using SSLv2 to decrypt TLS sessions
# Requires: server supports SSLv2 or shares key with SSLv2 server

# Test with testssl.sh
testssl.sh --ssl-drown target.com:443

# Or nmap
nmap --script ssl-drown -p 443 target.com
```

### FREAK (CVE-2015-0204)

```bash
# Force RSA export-grade key exchange
# Requires: server supports RSA_EXPORT ciphers

testssl.sh --cipher-freak target.com:443
```

---

## Encryption Attacks

### BEAST (CVE-2011-3389)

```bash
# Exploit CBC IV predictability in TLS 1.0
# Requires: TLS 1.0 + CBC cipher

# Test
testssl.sh --beast target.com:443

# Mitigation: TLS 1.1+ or RC4 cipher (deprecated)
```

### CRIME (CVE-2012-4929)

```bash
# TLS compression oracle
# Requires: TLS compression enabled (rare in modern servers)

testssl.sh --crime target.com:443
```

### BREACH

```bash
# HTTP-level compression oracle (not TLS-specific)
# Requires: HTTP compression + user-controlled input in response

# Test for BREACH
# 1. Check if HTTP compression is enabled
# 2. Inject payload in reflected parameter
# 3. Observe compressed response length changes
```

---

## Memory Disclosure

### Heartbleed (CVE-2014-0160)

```bash
# OpenSSL memory disclosure
# Requires: OpenSSL 1.0.1 - 1.0.1f

# Test
testssl.sh --heartbleed target.com:443

# Or nmap
nmap --script ssl-heartbleed -p 443 target.com

# Impact: leak up to 64KB of server memory per request
# Contains: private keys, session tokens, credentials
```

---

## Certificate Attacks

### Certificate Validation Bypass

```bash
# Test with curl
curl -k https://target.com  # Ignore certificate errors
curl --cacert /dev/null https://target.com

# Test with OpenSSL
openssl s_client -connect target.com:443 -verify_return_error

# Check certificate chain
openssl s_client -connect target.com:443 -showcerts
```

### Certificate Pinning Bypass

```bash
# Frida (mobile)
frida -U -f com.target.app -l sslpinning.js

# objection (mobile)
objection -g com.target.app explore
objection> android sslpinning disable

# Burp Suite
# Use CA certificate in device trust store
# Or use Burp's built-in bypass extensions

# Manual bypass
# 1. Extract pinned certificate hashes from app
# 2. Generate certificate with same hash
# 3. Or patch certificate validation in binary
```

---

## HSTS Attacks

### HSTS Bypass

```bash
# Preload bypass
# If target is NOT on HSTS preload list:
# 1. First visit via HTTP (no HSTS header yet)
# 2. Intercept and downgrade to HTTP

# Subdomain bypass
# If *.target.com has HSTS but sub.target.com does not:
# 1. Access http://sub.target.com (no HSTS)
# 2. Set cookies for .target.com

# NTP-based bypass
# If system time is wrong, HSTS max-age may appear expired

# Test HSTS
curl -I https://target.com | grep -i strict-transport
```

---

## mTLS Attacks

### Client Certificate Theft

```bash
# Extract client certificate from browser
# Chrome: Settings → Privacy → Manage certificates
# Or from keychain (macOS)

# Use stolen certificate
curl --cert client.pem --key client-key.pem https://target.com

# Or with openssl
openssl s_client -connect target.com:443 -cert client.pem -key client-key.pem
```

### mTLS Relay

```bash
# Relay client certificate to different server
# If certificate is not bound to specific server
# Use mitmproxy or custom proxy
```

---

## 0-RTT Replay

```bash
# TLS 1.3 early data (0-RTT) replay
# If server accepts 0-RTT for non-idempotent requests

# Test with curl
curl --tls-max 1.3 --tls13-ciphers AES_256_GCM_SHA384 -k https://target.com

# Replay captured 0-RTT data
# Risk: replay attacks on non-idempotent endpoints (POST, PUT)
```

---

## Cheat Sheet — Quick Reference

| Attack | Requirement | Test Tool |
|--------|-------------|-----------|
| POODLE | SSLv3 + CBC | testssl.sh |
| DROWN | SSLv2 support | testssl.sh |
| BEAST | TLS 1.0 + CBC | testssl.sh |
| CRIME | TLS compression | testssl.sh |
| Heartbleed | OpenSSL 1.0.1-1.0.1f | testssl.sh, nmap |
| HSTS bypass | Not on preload list | curl, browser |
| Cert pinning bypass | Pinned app | Frida, objection |
| 0-RTT replay | TLS 1.3 + 0-RTT | curl |

---

## Anti-Hallucination

- Most TLS attacks (POODLE, BEAST, CRIME) are mitigated in modern configurations — verify the server actually supports the vulnerable protocol
- Heartbleed requires specific OpenSSL versions — check the server version before claiming vulnerability
- Certificate pinning bypass requires a rooted/jailbroken device for mobile apps
- HSTS bypass depends on whether the domain is on the preload list — check https://hstspreload.org
- Document the exact TLS version, cipher suite, and certificate details for each finding
