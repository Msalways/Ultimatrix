---
name: second-order-sqli
domain: injection
category: injection
tier: balanced
description: Verify stored-then-consumed SQL injection with owner-controlled records, paired workflow evidence, and an independent replay.
toolRefs:
  - httpRequest
  - parseResponse
  - compareResearchResponses
  - recordEvidence
  - writeFinding
  - getTargetSummary
  - getCapturedHeaders
  - listCapturedRequests
  - planResearchExperiments
  - executePlannedExperiment
  - evaluateResearchExperiment
primitives: []
triggers:
  - second order sql injection
  - stored sql injection test
  - deferred sql execution
  - persistent input sql sink
contextBoosts: [second-order-sqli, sql-injection, sqli]
toolChains: []
compositionRules:
  enhances: [sql-injection, api-security, authorization]
requires:
  capabilities:
    - network.request
    - evidence.canonical
    - scope.enforcement
procedure:
  stages:
    - id: map-flow
      goal: Link an observed storage request to a later consumer and identify the current actor and test-owned record.
    - id: baseline-flow
      goal: Store a benign value and capture the consumer response for the same owned record.
    - id: mutation-flow
      goal: Store one controlled SQL-context mutation on a disposable test record and replay the same consumer workflow.
    - id: retest-flow
      goal: Repeat both workflows with a new test-owned record and independent evidence.
verification:
  coverage:
    - id: observed-store-and-consumer
      required: true
    - id: owner-controlled-test-record
      required: true
    - id: matched-consumer-oracle
      required: true
    - id: independent-retest
      required: true
output:
  schema: SecondOrderSQLiAssessment
mitreAttack: [T1190]
owaspRefs:
  - OWASP Top 10:2025 A05 Injection
  - CWE-89
---

# Second-Order SQL Injection

## When to Use

Use only when observed traffic or application behavior shows that a value is stored by one workflow and later consumed by another. First-order testing of the storage request alone cannot confirm or rule this out.

## Required Context

- Identify the exact storage request and consumer request from captured traffic or target-delivered code.
- Identify the authenticated actor, record owner, benign stored value, consumer action, and a cleanup path.
- Use a disposable local/staging account or an existing record owned by the test actor. Never target an administrator or another user's account.
- If the workflow requires a persistent write and is not an isolated test environment, stop until that specific state change is authorized.

## Two-Stage Experiment

1. **Map provenance.** Record the storage route/input and consumer route/input. Link the two through an observed record ID or workflow edge; do not assume a fixed ID such as `1`.
2. **Capture the control.** Store a benign value through the normal request, capture the server response and created/updated test record ID, then perform the consumer action as the same actor. Preserve request shape and session.
3. **Mutate one test-owned value.** Change only the stored field to a minimal SQL-context probe derived from the observed value and context. Confirm storage succeeded and did not alter unrelated state.
4. **Trigger the same consumer.** Use the same actor, record, route, and action. Capture the full response behind canonical evidence IDs. Compare with the control using a SQL-specific error signature, a supported structured result oracle, or a permitted repeated timing oracle.
5. **Independent retest.** Repeat the baseline and mutation with a fresh disposable record and new execution evidence. Do not reuse the first record, evidence IDs, or timing samples.
6. **Restore state.** Delete the test-owned record or restore its original benign value using the authorized cleanup request, and capture cleanup evidence.

The store response itself is not proof. A SQL error from an unrelated route is not proof. A consumer response must differ from its matched control because the persisted value changed query behavior.

Keep the storage and consumer evidence linked as one workflow. This outline records evidence references; it is not a request template.

```json
{
  "recordOwner": "test actor",
  "baseline": {
    "storageEvidenceId": "<baseline storage>",
    "consumerEvidenceId": "<baseline consumer>"
  },
  "mutation": {
    "storageEvidenceId": "<mutation storage>",
    "consumerEvidenceId": "<mutation consumer>"
  },
  "cleanupEvidenceId": "<cleanup>"
}
```

## Oracle and Promotion

The current `database-error-differential` oracle proves only first-order request mutations: it requires the named input to change in the consumer request while every other query/body value stays stable. It cannot prove that a persisted value caused a later consumer effect when the consumer request itself is unchanged. Do not submit an ordinary second-order flow to that oracle or claim proof from a matching error string. Keep the result as a candidate until a typed workflow oracle can link storage, owned record, consumer effect, and independent retest. Use `json-array-growth` or `timing-differential` only when their typed measurements are available; they do not replace the missing storage-to-consumer provenance gate.

If the current graph cannot represent the storage-plus-consumer workflow as one experiment with an independent retest, record a candidate with the missing proof and do not call `writeFinding` for a confirmed finding. Keep storage and consumer evidence IDs together for later workflow support.

## Boundaries

- Do not test account takeover by impersonating a real user, changing a real user's password, or assigning privileged names/roles.
- Do not extract credentials, secrets, or rows that do not belong to the test actor.
- Do not use stacked statements, destructive SQL, long sleeps, file access, or database-to-OS escalation.
- If a probe causes an unexpected state change, stop and restore the test fixture before continuing.

## Report

State the storage endpoint/input, consumer endpoint/action, actor and owned record, baseline/mutation oracle, fresh retest outcome, cleanup result, canonical evidence IDs, and exact demonstrated impact. Mark unresolved consumers and unsupported oracles as unknown.

## References

- [PortSwigger: Second-order SQL injection](https://portswigger.net/web-security/sql-injection#second-order-sql-injection)
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
