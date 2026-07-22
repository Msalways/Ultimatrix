# Ultimatrix Depth Plan — From Shallow to Real-World

> **Root cause**: The shallowness is a CONTRACT + DATA problem, not an implementation problem.
> The brain cannot ask for depth (closed `TechniqueContext`), and even if it could, the primitives have no data to deliver (no payload infrastructure). Dead wiring compounds this.

## Three Root Causes

| # | Root Cause | Evidence | Fix |
|---|-----------|----------|-----|
| RC1 | **Closed contract** — no variant/DBMS/OAST/template fields; tool schema is a fixed `z.object` | `framework.ts:34-74`, `index.ts:290-319` | Expand contract + tool schema |
| RC2 | **No payload infrastructure** — zero `payloads/` dir, all payloads are 3-6 entry inline `const` arrays; `ctx.payloads` seam exists but nobody populates it | 40+ hardcoded arrays across `src/primitives/` | Build `PayloadStore` + data files + registry API |
| RC3 | **Dead wiring** — `isTargetBlocked()` has 0 call sites; reflexion passes `vulnType=""`; council imports 0 intelligence modules; evidence gate checks URL+method+status only | See wiring audit | Wire every intelligence layer into the execution path |

## Architectural Rules (no bandaids)

1. No hardcoded payload arrays in `.ts` files — all payloads in `payloads/*.json`, loaded via `PayloadStore`
2. No hardcoded field vocabularies — shape-detected or data-driven, not inline constants
3. No closed enums in tool descriptions — brain discovers variants by querying
4. Evidence gate verifies body signatures — not just URL+method+status
5. Intelligence layers GATE, not just observe — anti-loop blocks, reflexion forces switches
6. No duplicated payload arrays — single source of truth in `payloads/`
7. Council has reflexion/anti-loop visibility — debate members see failure history

---

## Phase 1: Payload Infrastructure (RC2) — PREREQUISITE

### 1.1 `PayloadStore` (`src/payloads/store.ts`)
- Loads `payloads/*.json` at startup, caches in memory
- `getPayloads(category, variant?)`, `getMarkers(category)`, `listCategories()`, `listVariants(category)`
- Fallback: empty array + warning if file missing (never crash)

### 1.2 `payloads/` data directory
Categories: sqli (error/union/boolean-blind/time-based/oob/waf-bypass), xss (reflected/stored/dom/filter-bypass/csp-bypass), ssrf (cloud-metadata/protocol-smuggling/internal-ips/url-confusion/redirect/params), ssti (jinja2/twig/velocity/freemarker/smarty/mako/generic), xxe (oob/inband/error), deserialization (java/python/php), request-smuggling (cl-te/te-cl/te-te/h2-cl), cache-poisoning, prototype-pollution, graphql, websocket, jwt, nosql, command-injection, ldap, xpath, race-conditions, authz, idor, workflow-bypass, business-logic

### 1.3 Extend `technique-registry.ts`
- `getPayloads(techniqueId, variant?)`, `getVariants(techniqueId)`, `getMarkers(techniqueId)` — delegates to `PayloadStore`

### 1.4 Remove all hardcoded payload arrays from primitives
- Delete every `const *_PAYLOADS`, `*_MARKERS`, `*_PARAMS`, `*_BYPASS` from `src/primitives/*.ts`
- Replace with `payloadStore.getPayloads(category, variant)` calls
- Remove duplicated arrays (SSRF_PARAMS in 2 files, SQLI_ERROR_MARKERS in 2 files, etc.)

### 1.5 Wordlist bootstrap
- Ship defaults in `payloads/wordlists/`
- `cli/init.ts` creates `~/.config/ultimatrix/wordlists/` and copies defaults
- ffuf adapter falls back to shipped wordlist if user dir absent

---

## Phase 2: Contract Expansion (RC1)

### 2.1 Expand `TechniqueContext`
Add: `variant`, `dbms`, `oastHost`, `requestTemplate`, `mutationStrategy`, `payloadSet`, `multiParam`, `concurrency`, `maxAttempts`

### 2.2 Expand `runPrimitive` tool schema
- Add all new fields to the `z.object` schema
- Brain can express: "run classicInjection with variant=union, dbms=mysql"

### 2.3 Add `listPrimitiveCapabilities` tool
- Returns available primitives, variants, required context, supported DBMSes
- Brain discovers attack surface dynamically

---

## Phase 3: Evidence Gate Strengthening (RC1)

### 3.1 Add body fields to `ObservedFacts`
- `requestBody`, `responseBody`, `responseTimeMs`

### 3.2 Body signature verification
- `claim.bodySignature?: { type: "contains"|"regex"|"timing"; pattern: string; threshold?: number }`
- Gate independently verifies body signature against recorded response

### 3.3 Update `framework.runPrimitive` to record body + timing
- Extend `recordObserved` to include `responseBody` and `responseTimeMs`

