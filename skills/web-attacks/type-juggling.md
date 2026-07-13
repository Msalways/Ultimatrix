---
name: type-juggling
description: "PHP type juggling exploitation using magic hashes, loose comparison, and implicit type coercion"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["type juggling", "php type", "loose comparison", "magic hash", "implicit conversion", "php comparison", "weak type", "0e hash", "type coercion", "php equality"]
contextBoosts: [auth]
mitreAttack: ["T1190", "T1195"]
owaspRefs: ["OWASP Top 10 A04:2021 Insecure Design"]
---

# PHP Type Juggling — Exploitation via Loose Comparison and Implicit Coercion

## 1. When to Use / Do Not Use

### Use When

- Target is a PHP application using loose comparison (`==`) for security-critical checks
- Authentication, session validation, password reset, or token verification uses `==` instead of `===`
- You can observe or control inputs that reach comparison operators (`$input == $secret`)
- Application uses `md5()`, `sha1()`, or other hash functions whose output is compared with `==`
- Cookie values, API tokens, or session IDs are compared using loose equality
- PHP version is unknown but legacy behavior is suspected (pre-8.0 has more coercion quirks)
- You see patterns like `if ($hash == $stored_hash)` or `strcmp($a, $b) == 0`
- CTF or pentest challenge involves PHP login, token, or hash comparison

### Do Not Use When

- Application uses strict comparison (`===`) throughout — type juggling is neutralized
- Target is not PHP (Python, Ruby, Node.js, Java) — type coercion rules differ fundamentally
- Hash comparison uses `hash_equals()` — constant-time, type-safe comparison
- Application uses `sodium_*` or `password_verify()` — these are hardened against timing and type attacks
- You have no visibility into PHP comparison logic (no source, no error messages, no behavioral differences)
- PHP 8.0+ with strict_types declared and strict comparison operators — minimal attack surface

## 2. Auth Context

PHP type juggling is most dangerous at authentication boundaries:

- **Password verification**: `if ($input_password == $stored_hash)` — if `$input_password` is a magic hash, comparison succeeds without knowing the real password
- **Session tokens**: `if ($cookie_token == $expected_token)` — forge a magic hash that loosely equals the expected value
- **API keys**: `if ($api_key == $valid_key)` — same magic hash technique applies
- **Reset tokens**: Password reset links often compare a user-supplied token with the stored token using `==`
- **CSRF tokens**: Some PHP apps compare CSRF tokens loosely — forgeable if you know the expected format
- **Role checks**: `if ($user_role == "admin")` — type coercion can bypass string comparisons

Capture authenticated traffic first:
- Login, observe how session cookies are set and validated
- Password reset flow — capture the token comparison endpoint
- API key validation — note which parameters are compared and how
- Check for `phpinfo()` output or error messages that reveal PHP version

## 3. Loose Comparison Basics — `==` vs `===`

PHP has two equality operators with fundamentally different behavior:

### Strict Comparison (`===`)

Compares both **value** and **type** without coercion:


### Loose Comparison (`==`)

Applies PHP's type coercion rules before comparing values. This is where vulnerabilities arise:


### PHP 8.0 Changes

PHP 8.0 tightened some loose comparisons:
- `0 == ""` is now `false` (was `true`)
- `0 == "foo"` is now `false` (was `true`)
- `"" == "foo"` is now `false` (was `true` based on numeric context)

However, `0 == ""` being `false` in PHP 8.0 does NOT fix magic hash attacks — `"0e123" == "0e456"` still evaluates as `true` because both strings are interpreted as the number `0` in scientific notation. The fix requires `===` or `hash_equals()`.

## 4. Magic Hashes

### The Science Behind Magic Hashes

When PHP encounters a string in a numeric context (comparison with `==` to another number or numeric string), it attempts to parse it as a number. Strings like `"0e123456"` are parsed as scientific notation: `0 × 10^123456 = 0`.

If both strings start with `"0e"` followed by only digits, PHP treats them both as the number `0`:


