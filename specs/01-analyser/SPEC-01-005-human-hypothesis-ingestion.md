# SPEC-01-005: Human Hypothesis Ingestion

**Status:** 📋 Planned  
**Phase:** 01 - Business-Logic Analyser  
**Priority:** P1  
**Date:** 2026-07-09  
**Depends On:** SPEC-01-001

---

## 1. Problem Statement

The product advertises Human-in-the-Loop, and `HypothesisNode` exists in the schema, but there is **no ingestion path** for a human to say: "I think cartId from /cart flows into /checkout as cart_id - test IDOR there." Without this, the collaborative-colleague model is broken; the human cannot steer the analyst.

---

## 2. Acceptance Criteria

~~~
AC-01-005-1: A structured ingest API accepts a human hypothesis (title, kind, reason, targetEndpoints)
AC-01-005-2: Ingested hypothesis is written as a HypothesisNode (origin: 'human', status: 'open')
AC-01-005-3: A /hypothesis REPL command and a flow-tools entry point exist
AC-01-005-4: The Campaign Planner boosts slices matching an open human hypothesis
~~~

---

## 3. Technical Design

New `src/analysis/hypothesis-ingest.ts`:
~~~
export class HypothesisIngestor {
  ingest(input: HumanHypothesis): HypothesisNode {
    return addHypothesis({ ...input, origin: 'human', status: 'open' });
  }
  validate(h: HypothesisNode): boolean { /* require title + targetEndpoints */ }
}
~~~

REPL integration in `src/session/lifecycle.ts`:
~~~
case '/hypothesis': {
  const h = parseHypothesisArgs(line);
  const node = getGlobalHypothesisIngestor().ingest(h);
  log.info('Hypothesis recorded: ' + node.id);
  break;
}
~~~

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/analysis/hypothesis-ingest.ts` | NEW | ~80 |
| `src/session/lifecycle.ts` | /hypothesis command | ~530 |
| `src/campaign/planner.ts` | Boost open hypotheses | ~160 |

---

## 5. Tests

- `test/analysis/hypothesis-ingest.test.ts`: ingest writes a human HypothesisNode with status open.

---

*Spec Version: 1.0*
