---
name: account-takeover-chains
description: "Investigate account-takeover chains across password reset, MFA/OTP, OAuth linking, session lifecycle, and recovery flows using disposable accounts."
category: specialized
tier: powerful
toolRefs: [queryGraph, getAuthFlows, getCapturedHeaders, listCapturedRequests, replayCapturedRequest, requestAsActor, listActors, useCredential, acquireActors, extractBrowserAuth, saveSession, compareResearchResponses, evaluateResearchExperiment, recordEvidence, recordFindingCandidate, writeFinding]
triggers: ["account takeover", "ATO", "password reset", "MFA bypass", "OTP leak", "OAuth account linking", "session takeover"]
contextBoosts: [auth, workflow]
owaspRefs: ["OWASP A07:2021 Identification and Authentication Failures", "OWASP ASVS V2"]
compositionRules:
  enhances: [authorization, jwt-advanced, oauth-testing]
requires:
  capabilities: [graph.query, session.actor-context, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: map
      goal: Map recovery, factor, linking, and session transitions.
    - id: bind
      goal: Test one possession or identity binding at a time with disposable accounts.
    - id: impact
      goal: Prove final account control with a benign marker.
    - id: retest
      goal: Reproduce the chain with fresh tokens and accounts.
verification:
  coverage:
    - id: transition-map
      required: true
    - id: account-impact
      required: true
    - id: independent-retest
      required: true
output:
  schema: AccountTakeoverConclusion
---

# Account-takeover chain testing

Treat ATO as a chain, not a keyword. Map the exact transition that should require possession, identity, or prior authentication.

## High-signal branches

- Password reset: token recipient, entropy, expiry, reuse, user binding, host construction, and post-reset session invalidation.
- OTP/MFA: challenge binding, attempt limits, alternate channels, response leakage, step skipping, and recovery fallback.
- OAuth/OIDC: `state`, PKCE, redirect URI, nonce, email/account linking, issuer/audience, and token/code leakage.
- Session: logout, password change, MFA enrollment, role change, refresh-token rotation, and concurrent devices.

For each branch, make one disposable attacker account and one disposable victim/owner account. Prove the final access with a benign account marker, never with real user data. A leaked code or token without demonstrated account impact is an information-disclosure candidate, not automatically ATO.

```text
baseline: normal recovery/auth transition with fresh account
mutation: one altered binding (recipient, state, token, actor, or step)
oracle: victim account session or protected marker becomes attacker-controlled
retest: repeat with fresh accounts and a new token/challenge
```