**Critical distinction**: This only works when the string is **purely numeric** after `"0e"`. If there are trailing non-numeric characters, PHP does not treat it as scientific notation:


### Common Magic Hashes by Hash Algorithm

**MD5 (`md5()` produces 32 hex characters):**

| Input | MD5 Hash | Notes |
|-------|----------|-------|
| `240610708` | `0e462097431906509019562988736854` | Magic hash |
| `QNKCDZO` | `0e830400451993494058024219903391` | Magic hash |
| `aabg7XSs` | `0e087386482136013740957780965295` | Magic hash |
| `aabC9RqS` | `0e041022518165728065344349536299` | Magic hash |
| `s878926199a` | `0e545993274517709034328855841020` | Magic hash |
| `s155964671a` | `0e345678901234567890123456789012` | Magic hash |
| `s1885207288a` | `0e482849239072781370682218283926` | Magic hash |

**SHA1 (`sha1()` produces 40 hex characters):**

| Input | SHA1 Hash | Notes |
|-------|-----------|-------|
| `30773:55` | `0e59486689996028306327910193740332355083` | Magic hash |
| `728907946` | `0e36975005914169056345035924818160099555` | Magic hash |
| `10932435112` | `0e89373252612578429587016510988881564954` | Magic hash |

**PHP `md5()` internal numeric strings:**
PHP's loose comparison triggers magic hash behavior when both sides are numeric-like strings. The attacker needs one magic hash to loosely equal any other magic hash.

### Constructing Magic Hash Collisions

1. Generate millions of random inputs and compute their `md5()` or `sha1()`
2. Filter outputs that start with `"0e"` followed by only digits
3. The input that produces such a hash is your magic hash
4. Send it as the password/token — it will loosely equal any stored hash that also starts with `"0e"` followed by digits

## 5. Authentication Bypass

### Password Verification Bypass

**Vulnerable pattern:**


**Attack:**
- If `$stored_hash` starts with `"0e"` followed by only digits, send a magic hash input
- Both sides produce `"0e..."` strings that PHP treats as `0 == 0`
- The attacker authenticates without knowing the real password

**Proof of concept:**

### Token Forgery

**Vulnerable pattern:**


**Attack:**
1. Determine or guess the hash algorithm (likely `md5()` based on output length)
2. Find a magic hash for that algorithm
3. Send it as the token parameter
4. If `$expected_token` happens to be a magic hash, access is granted

### Session Validation Bypass


Same technique — forge a magic hash cookie that loosely equals the expected hash.

## 6. PHP Type Coercion — Complete Rule Set

### String to Number Coercion

When a string is compared with a number using `==`:


### Boolean Coercion


### Null Coercion


### Type Juggling Quick Reference Table

| Left | `==` | Right | Result | Reason |
|------|------|-------|--------|--------|
| `"0"` | `==` | `false` | `true` | Both falsy |
| `"0"` | `==` | `null` | `true` | null→0, "0"→0 |
| `"1"` | `==` | `true` | `true` | Both truthy |
| `"10"` | `==` | `10` | `true` | String→int |
| `"10"` | `==` | `11` | `false` | Different ints |
| `""` | `==` | `false` | `true` | Both falsy |
| `""` | `==` | `0` | `true` (PHP <8) | 0→"" |
| `""` | `==` | `0` | `false` (PHP ≥8) | Changed in PHP 8.0 |
| `"abc"` | `==` | `0` | `true` (PHP <8) | Non-numeric→0 |
| `"abc"` | `==` | `0` | `false` (PHP ≥8) | Changed in PHP 8.0 |
| `"0e123"` | `==` | `"0e456"` | `true` | Scientific notation→0 |
| `"0eabc"` | `==` | `"0e123"` | `false` | Not pure numeric |
| `[]` | `==` | `false` | `true` | Empty array falsy |
| `[1]` | `==` | `true` | `true` | Non-empty array truthy |
| `"php"` | `==` | `0` | `true` (PHP <8) | Non-numeric→0 |

## 7. Array and Integer Confusion

