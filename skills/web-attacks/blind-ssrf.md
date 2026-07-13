---
name: blind-ssrf
domain: web-attacks
category: web-attacks
tier: balanced
description: Exploit blind/out-of-band SSRF through OAST callbacks, cloud metadata endpoints, and internal service reachability when responses give no direct feedback.
toolRefs:
  - httpRequest
  - parseResponse
  - checkOastCallbacks
  - clearOastCallbacks
  - cloudMetadataProbe
  - recordEvidence
  - writeFinding
  - getTargetSummary
triggers:
  - blind ssrf exploitation
  - oast out of band callback
  - cloud metadata 169.254.169.254
  - internal service reachability
  - server side request forgery test
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1190
  - T1078
  - T1499
owaspRefs:
  - A10:2021
---

# Blind & Out-of-Band SSRF

## When to Use
Use when a server accepts a URL/host input (webhook, import, avatar fetch, PDF render, SSR proxy) but returns no direct response body from the fetched resource. Trigger when you need OAST-based confirmation or want to reach cloud metadata / internal services.

## Detection Approach
1. **Identify URL-taking parameters.** Enumerate inputs that cause the server to make outbound requests (file import, preview, fetch-by-url, callback registration).
2. **Plant an OAST callback.** Point the input at a unique collaborator/OAST hostname you control and clear prior callbacks first. Then perform the server action.
3. **Poll for the callback.** Use `checkOastCallbacks` after the action. An inbound request to your OAST host from the target confirms SSRF even with no response feedback.
4. **Target cloud metadata.** Submit the link-local address `169.254.169.254` (with versioned paths like `/latest/meta-data/iam/security-credentials/`) via `cloudMetadataProbe` to test for credential disclosure on cloud hosts.
5. **Probe internal reachability.** Cycle through internal IP ranges and common ports; differentiate "connection refused" from "timeout" to map which internal services are reachable.
6. **Switch logic.** If OAST fires but metadata is blocked, document egress capability. If only timeouts occur, use timing differentials to infer reachability.

## Pitfalls
- Declaring safe on absence of response body — blind SSRF is proven by callbacks, not replies.
- Forgetting to clear OAST state, causing false attribution from prior tests.
- Assuming HTTPS-only inputs reject metadata (IP-literal and decimal/hex IP encodings often bypass filters).
- Confusing DNS resolution callbacks (filter reached) with actual content fetch.

## Verification & Impact
- **Confirmed:** OAST callback received, metadata credentials returned, or internal service interaction evidenced.
- **Suspected:** Timing differentials consistent with internal reachability.
- Document the vulnerable parameter, the reached destination, and exposed data (IAM keys, internal responses). Use `writeFinding` with callback evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| OAST | Out-of-band application security testing |
| Blind SSRF | No direct response from fetched resource |
| Link-local metadata | 169.254.169.254 cloud credential store |
