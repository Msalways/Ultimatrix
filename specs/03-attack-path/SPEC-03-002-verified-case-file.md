# SPEC-03-002: Verified Case File Export

**Status:** 📋 Planned  
**Phase:** 03 - Attack-Path + Case File  
**Priority:** P2  
**Date:** 2026-07-09  
**Depends On:** SPEC-00-004 (Evidence Gate), SPEC-02-005 (Primitives verified)

---

## 1. Problem Statement

A finding without a submission-ready artifact is worth little to a bounty hunter. There is no exporter that combines the forensic log + EvidenceGate receipts + working curl/Playwright PoC + decision log + remediation into one case file.

---

## 2. Acceptance Criteria

~~~
AC-03-002-1: Exports a CaseFile per verified finding (curl PoC + Playwright + evidence + remediation)
AC-03-002-2: PoC is reconstructed from recorded tool output (no fabrication)
AC-03-002-3: /report REPL command emits Markdown; solve -t also writes JSON+MD
AC-03-002-4: Includes a bounty-template section (title/severity/impact/poc)
~~~

---

## 3. Technical Design

New `src/report/case-file.ts`:
~~~
export interface CaseFile {
  finding: VerifiedFinding;
  exploit: { curl: string; playwright: string; steps: string[] };
  evidence: EvidenceRef[];          // from EvidenceGate buffer
  decisionLog: DecisionEntry[];     // why this technique/endpoint
  remediation: { codeFix: string; configFix: string; testCase: string };
  bountyTemplate: { title: string; severity: string; impact: string; poc: string };
}
export function buildCaseFile(findingId: string): CaseFile { /* pull from graph + evidence gate */ }
~~~

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/report/case-file.ts` | NEW | ~200 |
| `src/session/lifecycle.ts` | /report command | ~530 |
| `src/cli/solve.ts` | Write case files alongside report | ~167 |

---

## 5. Tests

- `test/report/case-file.test.ts`: buildCaseFile returns curl PoC reconstructed from recorded output.

---

*Spec Version: 1.0*
