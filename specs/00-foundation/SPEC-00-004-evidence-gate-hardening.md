# SPEC-00-004: Evidence Gate Hardening (Receipt-Backed Findings Only)

**Status:** 📋 Planned  
**Phase:** 00 - Foundation  
**Priority:** P0 (Correctness)  
**Date:** 2026-07-09  
**Depends On:** SPEC-99-001

---

## 1. Problem Statement

`EvidenceGate` (`src/intelligence/evidence-gate.ts`) exists and is well-built, but it is **not enforced at the write boundary**. `writeFinding` in `src/tools/control-tools.ts` can record a finding without verifying the claim against recorded tool output. Primitives can also return `confirmed: true` without an EvidenceGate check. This produces hallucinated findings in the graph - the single biggest trust problem for an autonomous analyst.

---

## 2. Acceptance Criteria

~~~
AC-00-004-1: writeFinding rejects any finding whose claim does not pass EvidenceGate.verifyClaim()
AC-00-004-2: Primitives return confirmed:true ONLY after EvidenceGate verification of the claim
AC-00-004-3: Unverified findings are logged (forensic) but NOT written to the graph
AC-00-004-4: A regression test proves a fabricated claim is rejected
~~~

---

## 3. Technical Design

### 3.1 Enforce in writeFinding (`src/tools/control-tools.ts`)
~~~
export async function writeFinding(params) {
  const claim = '[' + params.type + '] on ' + params.endpoint +
    ' status ' + params.status + ' ' + (params.payload ?? '');
  const verification = evidenceGate.verifyClaim(claim);
  if (!verification.verified) {
    log.warn('Unverified finding NOT written: ' + params.description);
    getForensicLog()?.log({ type: 'unverified-finding', description: params.description, missing: verification.missing });
    return;
  }
  // only now write to graph
  await graphStore.createNode({ type: NodeType.FINDING, properties: { ...params, evidence: verification.flagsInEvidence } });
}
~~~

### 3.2 Primitives must verify
In `src/primitives/index.ts` `runPrimitiveById`, the `oracle()` result already consults the gate; enforce that `result.confirmed` requires `verified` from `verifyClaim`. If a primitive sets confirmed:true but the gate says unverified, downgrade to unconfirmed.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/tools/control-tools.ts` | Gate check before write | ~50 |
| `src/primitives/index.ts` | Enforce verified before confirmed | ~120 |

---

## 5. Tests

- `test/intelligence/evidence-gate-enforce.test.ts`: fabricated claim rejected; real recorded output accepted.

---

*Spec Version: 1.0*
