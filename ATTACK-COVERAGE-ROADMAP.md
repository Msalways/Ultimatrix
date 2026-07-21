# Attack-Coverage Roadmap — Ultimatrix Lethality Expansion

> **STATUS: ALL WAVES COMPLETE (2026-07-20)** — 29/29 phases + Wave 4 done. Full suite 1632/1632 green, clean tsup build (ESM 1.53MB / CJS 1.56MB). 28 registered primitives (was 17) + 9 orchestrated external hacker tools (nuclei, sqlmap, ffuf, nmap, jwttool, arjun, corsy, subfinder, gitleaks). Dual-session matrix testing, marker-leak oracle, RBAC relation edges, and 11 new server-side/injection/BLA primitives implemented and evidence-gated.

**Goal:** Move Ultimatrix from "12 OWASP classes, single-identity, error/reflection-based" to
"full OWASP API Top 10 + OWASP Business Logic Abuse Top 10 (2025), multi-identity matrix testing,
cloud-takeover chains, deserialization/NoSQL RCE, blind-confirmed, evidence-gated."

**Principles (no bandaids / no hardcoded vocab):**
- No regex/keyword detection of *vocabulary* (node/edge/technique names discovered live via `getGraphSchema`/`queryRelations`).
- Structured typed fields + relation-native reasoning only. The LLM decides over structured data.
- Every new primitive follows the existing `claimFor` + `recordObserved` + `EvidenceGate.verifyClaim` pattern (no hallucinated findings).
- Masking (if any) is display-only; the evidence graph + replay carry raw values.
- Reuse existing oracles (`measureTiming`, `compareResponses`, `getOastCallbacks`, `markerLeakOracle`) rather than re-implementing.
- Multi-identity tests use REAL captured sessions (`useSession`/`SessionManager`), never synthetic `X-Role` header spoofing, for authorization conclusions.

---

## WAVE 1 — Authorization Matrix Keystone (no new attack logic, makes existing primitives lethal)
**Outcome:** Real endpoint × role matrix testing with marker-based leak proof + relational RBAC graph.

### Phase 1.1 — Dual-session orchestrator tool (`src/tools/dual-session.ts`)
- [x] `dualSessionOrchestrator` tool: accepts either (a) guided capture (two in-scope login URLs / or reuse browser sessions) or (b) a declarative `matrix.yaml` (roles + per-role headers/cookies + owned-object ids), OR both (guided capture emits a reusable matrix).
- [x] For guided mode: drive `useSession` for each role, persist via `SessionManager` keyed `${role}:${baseUrl}`; return a normalized `SessionMatrix` { roles: [{role, headers, ownedObjects}] }.
- [x] Emit the matrix to a JSON artifact for CI reuse / drift detection.
- [x] Scope-guard every URL it touches (`isUrlInScope`).
- [x] No hardcoded role-name list — roles come from input/the captured sessions.

### Phase 1.2 — Marker-leak oracle tool (`src/tools/marker-oracle.ts`)
- [x] `detectMarkerLeak` tool: inputs (victimResponse, attackerResponse, marker) → structured verdict { leaked: boolean, where: 'body'|'header'|'none', snippet }.
- [x] Pure comparison of typed strings; no regex vocabulary detection (the marker is caller-supplied, not inferred from a frozen list).

### Phase 1.3 — Wire `rbac-learner` into capture→analysis pipeline
- [x] Add `learnRBACFromSessions(matrix, store)` in `rbac-learner.ts`: for each role in the matrix, call `observeRole` with the role's accessible endpoints (derived from endpoints the role's session can reach), producing `RBACRoleNode`s. Remove dead-code status (currently zero callers).
- [x] Drive `learnRBACFromSessions` from the dual-session orchestrator result.

### Phase 1.4 — Instantiate RBAC relation edges
- [x] Add `recordRBACRelations(store, matrix)`: for each endpoint a role can reach, create `REQUIRES_ROLE` (Endpoint → RBACRole) and `HAS_ROLE` (RBACRole → Endpoint) edges; for role→permission, `PERMISSION` edges. So the graph can answer "which endpoints require admin" relationally (edges currently declared but never created).
- [x] Extend `getRBACMatrix` consumers to use these edges.

### Phase 1.5 — Fix `chaining.ts` alias map
- [x] Add the 5 missing primitives to `PRIMITIVE_TECHNIQUE`: `graphqlBola`→['graphql','bola'], `ssrfMetadata`→['ssrf','cloud-metadata'], `atoChain`→['ator','chain'], `aiAgentAttack`→['ai','agent'], and confirm `headerInjection` already present. (No hardcoded enum anywhere else.)

### Phase 1.6 — Tests + build + full suite
- [x] Unit tests: dual-session orchestrator (matrix build from provided sessions), marker-leak oracle (leak detected / not), rbac-learner wiring (nodes+edges created from matrix), chaining alias (new primitives match chain rules).
- [x] `npm run build:cli` clean; `npm test` green.

---

## WAVE 2 — Missing server-side classes + business-logic oracles (reuse existing oracles)
**Outcome:** NoSQL/SSRF-multicloud/blind-SSTI/deserialization-class coverage + BLA oracles.

### Phase 2.1 — `nosqlInjection` primitive (`src/primitives/nosqlInjection.ts`)
- [x] Operator injection for Mongo (`$ne`,`$gt`,`$regex`,`$where`), CouchDB, DynamoDB `FilterExpression`; auth-bypass + boolean/blind diff via `compareResponses` + `measureTiming`.
- [x] EvidenceGate-backed `claimFor`+`recordObserved`.

