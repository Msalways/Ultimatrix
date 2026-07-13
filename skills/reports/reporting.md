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
