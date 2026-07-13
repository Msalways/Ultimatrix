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
  - getTargetSummary
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
3. **Find consumers.** Identify later actions that read the stored value and use it in a query: login-by-username, search-by-owner, display-by-id, delete-by-name.
4. **Trigger the sink.** Perform the consuming action and observe SQL-error leakage, timing differences, or logic changes via `compareResponses`.
5. **Confirm with differential.** Repeat with a benign stored value vs the payloaded value; a divergent response indicates the stored value altered query semantics.
6. **Switch logic.** If the storage endpoint escapes but a different consumer does not, focus exploitation on that consumer. If all consumers re-validate, record as not-vulnerable.

## Pitfalls
- Only testing the storage endpoint and declaring safe — the vulnerability lives at consumption.
- Forgetting the payload must survive any display escaping (HTML-encoding is irrelevant to SQL context).
- Using a payload that breaks the storage query instead of the later one, misattributing the error.
- Assuming parameterized storage implies parameterized consumption.

## Verification & Impact
- **Confirmed:** A stored value, when later consumed, changes SQL behavior (error, auth bypass, extra rows).
- **Suspected:** Unexpected response variance on the consuming action with stored input.
- Document the storage endpoint, the consuming endpoint, and the data flow. Use `writeFinding` with evidence from both stages.

## Key Concepts
| Term | Meaning |
|------|---------|
| Storage sink | Where input is persisted |
| Consuming sink | Where stored value enters a query |
| Deferred execution | Injection fires on later use |
