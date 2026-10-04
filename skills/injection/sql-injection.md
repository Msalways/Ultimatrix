---
name: sql-injection
domain: injection
category: specialized
tier: powerful
description: Evidence-led SQL injection assessment across in-band, blind, second-order, ORM, and API query contexts with bounded experiments and independent proof.
toolRefs:
  - buildResearchMap
  - planResearchExperiments
  - listCapturedRequests
  - replayCapturedRequest
  - executePlannedExperiment
  - evaluateResearchExperiment
  - compareResearchResponses
  - measureTiming
  - httpRequest
  - recordEvidence
  - writeFinding
  - getCapturedHeaders
primitives: []
triggers:
  - sql injection
  - sqli
  - blind sql injection
  - boolean based sql injection
  - time based sql injection
  - error based sql injection
  - union based sql injection
  - second order sql injection
  - sql injection in api
contextBoosts: [sqli, sql-injection, blind-sql, database-query]
toolChains:
  - name: evidence-backed-sqli
    description: Test one observed input with a matched baseline, bounded mutation, supported oracle, and independent retest.
    steps: [listCapturedRequests, planResearchExperiments, executePlannedExperiment, evaluateResearchExperiment, writeFinding]
compositionRules:
  enhances: [vuln-discovery, second-order-sqli, api-security, graphql-attacks]
requires:
  capabilities:
    - network.request
    - evidence.canonical
    - scope.enforcement
procedure:
  stages:
    - id: map
      goal: Select an observed request, parameter, actor, and workflow; preserve its method, content type, state, and benign value.
    - id: baseline
      goal: Capture a fresh baseline and verify the response shape before choosing one technique.
    - id: mutate
      goal: Change only the selected input and choose an oracle that can distinguish SQL execution from normal application behavior.
    - id: retest
      goal: Repeat the baseline and mutation in a fresh execution and evaluate the same oracle against independent evidence.
    - id: report
      goal: Promote only a proven experiment and state the exact demonstrated impact and remaining unknowns.
verification:
  coverage:
    - id: observed-input-provenance
      required: true
    - id: matched-baseline-and-mutation
      required: true
    - id: deterministic-oracle-passed
      required: true
    - id: independent-retest-passed
      required: true
    - id: impact-limited-to-observed-effect
      required: true
output:
  schema: SQLInjectionAssessment
mitreAttack: [T1190]
owaspRefs:
  - OWASP Top 10:2025 A05 Injection
  - CWE-89
  - OWASP SQL Injection Prevention Cheat Sheet
---

# SQL Injection Research

## Purpose

Find whether an observed application input changes a database query's meaning. A useful assessment reasons from the captured request and workflow, selects the least intrusive experiment that separates safe handling from query interpretation, and keeps raw request/response evidence behind canonical IDs.

This skill supplies SQLi knowledge and experiment selection. The experiment result, independent retest, evidence ledger, and proof rules decide whether a finding is confirmed. A payload or model explanation alone is never proof.

## Preconditions

- Work only on the authorized target and routes already observed in browser traffic, delivered client code, a target-provided link/schema, or an explicitly approved route list.
- Identify the actor/session, current workflow state, request method, content type, and exact candidate input. Preserve unrelated request fields.
- Capture a non-empty benign request when the input is a search/filter value. A static asset, empty default query, generic 500, or WAF block is not an injection point.
- Respect the engagement request and time budgets. Start with one parameter and one low-impact experiment; stop on rate limiting, instability, or unexpected state change.

## Technique Selection

Choose the method from the observed response and application behavior. Do not run a payload list or sweep every parameter by default.

| Technique | When it helps | Safe proof signal | Current experiment support |
|---|---|---|---|
| Boolean/in-band | A result set, status, or stable response structure changes with query truth | Matched true/false or benign/mutated response; prefer a typed collection-size or field oracle | `json-array-growth` |
| Error-based | The mutation produces a database/parser diagnostic absent from the baseline | Known SQL/driver signature on the same method and route, same actor, with only the named observed query/body parameter changed; generic application errors do not count | `database-error-differential` |
| Blind Boolean | The page hides query output but a stable application behavior is conditional | Matched conditions change one stable observable field, with a fresh retest | Use a typed oracle; otherwise retain as a candidate |
| Time-based blind | No response-content oracle exists and timing is explicitly permitted | Interleaved control/mutation samples, median delta above the declared threshold, independent retest | `timing-differential` |
| UNION/projection | A lab or explicitly approved target returns query-selected columns | A non-sensitive, test-owned constant appears in a specific result field while controls do not | Candidate until a typed field oracle is available |
| Second-order | Input is stored and a later workflow consumes it | A test-owned record causes a repeatable query-specific effect at the consumer, while a matched control does not | Use the dedicated `second-order-sqli` workflow; do not target another user's record |
| Identifier/sort/filter | Input selects a column, table, sort direction, or query fragment that cannot be bound as a value | Only allow-listed identifiers are accepted; invalid values are rejected without SQL diagnostics or unexpected result changes | Candidate unless a supported experiment oracle proves it |
| ORM/GraphQL/API resolver | A query passes through HQL/JPQL, a resolver, or a JSON filter before reaching SQL | Ground the query variable/input in captured traffic and prove a SQL-specific differential; GraphQL transport alone is not SQLi | Use the matching API/GraphQL skill plus this skill |
| Encoding/parser differential | Evidence shows multiple decoding or normalization layers | One observed encoding change crosses a parser boundary and reproduces the same oracle | Use only after a baseline signal; no random encoding matrix |
| Out-of-band blind | A synchronous response has no usable oracle and callback testing is explicitly authorized | A unique opaque callback token is observed; never place database-derived values in the callback | `oast-callback` |