### 3.4 Remove circular self-verification
- `confirmed = verified` (gate's verdict), NOT `observed && verified`
- Primitive asserts claim with bodySignature → gate independently verifies

---

## Phase 4: Intelligence Layer Wiring (RC3)

### 4.1 Wire `isTargetBlocked()` into HTTP tools
- Check before every request; block if anti-loop flagged the host
- Wire `trackFailedTarget()` into HTTP error handler

### 4.2 Fix reflexion `vulnType` tracking
- Pass actual vulnType (not `""`) from solver — activates per-vuln escalation

### 4.3 Make reflexion GATE
- L3+: force strategy switch (not just prompt warning)
- L4: terminate current technique, move to different vuln class

### 4.4 Wire council to reflexion/anti-loop
- Inject failure history into each council member's context

### 4.5 Wire `measureTiming` into time-based primitives
- Calibrated baseline + multi-sample + jitter filtering

---

## Phase 5: Primitive Deepening (leverages P1-P4)

### 5.1 classicInjection — SQLi overhaul
Variants: error-based, union-based, boolean-blind, time-based, oob, stacked-queries. UNION extraction. DBMS fingerprinting. Multi-param. WAF bypass from data files. Calibrated time-based.

### 5.2 authzMatrix — real matrix
N roles x M endpoints x K objects. Token swap. Privilege escalation. Cross-tenant.

### 5.3 concurrencyHarness — real race exploitation
Barrier sync (last-byte). HTTP/2 single-packet. Token reuse handling. Business invariant validation. Configurable iterations.

### 5.4 configTrust — remove hardcoded field lists
Shape-detect trust fields from response structure. Mass-assignment probe. Type confusion. Nested object tampering.

### 5.5 idorSwapper — add discovery
Incremental ID walking. UUID prediction. Method swap. Cross-object-type testing.

### 5.6 ssrfOast — expand injection surface
Headers (Host, X-Forwarded-For). Protocol smuggling. DNS rebinding. Redirect-based. Cloud metadata (merge ssrfMetadata + ssrfMultiCloud into variants).

### 5.7 workflowBypass — multi-step state machine fuzzing
Step skipping. Stale token replay. CSRF tampering. Terminal body shape replay.

### 5.8 invariantProbe — expand mutation strategies
Boundary values. Type confusion. Boolean flip. Nested object probing. Multiple mutation strategies.

---

## Phase 6: New Primitives (missing vulnerability classes)

### 6.1 `xxePrimitive` — XXE (OOB, inband, error-based)
### 6.2 `deserializationPrimitive` — Java/Python/PHP gadget chains
### 6.3 `requestSmugglingPrimitive` — CL.TE, TE.CL, TE.TE, HTTP/2
### 6.4 `cachePoisoningPrimitive` — unkeyed headers, fat GET, HTTP desync
### 6.5 `prototypePollutionPrimitive` — client + server-side
### 6.6 `graphqlPrimitive` — introspection, batching, aliasing, depth, suggestions
### 6.7 `websocketPrimitive` — CSWSH, auth bypass, injection
### 6.8 `sstiPrimitive` (split from rceClass) — per-engine detection + blind
### 6.9 `jwtPrimitive` — alg confusion, null sig, weak secret, kid injection

---

## Phase 7: Adapter Fixes + New Integrations

### 7.1 Fix gitleaks adapter
- Read `--report-path` file (not stdout) for JSON output

### 7.2 Fix jwttool binary name
- Try `jwt_tool` then `jwttool` fallback

### 7.3 Add sqlmap `-r` request-file support
- Pass captured authenticated requests with full headers

### 7.4 Add missing adapters
- `commix` (command injection), `dalfox` (XSS), `hydra` (auth brute force), `testssl.sh` (TLS audit), `nikto`, `kiterunner` (API brute), `amass` (subdomain enum), `whatweb` (fingerprinting)

---

## Phase 8: Skill Library Enrichment

### 8.1 Deepen 13 shallow skills
- blind-ssrf, api-fuzzing, security-headers-audit, file-upload-attacks, cors-misconfig, etc. — from ~55 lines to deep methodology

### 8.2 Fill 3 stub skills
- ai-mcp-security, ctf-crypto, reporting

### 8.3 Add new skills for new primitives
- xxe-attacks, deserialization-attacks, request-smuggling, cache-poisoning, prototype-pollution, graphql-attacks, websocket-attacks

---

## Phase 9: Brain Instructions Update

### 9.1 Multi-step primitive composition
- Brain directs: probe -> fingerprint -> exploit -> extract
- `priorResponse` chaining across primitives (not just within)

### 9.2 Variant-aware tool selection
- Brain queries `listPrimitiveCapabilities` before selecting
- Brain selects variant + DBMS + payloadSet based on recon findings

### 9.3 Exploitation-readiness directive
- Brain aims for exploit-readiness (proof, not just detection)
- Uses `writeFinding` with `exploitProof` for reproducible exploits

---

## Execution Order + Dependencies

```
P1 (payloads) ────────────────────┐
                                   ├──> P5 (deepen primitives)
P2 (contract) ────────────────────┤
                                   ├──> P6 (new primitives)
P3 (evidence gate) ─────────────── ┤
                                   │
P4 (intelligence wiring) ─────────┘
                                   
P7 (adapter fixes) ── independent, parallel with P1-P6
P8 (skills) ── depends on P6 (new primitives need new skills)
P9 (brain) ── depends on P2 + P5 + P6
```

## Parallelization Strategy

**Wave A (parallel):**
- P1.1 PayloadStore + P1.2 data files (foundation)
- P7.1-7.3 Adapter fixes (independent)
- P4.1 Wire anti-loop into HTTP tools (independent)
- P4.4 Wire council to reflexion (independent)

**Wave B (parallel, after Wave A):**
- P2 Contract expansion (needs P1 for payloadSet field)
- P3 Evidence gate strengthening (independent of P1/P2)
- P4.2-4.3 Reflexion fixes (independent)
- P4.5 measureTiming wiring (independent)

**Wave C (parallel, after Wave B):**
- P5.1-P5.8 Primitive deepening (needs P1+P2+P3)
- P6.1-P6.9 New primitives (needs P1+P2+P3)

**Wave D (after Wave C):**
- P8 Skills enrichment (needs P6)
- P9 Brain instructions (needs P2+P5+P6)