### Empty Array as False


### Non-Empty Array


### Array in Comparison Chains


## 8. `strcmp()` Bypass

PHP's `strcmp()` compares two strings and returns `0` if equal, non-zero otherwise. It is type-sensitive in an exploitable way:

### The NULL Return Vulnerability


**Why this matters:**


If `$input` is an array (via `password[]=anything` in POST), `strcmp()` returns `NULL`:


**The attacker authenticates without knowing the password.**

### Exploitation


The server returns a valid session or authentication token because `strcmp(array(), "hash") == 0` evaluates as `true`.

### `strncmp()` Variant


Same vulnerability — passing an array returns `NULL`, which loosely equals `0`.

### `mb_strncmp()` and `strncasecmp()`

Same pattern applies to multibyte and case-insensitive variants.

## 9. `md5()` Collision — Deep Dive

### Dual Magic Hash Collision

The most powerful type juggling attack: two different inputs whose `md5()` outputs are both magic hashes.


### Hash Algorithm Detection

To exploit, first determine which hash algorithm the server uses:

| Hash Length | Algorithm |
|------------|-----------|
| 32 hex chars | MD5 |
| 40 hex chars | SHA1 |
| 64 hex chars | SHA256 |
| 128 hex chars | SHA512 |

**Detection methods:**
- Error messages revealing `md5()` or `sha1()` calls
- PHP source code disclosure
- Hash length in responses (set-cookie, hidden fields)
- Timing differences between different input lengths

### Generating Custom Magic Hashes


### Precomputed Magic Hash Lists

Public repositories maintain lists of magic hashes for common algorithms:
- MD5 magic hashes: thousands of known inputs producing `"0e..."` outputs
- SHA1 magic hashes: fewer but still exploitable
- SHA256/SHA512: rare but theoretically possible

### Real-World Impact

If the application stores MD5 hashes (common in legacy PHP apps) and compares them with `==`:
1. An attacker registers with a password whose MD5 is a magic hash
2. The hash is stored in the database
3. Any other user whose stored MD5 is also a magic hash can authenticate with the attacker's password
4. Alternatively, if a known admin password's MD5 is a magic hash, anyone can log in as admin

## 10. Switch Statement Fallthrough

PHP's `switch` statement uses loose comparison internally:


### Type Juggling in Switch


### Switch with Integer 0


### Switch on Hash Comparison


If `$admin_hash` is a magic hash and `$input`'s md5 is also a magic hash, they match.

## 11. `in_array()` Without Strict Mode

`in_array()` checks if a value exists in an array. Without the `strict` parameter set to `true`, it uses loose comparison:


### Attack Scenarios

**Role Bypass:**




The attacker gains access with role "admin" even though only integers are in the allowlist.

**Numeric String Bypass:**


### Fix: Always Use Strict Mode


### `array_search()` Same Vulnerability


If `$key` is used for array indexing or conditional logic, this can cause unintended behavior.

## 12. Additional PHP Type Juggling Vectors

### Ternary Operator Coercion


### Loose Comparison in Conditionals


### PHP `filter_var()` Type Juggling


### Object Coercion (PHP 7.4+)


### `isset()` vs `empty()` vs Loose Comparison


## 13. Anti-Hallucination

### Verification Rules

1. **Do not claim magic hash vulnerability without computing both hashes** — show the actual `md5()` or `sha1()` output of both inputs and demonstrate they both start with `"0e"` followed by digits
2. **Do not claim `strcmp()` bypass without proof** — demonstrate that passing an array returns NULL which equals 0 in the specific PHP version running on the target
3. **Do not assume the hash algorithm** — detect it from response length (32 = MD5, 40 = SHA1) or source disclosure before crafting payloads
4. **Do not claim type juggling vulnerability on PHP 8.0+ without verifying** — some coercion rules changed; `0 == ""` is `false` in PHP 8.0+
5. **Do not confuse "0e" in hashes with magic hashes** — the string must be PURELY numeric after `"0e"`. `"0e123abc"` is NOT a magic hash
6. **Do not claim `in_array()` vulnerability without testing** — some implementations may use strict comparison depending on context; test with actual requests
7. **Verify the comparison operator** — you must confirm the code uses `==` not `===`; behavioral differences can help but are not proof
8. **Do not fabricate hash outputs** — compute the actual hash of your input and show the result matches the magic hash pattern