### Phase 2.2 — `ssrfMultiCloud` (extends `ssrfMetadata`/`ssrfOast`)
- [x] GCP (`Metadata-Flavor:Google`), Azure (`Metadata:true`) metadata paths; blind SSRF timing/OOB; IP encodings (decimal/hex/octal/IPv6) — encoding table as DATA, not detection logic; DNS-rebind + redirect-smuggle variants; `gopher://`/`file://`/`dict://` protocol smuggling.
- [x] Reuse OAST callback infra for confirmation.

### Phase 2.3 — `sstiBlind` timing wiring
- [x] In `rceClass.ts` (or new `sstiBlind.ts`): wire `measureTiming` for time-based blind SSTI; engine-specific RCE chains keyed off `frameworkFingerprint` result (Jinja2/OGNL/Freemarker/etc.) — engine list as data, chosen by typed fingerprint.

### Phase 2.4 — Business-logic oracles (OWASP BLA 2025)
- [x] `boplaOracle` (`src/primitives/boplaOracle.ts`): response-field over-exposure + mass-assignment of protected props (field-level, not just status). Uses typed `forbiddenFields` from the matrix/learned schema (data, not frozen list).
- [x] `artifactLifetime` (`src/primitives/artifactLifetime.ts`): stale token/session replay oracle (expired/revoked/post-logout still works).
- [x] `internalStateDisclosure` (`src/primitives/internalStateDisclosure.ts`): valid-vs-invalid response differential to leak internal state.
- [x] `tenantIsolation` (`src/primitives/tenantIsolation.ts`): cross-tenant marker leak (extends marker oracle across tenant sessions).

### Phase 2.5 — Tests + build + full suite.

---

## WAVE 3 — Transport + high-effort classes
**Outcome:** Deserialization RCE, second-order SQLi, LDAP/XPath, smuggling, shadow-API, remaining BLA.

### Phase 3.1 — `rawHttpClient` tool (`src/tools/raw-http-client.ts`)
- [x] Node `net`/`http2` raw socket with manual framing (CL+TE, custom methods, binary bodies). Scope-guarded. Enables smuggling + binary-blob delivery.

### Phase 3.2 — `deserialization` primitive + `gadgetGen`
- [x] `gadgetGen` helper: subprocess bridge to ysoserial/ysoserial.net + Python pickle `__reduce__` builder.
- [x] `deserialization` primitive: deliver gadget via `rawHttpClient`, confirm RCE via OOB/echo — EvidenceGate-backed.

### Phase 3.3 — Remaining injectables
- [x] `secondOrderSqli` (store→trigger→diff), `ldapInjection`, `xpathInjection`, `smuggling` (needs rawHttpClient).

### Phase 3.4 — Discovery + remaining BLA
- [x] `shadowApiDiscovery` (`src/tools/shadow-discovery.ts`): JS-bundle + OpenAPI + version-path enumeration of undocumented/admin endpoints (BLA10).
- [x] `actionLimitOverrun` (BLA1 TOCTOU), `logicLoopAbuse` (BLA4), `quotaAbuse` (BLA7).

### Phase 3.5 — Tests + build + full suite + final report.

---

## Success Metrics
- 17 → 30+ registered primitives; dual-session matrix testing active.
- RBAC graph queryable relationally (REQUIRES_ROLE/HAS_ROLE/PERMISSION instantiated).
- Blind/time-based + OOB confirmation wired for SQLi/SSTI/NoSQL/SSRF/deserialization.
- `npm test` green; `npm run build:cli` clean; zero new hardcoded vocab/regex detection.

---

## WAVE 4 — External Hacker-Tool Arsenal (orchestrated, evidence-gated) — COMPLETE

**Goal:** Make real best-of-breed hacker binaries first-class, evidence-gated tools instead of dead code. Reused the existing `traditional-tools.ts`/`delegator.ts` shellouts and REFACTORED them into a uniform `ToolAdapter` interface; deleted the dead `delegator.ts` (its `shouldDelegate` substring router violated the no-vocab-detection rule) and `traditional-tools.ts`.

**Delivered:**
- `src/tools/adapters/types.ts` — `ToolAdapter`, `AdapterFinding`, `ToolResult`, `BridgeReport` contracts.
- `src/tools/adapters/common.ts` — `isToolAvailable` (cross-platform, cached), `runBinary` (**execFile arg-arrays, no shell interpolation → kills command-injection**), `verifyFinding` (scope-guard + re-fetch confirmation → records into `coreEvidenceLedger` → `verifyClaimStructured`).
- `src/tools/adapters/bridge.ts` — `bridgeToolResult`: every external finding re-verified before it can become a Finding (user-chosen trust boundary).
- 9 adapters: `nuclei, sqlmap, ffuf, nmap` (refactored) + `jwttool, arjun, corsy, subfinder, gitleaks` (new).
- `src/tools/scanner-tools.ts` — `buildAdapterTool` (uniform Mastra tool; returns raw result + evidence-gate verdict).
- Wired into `registry.ts` (export + `registerAllTools`) and `toolpack.ts` (`externalTools` group → brain + council).
- Skill `toolRefs` extended (recon/web-security-advanced/api-security/auth-security/cors-misconfig/injection/osint) so adapters are discoverable, not dead.
- `test/primitives/coverage.test.ts` — added adapter-coverage drift guard (every adapter referenced by a skill; asserts `shouldDelegate` is gone).
- `test/tools/adapters.test.ts` — 17 tests: availability skip, stdout parsing per tool, bridge confirm/candidate/skip.

**Verified:** full suite 1632/1632 green; clean tsup build. Binaries are `isToolAvailable`-gated → graceful `skip` when not installed (no crash).

**Principle compliance:** no substring/vocab routing; orchestrate real binaries (don't reimplement scanners); evidence-gate every external claim; no command-injection in `exec`.
