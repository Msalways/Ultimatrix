# SPEC-00-003: Observation Tool Integration into Brain (Flat Toolset)

**Status:** 📋 Planned  
**Phase:** 00 - Foundation  
**Priority:** P0 (Critical)  
**Date:** 2026-07-09  
**Depends On:** SPEC-00-001

---

## 1. Problem Statement

The brain agent (`src/solver/brain-tools.ts`) has a **hardcoded ~30-tool set** that omits the observation primitives the product already built in `src/tools/observation-tools.ts`: `measureTiming`, `evaluateRendered`, `compareResponses`, `findEndpointsInResponse`, `checkWaf`, `parseResponse`. The spider agent uses them, but the strategist brain does not. Result: the brain literally cannot perform blind SQLi timing tests, XSS DOM checks, parameter-tampering diffs, or endpoint discovery.

The skill-based tool filter (`src/solver/skills/tool-filter.ts`) is a keyword heuristic that can MISS a needed tool (e.g. `measureTiming` when no skill triggered). Per MULTIMODEL-INTERACT-PLAN.md the decision is: **flat full toolset on the brain; skills are methodology guidance only, never a tool gate.**

---

## 2. Acceptance Criteria

~~~
AC-00-003-1: Brain agent has direct access to all observation tools (measureTiming, evaluateRendered, compareResponses, findEndpointsInResponse, checkWaf, parseResponse)
AC-00-003-2: Brain also has recon/scanner/JWT/GraphQL/browser/OAST/graph tools (no skill-based filtering restricts availability)
AC-00-003-3: tool-filter.ts is reduced to advisory-only (used by workers, not the brain)
AC-00-003-4: A tool-call smoke test confirms the brain can invoke evaluateRendered + measureTiming
~~~

---

## 3. Technical Design

### 3.1 Import + wire (`src/solver/brain-tools.ts`)
~~~
import {
  measureTiming, evaluateRendered, compareResponses,
  findEndpointsInResponse, checkWaf, parseResponse,
} from '../tools/observation-tools';
import { decodeJWT, encodeJWT, jwtTamper } from '../tools/jwt-tools';
import { introspectGraphQL, batchGraphQL } from '../tools/graphql-tools';
import { getCapturedHeaders } from '../tools/session-tools';

const allTools = {
  // core
  httpRequest, followRedirects, omitHeader, multipartUpload,
  graphQuery, graphWrite, oastCallback, getCapturedHeaders,
  // observation (CRITICAL)
  measureTiming, evaluateRendered, compareResponses,
  findEndpointsInResponse, checkWaf, parseResponse,
  // auth / api
  decodeJWT, encodeJWT, jwtTamper, introspectGraphQL, batchGraphQL,
  // browser
  stagehandNavigate, stagehandClick, stagehandFill, stagehandExtract,
  // skills (methodology only)
  loadSkillReference, searchSkillTool,
};
~~~

### 3.2 Remove the brain skill gate
Stop calling `resolveToolsForSkills()` to restrict the brain. Keep it for worker pool only.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/solver/brain-tools.ts` | Import + merge observation/auth/browser tools; drop gate | ~155, ~300 |
| `src/solver/skills/tool-filter.ts` | Mark advisory; no longer called by brain | - |

---

## 5. Tests

- `test/solver/brain-tools.test.ts`: assert `measureTiming` and `evaluateRendered` keys exist on the brain tool map.
- `test/integration/brain-tool-smoke.test.ts`: brain can call evaluateRendered on a test URL.

---

*Spec Version: 1.0*