### Evidence Requirements

When reporting a PHP type juggling vulnerability:

1. **Original hash comparison code** — show the vulnerable comparison (`==` vs `===`)
2. **Computed hash** — show `md5("your_input")` or equivalent output
3. **Magic hash verification** — show both sides parse as `0` in scientific notation
4. **Server response** — demonstrate successful bypass (authenticated session, access granted, token accepted)
5. **PHP version** — note which PHP version the target runs (affects coercion rules)
6. **Comparison context** — show whether `hash_equals()`, `===`, or `==` is used in the actual comparison

### Common Hallucinations to Avoid

- "The hash is vulnerable because it starts with 0e" — only hashes that are PURELY digits after "0e" are magic hashes
- "strcmp() always returns NULL for arrays" — it returns NULL with a PHP warning; error suppression may affect exploitation
- "Type juggling works on all PHP versions" — PHP 8.0 changed several comparison rules
- "Any non-numeric string loosely equals 0" — true in PHP <8, false in PHP 8.0+
- "in_array() always uses loose comparison" — it does unless `strict: true` is passed; verify the actual call
- "This vulnerability exists because the developer used md5()" — the vulnerability is in the loose comparison, not the hash function itself

## Trigger Conditions

Activate when the target is a PHP application performing security-critical comparisons with loose equality (`==`), `strcmp`/`strncmp` family, `switch`, or `in_array()` without strict mode — particularly at auth, session-token, password-reset, CSRF-token, or role checks. Also trigger when hashes (`md5`/`sha1`) are compared loosely or when magic-hash-shaped values appear. Do not trigger on non-PHP apps (coercion rules differ), on apps using `===`/`hash_equals()`/`password_verify()`/`sodium_*`, or when no comparison logic is observable or behavioral.

## Detection Approach

First establish the target is PHP and identify where user input reaches a comparison. Probe for behavioral tells: send a numeric/empty/array input where a string secret is expected and observe whether auth/token checks pass. For magic hashes, determine the hash algorithm from output length (32=MD5, 40=SHA1, 64=SHA256) and test a known magic-hash input (`QNKCDZO`, `240610708`) where the stored hash is also a `0e[digits]` string — both coerce to `0`. For `strcmp`, send the parameter as an array (`param[]=x`); a `NULL` return loosely equals `0`, often granting access. For `in_array()`/role checks, send `"admin"` where an integer allowlist is expected. Confirm the PHP version (error messages/`phpinfo`) since 8.0 changed several coercion rules. Always verify the actual bypass result (authenticated session/token accepted), not just a non-error response.

## Pitfalls

- Claiming magic-hash vulnerability without computing both hashes and confirming both are purely `0e[digits]`.
- Assuming `strcmp()` returns NULL for arrays without testing the live PHP version (warning suppression matters).
- Guessing the hash algorithm — detect from length/source before crafting payloads.
- Claiming type juggling on PHP 8.0+ without checking changed coercion rules (`0==""` is now false).
- Conflating the `0e` prefix with a magic hash — trailing non-digits disqualify it.
- Assuming `in_array()` is loose — verify the actual call; strict mode may be set.

## Verification & Impact

CONFIRMED when a crafted input (magic hash, array, or type-confused value) demonstrably passes a security check — e.g., authenticated session granted, token/reset accepted, or admin role attained — with the comparison context shown. SUSPECTED when coercion looks possible but the bypass isn't reproduced — record as candidate. Document impact by the boundary crossed (auth bypass, token forgery, privilege/role escalation) and severity (typically High/Critical at auth boundaries). Capture the probe request, the server response proving the bypass, and the comparison context via `recordEvidence`.
