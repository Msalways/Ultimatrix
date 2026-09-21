---
name: api-authorization-matrix
description: "Test BOLA, BFLA, tenant isolation, and field-level authorization with typed actor comparisons and minimal request mutations."
category: specialized
tier: powerful
toolRefs: [queryGraph, requestAsActor, listActors, getCapturedHeaders, listCapturedRequests, replayCapturedRequest, compareResearchResponses, evaluateResearchExperiment, recordEvidence, recordFindingCandidate, writeFinding]
triggers: ["BOLA", "IDOR matrix", "API authorization", "tenant isolation", "field authorization", "BFLA"]
contextBoosts: [api, auth, tenant]
owaspRefs: ["OWASP API1:2023 Broken Object Level Authorization", "OWASP API5:2023 Broken Function Level Authorization", "OWASP API3:2023 Broken Object Property Level Authorization"]
compositionRules:
  enhances: [authorization, api-security]
requires:
  capabilities: [graph.query, session.actor-context, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: owner-baseline
      goal: Capture owner behavior and object/tenant dimensions.
    - id: alternate-actor
      goal: Repeat the same request under a distinct authorized actor.
    - id: mutate
      goal: Change one authorization dimension and compare typed responses.
    - id: retest
      goal: Reproduce the boundary crossing with fresh evidence.
verification:
  coverage:
    - id: actor-comparison
      required: true
    - id: controlled-mutation
      required: true
    - id: independent-retest
      required: true
output:
  schema: AuthorizationMatrixConclusion
---

# Authorization matrix

Build an actor × object × action × field matrix from observed traffic. Prefer two authorized disposable roles; use anonymous only when the target's policy permits it.

## Procedure

1. Capture an owner baseline and record actor/session, object identifier, tenant, action, and returned fields.
2. Repeat under the alternate actor without changing the request shape.
3. Mutate exactly one dimension: object ID, tenant ID, action, role, or sensitive field.
4. Normalize status, body shape, sensitive-field presence, and state transition. Ignore cosmetic differences.
5. Retest with fresh sessions and promote only when the unauthorized data or state change is reproducible.

```json
{
  "baseline": {"actor":"owner","object":"A","action":"read","fields":["id","privateField"]},
  "mutation": {"actor":"peer","object":"A","action":"read","fields":["id","privateField"]},
  "oracle": "peer receives privateField or changes object A"
}
```

Do not brute-force identifiers or probe other tenants without explicit scope and test accounts. A 200 response with an empty/placeholder object is not proof.
