---
name: reporting
description: "Transforming technical findings into actionable reports with severity classification and remediation"
category: core
tier: fast
toolRefs: [readReport, queryGraph, detectChains, updateGraph, writeFinding]
triggers: ["generate report", "create report", "write report", "findings report", "assessment report", "security report", "vulnerability report", "remediation report", "risk assessment", "report findings"]
mitreAttack: []
owaspRefs: ["OWASP Top 10"]
---

# Reporting

## Description
Reporting transforms technical findings into actionable intelligence. This skill covers severity classification, evidence presentation, remediation guidance, and how to communicate findings to different audiences.

## Methodology
1. **Classify Severity** — Use CVSS or a similar framework to assign severity based on impact, exploitability, and context. A finding's severity depends on the environment, not just the technical flaw.
2. **Structure the Report** — Executive summary (1 page, business impact), methodology section, findings with evidence, remediation roadmap.
3. **Present Evidence Clearly** — Each finding needs: description, affected component, reproduction steps, evidence (request/response, screenshots), impact statement.
4. **Provide Remediation** — Generic "fix the bug" is useless. Provide specific, actionable guidance: parameterized queries, input validation rules, access control changes.
5. **Review for Accuracy** — Every finding must be reproducible. Remove theoretical findings. Verify severity ratings. Ensure evidence supports claims.

## Key Concepts
- **CVSS Scoring**: Base score (technical severity) × Temporal (exploit maturity) × Environmental (deployment context) = overall severity
- **Evidence-Based Reporting**: No finding without evidence. No evidence without reproduction steps.
- **Audience Awareness**: Executives need business impact. Developers need technical detail. Both need remediation guidance.
- **Remediation Quality**: The most valuable part of a report is telling them HOW to fix it, not just WHAT is wrong
- **False Positive Filtering**: A report full of false positives destroys credibility. Only report confirmed findings.

## Report Templates

### Executive Summary Skeleton

```markdown
# Security Assessment — <Target>
**Date:** YYYY-MM-DD | **Scope:** <in-scope assets>

## Overall Risk: <Critical/High/Medium/Low>

<2-3 sentences: what was tested, what the strongest finding means in
business terms, whether exploitation was confirmed.>

| Severity | Count |
|----------|-------|
| Critical | n     |
| High     | n     |
| Medium   | n     |
| Low      | n     |

## Top Risks
1. <Finding> — <one-line business impact>
```

### Finding Object (JSON)

```json
{
  "id": "F-001",
  "title": "SQL Injection in /api/orders sort parameter",
  "severity": "critical",
  "cvss": {
    "vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "score": 9.8
  },
  "affected": "https://target.example/api/orders?sort=",
  "description": "<what + why it matters, 3-5 sentences>",
  "reproduction": [
    "1. Send GET /api/orders?sort=(SELECT SLEEP(5))",
    "2. Observe 5-second delay confirming time-based injection"
  ],
  "evidence": [
    {"type": "http", "request": "<raw request>", "response": "<raw response excerpt>"}
  ],
  "impact": "<data disclosure / auth bypass / RCE ...>",
  "remediation": ["Use parameterized queries", "Allowlist sort column names"],
  "references": ["CWE-89", "OWASP A03:2021"]
}
```

### Remediation Roadmap Table

```markdown
| Priority | Finding | Fix | Effort |
|----------|---------|-----|--------|
| P0 (now)      | F-001 SQLi       | Parameterize queries; allowlist sort columns | S |
| P1 (< 30d)    | F-004 IDOR       | Object-level authz checks per tenant         | M |
| P2 (< 90d)    | F-007 Weak CSP   | Nonce-based script policy; drop unsafe-inline | M |
```

## Evidence to Collect
- All reproduction steps verified and tested
- Screenshots and HTTP request/response pairs for each finding
- Severity justification with CVSS vector string
- Remediation recommendations specific to the technology stack
- Executive summary with overall risk posture assessment

## Common Pitfalls
- Writing reports that are too technical for management or too vague for developers
- Including unverified or theoretical findings
- Not providing specific remediation guidance
- Inconsistent severity ratings across similar findings
- Missing the executive summary — decision-makers will not read the full report

## References
- OWASP Testing Guide — Reporting
- CVSS v3.1 Specification — FIRST.org
- PTES — Reporting