### Reasoning Guidance

1. Infer the likely input context from the captured request, UI control, delivered code, and observed validation. Treat DBMS and ORM identity as unknown unless evidence supports it.
2. Form one hypothesis: which input is query-bound, what single mutation distinguishes the hypothesis, what secure behavior is expected, and which observable would prove the difference.
3. For a string or numeric value, derive a minimal context-appropriate true/false pair from the observed value. Do not assume quote style, comment syntax, dialect, or parenthesis depth from a generic cheat sheet.
4. Preserve the same route, actor, headers, body shape, and application state. Change only the candidate input. Use fresh request executions for the independent retest.
5. If a WAF or validator blocks the first probe, record the block. Only test a normalization layer when the engagement allows it and evidence indicates decoding behavior; do not disguise traffic, evade monitoring, or treat a WAF response as SQL execution.

## Bounded Experiment Flow

1. Call `buildResearchMap` after the target surface has been observed. Inspect the resulting hypothesis and input provenance; discard hypotheses tied only to guessed paths or static files.
2. Call `listCapturedRequests` and select the benign request that established the candidate input. Use `getCapturedHeaders` for the same target/actor when authentication is needed.
3. Call `planResearchExperiments`, then execute the selected experiment with one mutation. For JSON result sets, use the `json-array-growth` oracle. For SQL-specific diagnostics, use `database-error-differential` with the observed input's `inputLocation` (`query`, `json`, or `form`) and exact parameter name. The oracle checks that only this input changed. Use timing only with repeated controls and the `timing-differential` oracle.
4. If an oracle is unsupported or inconclusive, record a candidate and its missing proof. Do not convert intuition, a single status code, response length alone, a WAF block, or a generic error into a finding.
5. After a proven initial result, collect a fresh baseline and fresh mutation. Call `evaluateResearchExperiment` with phase `retest`; the evidence references must be independent of the first phase.
6. Call `writeFinding` only when the experiment and independent retest are proven. Pass the experiment ID and canonical evidence IDs; do not copy model prose in place of request/response evidence.

Use this shape when planning a non-extractive differential. Evidence IDs must refer to captured executions; the outline itself does not authorize a request or prove a finding.

```json
{
  "type": "database-error-differential",
  "baselineEvidenceId": "<captured baseline>",
  "mutationEvidenceId": "<captured mutation>",
  "inputLocation": "query",
  "parameter": "<observed parameter name>"
}
```

The retest uses the same oracle shape with fresh baseline and mutation evidence IDs.

## Impact Boundaries

- Stop once the least intrusive oracle establishes whether query semantics changed.
- Do not enumerate schemas, tables, users, tokens, or secrets. Do not read another person's records.
- Do not attempt stacked writes, destructive statements, file access, database privilege escalation, OS commands, credential extraction, or denial-of-service payloads in routine assessment.
- Any higher-impact validation requires explicit authorization for an isolated disposable lab and a separate approval for the specific action. Use only synthetic, test-owned records and a cleanup path.
- Report only the data or behavior actually observed. A larger public catalog is evidence of result-set expansion, not proof of exposure of private tables, credentials, database takeover, or server compromise.

## Assessment Output

State the observed route and input source, actor/state, technique and oracle, baseline/mutation result, independent retest result, canonical evidence IDs, demonstrated impact, and unresolved questions. Mark as `candidate` when the evidence is suggestive but no supported oracle or fresh retest passed. Mark remaining routes/contexts unknown rather than claiming complete SQLi coverage.

## Knowledge Sources

- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) — query parameterization and safe query construction.
- [PortSwigger Web Security Academy: SQL injection](https://portswigger.net/web-security/sql-injection) — error, UNION, blind, and second-order technique distinctions and controlled labs.
- [sqlmap usage: detection techniques](https://github.com/sqlmapproject/sqlmap/wiki/Usage#techniques) — technique taxonomy and the effect of detection depth on request volume. Its broad enumeration options are not part of routine product runs.
- [PayloadsAllTheThings: SQL Injection](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/SQL%20Injection) — dialect reference only; examples must be adapted to observed context and are not evidence.
