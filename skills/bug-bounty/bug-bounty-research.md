---
name: bug-bounty-research
description: "Use public vulnerability research and disclosed bug-bounty patterns as bounded priors for hypotheses, never as evidence about the current target."
category: methodology
tier: balanced
toolRefs: [webSearch, queryGraph, getTargetSummary, searchSkills, loadSkillBody, buildResearchMap, planResearchExperiments, recordFindingCandidate, assessCandidateReportability, writeFinding, recordEvidence]
triggers: ["research bug bounty reports", "public vulnerability research", "find similar reports", "bounty prior art", "report triage"]
contextBoosts: [research, reporting]
owaspRefs: ["OWASP WSTG", "OWASP API Security Top 10 2023"]
requires:
  capabilities: [graph.query, evidence.capture, finding.write]
procedure:
  stages:
    - id: source
      goal: Extract structural priors from maintained public research.
    - id: bind
      goal: Bind a prior to observed target evidence without importing assumptions.
    - id: verify
      goal: Plan and assess a target-specific experiment and retest.
verification:
  coverage:
    - id: source-provenance
      required: true
    - id: target-binding
      required: true
    - id: proof-chain
      required: true
output:
  schema: ResearchPriorConclusion
---

# Public-research priors

Use web research to improve hypothesis selection and report quality. Never copy a report's payload, target assumptions, severity, or claim into the current engagement.

## Workflow

1. Search primary or maintained sources first: OWASP, PortSwigger Academy/research, vendor advisories, and the disclosure platform's own case study.
2. Extract only structural facts: vulnerability family, precondition, boundary crossed, oracle, impact, and remediation.
3. Translate that structure into a target-specific hypothesis tied to a captured endpoint, workflow, actor, or graph fact.
4. Plan a baseline/mutation experiment with a typed success and failure oracle. Public material can rank a hypothesis; it cannot satisfy the proof gate.
5. Record source URLs in the candidate's rationale, not copied report text. Re-check current program scope and exclusions before any active request.

## Triage questions

- Is the reported behavior present in this target's observed request/response shape?
- Does the target have the same trust boundary (actor, tenant, cache, parser, origin, or renderer)?
- Is there a safe, reversible probe that distinguishes the hypothesis from a normal feature?
- Can impact be reproduced with fresh evidence and an independent session?

```text
prior = { family, precondition, boundary, oracle, impact, sourceUrl }
hypothesis = bind(prior, observedEndpoint, observedActor, observedState)
experiment = baseline + one_mutation + typed_oracle + retest
promote only when experiment.initial == proven and experiment.retest == proven
```

## Anti-patterns

- Do not search for a report and declare the target vulnerable because the route names look similar.
- Do not use public credentials, tokens, victim data, or third-party infrastructure.
- Do not turn a scanner's informational asset/secret observation into a high-severity finding without proving usability and impact.
