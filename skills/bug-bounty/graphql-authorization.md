---
name: graphql-authorization
description: "Assess GraphQL resolver, field, alias, batching, and global-ID authorization boundaries with schema-aware differentials."
category: specialized
tier: powerful
toolRefs: [graphqlIntrospect, queryGraph, listCapturedRequests, replayCapturedRequest, compareResearchResponses, evaluateResearchExperiment, recordEvidence, recordFindingCandidate, writeFinding]
triggers: ["GraphQL authorization", "GraphQL IDOR", "GraphQL introspection", "GraphQL resolver", "GraphQL batching"]
contextBoosts: [api, auth]
owaspRefs: ["OWASP API1:2023 Broken Object Level Authorization", "OWASP API5:2023 Broken Function Level Authorization"]
compositionRules:
  enhances: [authorization, api-security, api-authorization-matrix]
requires:
  capabilities: [graph.query, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: schema
      goal: Model observed operations, resolvers, fields, IDs, and actor context.
    - id: compare
      goal: Compare one resolver/field under distinct actors.
    - id: mutate
      goal: Change one ID, field, alias, or mutation operation.
    - id: retest
      goal: Reproduce the unauthorized result with fresh evidence.
verification:
  coverage:
    - id: resolver-comparison
      required: true
    - id: field-or-object-impact
      required: true
output:
  schema: GraphQLAuthorizationConclusion
---

# GraphQL authorization

Model authorization at the resolver and field level. A hidden route or disabled introspection is not a substitute for authorization checks.

## Procedure

1. Capture a normal query/mutation and identify operation name, resolver path, global IDs, aliases, fragments, and returned sensitive fields.
2. Introspect only when allowed; otherwise infer the schema from captured traffic and client bundles.
3. Compare the same resolver under owner, peer, guest, and (if authorized) admin actors.
4. Mutate one global ID, field selection, alias, nested object, or mutation operation at a time.
5. Bound batching/depth tests to a small query and stop before resource exhaustion.

```json
{"query":"query($id:ID!){user(id:$id){id privateMarker}}","variables":{"id":"<owner-id>"}}
```

Proof is a reproducible unauthorized field/object/function result or state change, not introspection exposure by itself.
