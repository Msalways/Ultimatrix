# Ultimatrix — Business-Logic Exploitation Buddy: Layered Task Plan

> **Status:** Build mode. This plan is the synthesis of a long R&D discussion about making
> Ultimatrix *lethal* at real-world business-logic flaws (not just injection checklists), via
> an **experienced-attacker buddy** relationship with the user (not master/slave), driven by
> **faithful, pattern-free, LLM-navigated reasoning over the full captured traffic**.
>
> **Hard constraints (locked from discussion + finalized 2026-07-16):**
> 1. **No new engine.** Update the existing multi-model solver brain + session relationship.
> 2. **No hardcoded patterns / regex** for detection or hypotheses. Rigid logic only on
>    deterministic seams (value-equality, status compare, structural shape inference).
> 3. **No hardcoded enumerations in descriptions.** Tool/agent descriptions say WHAT + HOW,
>    never enumerate the value universe (node types, edge types, tool names, scenario kinds).
>    The LLM discovers vocabulary by QUERYING a live schema-discovery tool — never from a
>    frozen string. This is the same rigidity failure as regex detection, just in prose.
> 4. **Buddy, not master/slave.** LLM = experienced attacker; user + LLM *mutually* decide and
>    execute via the existing `askUser`/chat consensus seam.
> 5. **Exploit-readiness > bug report.** Every candidate drives toward a reproducible proof +
>    optional live replay.
> 6. **"User level" = product/domain understanding only.** Feeds the brain's model of *this
>    app's* business logic. **Never** throttles or alters LLM behavior.
> 7. **No blind truncation.** The LLM must perceive the *full capture* via complete structured
>    access and decide what to look at — not receive a pre-digested, lossy summary.
> 8. **No hand-slicing of platform-native mechanisms.** Use the platform/transport's native,
>    spec-compliant surface; never re-implement a subset that silently drops fields.

---

## 0. Why this plan exists (the problem space)

Business-logic flaws are a top bounty category and modern apps are hard targets for naive tools:

- Validation is in JS (React Hook Form / Yup / Zod), **not** in DOM attributes → DOM scraping is useless.
- The real signal is **relational**: a value from API-A's response feeds an input on API-B's page,
  and API-B re-ingests it without re-authoring → trust-boundary / mass-assignment / IDOR-style flaw.
- "Value from a different API feeds the next page unintentionally" = business-logic bug the backend
  doesn't enforce. There are **infinitely many** such scenarios; hardcoding patterns is a trap.

### Confirmed root-cause findings (verified in source, not assumed)
- Stagehand v3 is **CDP-native**. `page.on('response')` is unsupported (`Unsupported event: response`).
  The live `context.conn` IS the right CDP surface — our own `src/browser/dialog-watcher.ts:51`
  already uses `stagehand.context.conn` successfully for `Target.*` events. `Network.enable` on it
  is context-wide (covers human + spider + agent in one listener).
- There is **NO Playwright `BrowserContext` inside the live Stagehand session** — `playwright` only
  appears in *tests* that `connectOverCDP` from OUTSIDE. So Playwright `recordHar` / `page.route`
  (options we would have preferred) are **unreachable inside the session**. CONSEQUENCE: CDP
  `Network.*` is the **platform-native, spec-compliant** capture surface here — not a lazy slice.
- The LLM's *only* windows onto captured data today are: (a) `harContextForLLM` — a **hardcoded
  prose summary** (`buildHARContextForLLM`), and (b) `queryGraph` — a **flat node dump capped at 50**.
- `src/research/hypothesis-engine.ts` uses **regex on field/URL names** (`/id|uuid|slug/`,
  `/user|billing|invoice/`, `/billing|admin|role/`) — the exact rigidity we reject.
- The co-pilot / `askUser` / chat relationship shell **already exists**; the gap is the *cognitive
  content* flowing through it (no relational reasoning, no exploit-readiness, lossy context).

### The missing lethal seam (the user's key insight)
The LLM must be able to **query the captured data relationally** and **perceive the full capture**
without blind truncation. Adding a relational query tool *alone* is insufficient while the base
context is still a truncated summary. Hence **Layer 0 (capture awareness)** is added before reasoning.

---

## 1. Layered architecture (update-mode, no new engine)

```
 Layer 0  Capture Awareness      → LLM perceives FULL capture structurally (no blind truncation);
                                    live schema-discovery tool (no hardcoded vocab in descriptions)
 Layer 1  Live Capture (CDP)     → faithful traffic from human + spider + agent; HAR assembled by
                                    har-parser.ts (single owner), capture module = thin subscriber
 Layer 2  Typed Relations        → provenance / reingest / ordering edges (structural, no regex)
 Layer 3  Relational Query Tool  → LLM DECIDES what scenario exists; tool returns subgraph + seeds
 Layer 4  Regex-free Hypotheses  → refactor hypothesis-engine: LLM decides over relations
 Layer 5  Buddy Brain            → exploitation-first, mutual consensus, product-context aware
 Layer 6  Mutation + Oracle      → relation-seeded probe reuses invariantProbe oracle
 Layer 7  Exploit-Readiness      → ExploitProof node + chat delivery + askUser-gated replay
 Layer 8  Wiring                 → into existing solver loop + active-chaining (no new engine)
 Layer 9  Tests + Verification   → pattern-free, scenario-proven
```

---

## 2. Task-level breakdown

### LAYER 0 — Capture Awareness (closes the "blind truncation" gap)
**Goal:** The LLM perceives the whole dataset structurally, on demand, without lossy pre-summary.

- [ ] **L0.1** `getCaptureOverview` tool (`src/graph/relation-tools.ts`):
  - Returns **structural metadata only, no bodies**: per-endpoint request count, methods,
    status distribution, which endpoints emit which response-field names, which request fields
    have a provenance edge, count of cross-API reingestions present. Cheap, complete.
  - Gives the LLM the "network-tab shape" intuition a human hunter has.
  - Description is **type-agnostic**: it states WHAT it returns and HOW to use it, and tells the
    LLM to discover valid relation/field vocabulary via the schema-discovery tool — it does **not**
    enumerate node/edge/relation names in the description string.
- [ ] **L0.2** Remove the hard `limit: 50` cap on `queryGraph` (`src/graph/tools.ts`): make it
  scenario/scoped (filter by type+filters) instead of a global truncation. Allow unbounded when
  filters narrow. Description also made type-agnostic (no enumerated type lists).
- [ ] **L0.3** Add a **schema-discovery tool** `getGraphSchema` (`src/graph/relation-tools.ts`):
  returns the **live** vocabulary of node types, edge types, and relation kinds from the graph
  store + relation registry. This is the single source the LLM queries to learn valid vocabulary —
  eliminating the need for any hardcoded list in any tool description. (No hardcoded enum in the
  tool itself either: it reflects the registry at runtime.)
- [ ] **L0.4** Demote `harContextForLLM` from *primary* brain injection to *optional* supplementary.
  In `src/session/lifecycle.ts` stop auto-injecting the pre-summarized string as the brain's main
  window; instead the brain starts each hunt by calling `getCaptureOverview` + the relational query
  tool (explores like a human, rather than reading a fixed summary).
- [ ] **L0.5** (optional/later) Semantic retrieval over raw HAR entries (embed request/response
  shapes; "requests similar to this"). Enhancement, not required for v1.

### LAYER 1 — Live Capture via CDP (correctly layered, no hand-slicing)
**Goal:** Faithful traffic from human + spider + agent in one listener, with **complete** headers/
cookies (incl. `ExtraInfo` events), assembled by a single owned builder.

- [ ] **L1.1** Extend `src/capture/har-parser.ts` with a **single HAR-entry builder**:
  `createHarEntryBuilder()` → accumulates CDP `Network.*` events into a `HarEntry`, correctly
  merging `requestWillBeSentExtraInfo` / `responseReceivedExtraInfo` (cookies/headers split across
  two events in modern CDP) into the in-flight entry via `requestId`. `finish()` returns a valid
  `HarEntry`. This is the **only** place that assembles HAR from CDP — no duplicate logic elsewhere.
- [ ] **L1.2** New `src/session/cdp-network-capture.ts` = **thin CDP subscriber only**:
  - `attachHarCaptureViaCdp(stagehand, opts): CdpCaptureHandle`
  - `const conn = stagehand.context.conn; if (!conn?.on) return noopHandle;`
  - `await conn.send('Network.enable', {})`
  - Subscribes to the **full** `Network.*` event set: `requestWillBeSent`,
    `requestWillBeSentExtraInfo`, `responseReceived`, `responseReceivedExtraInfo`,
    `dataReceived`, `loadingFinished` (+`Network.getResponseBody`), `loadingFailed`.
  - Each handler forwards raw params to the `har-parser` builder (L1.1) — **no HAR-assembly logic
    lives here**. Reuses `NetworkCapture` scope/shouldCapture + `maxResponseBodySize` (1MB) for the
    body-fetch decisions only.
  - Returns `{ stop(): Promise<void> }` → `Network.disable` + remove listeners.
- [ ] **L1.3** Update `src/session/lifecycle.ts`: prefer `attachHarCaptureViaCdp(requireStagehand())`
  (deferred until `context.conn` ready, mirroring human-observer's timed attach); fallback to
  `startHarCapture` only when no Stagehand context (headless `solve`). Feeds existing
  `bridgeHARToGraph` unchanged.
- [ ] **L1.4** Deprecate `attachHarCaptureToPage` in `src/session/har-capture.ts` (dead `page.on`
  path) — mark `@deprecated`, keep for back-compat. The broken Playwright `NetworkCapture.page.on`
  path is superseded by L1.2.

### LAYER 2 — Typed Relations (structural, no regex)
**Goal:** Relations are computed from data, never from keywords.

- [ ] **L2.1** `src/graph/schema.ts`: add edge types for provenance / reingest / ordering. Add
  `endpointKey` (method + normalized path) to `EndpointNode.properties` + `NODE_PROPERTIES`. Add an
  `ExploitProof` node type + its confirming edge (used in L7).
- [ ] **L2.2** Update `src/analysis/analyser.ts` + `src/analysis/har-bridge.ts`: the *existing*
  value-provenance / `getDataFlows` logic now **writes typed edges** instead of only prose facts.
  Value matching = structural equality/substring across captured request/response fields — **no
  field-name regex**.
- [ ] **L2.3** Fix `src/capture/render-bridge.ts`: resolve the `Endpoint` by `endpointKey` so
  rendered-element edges are real (currently drop because `endpointId` is `undefined` at capture time).
- [ ] **L2.4** Ordering edges from `human-observer` action order (complementary; console bridge
  unchanged) — wire into graph.

### LAYER 3 — Relational Query Tool (LLM decides)
**Goal:** The seam that lets the LLM interrogate the data to spot a scenario. **No hardcoded
scenario enum** — the tool accepts a free-form structural question and the LLM is free to ask about
whatever relation/shape it infers; the tool answers over the live graph.

- [ ] **L3.1** New relational query tool (in `src/graph/relation-tools.ts`, registered in
  `src/core/toolpack.ts`): LLM asks a *structural* question, gets back the precise subgraph +
  candidate mutation seeds. Example shapes it can surface (illustrative only — **not** an enum the
  tool enforces): a value from one endpoint's response that later appears in a *different* endpoint's
  request; origin of a given value; requests sendable without a prior workflow step; mass-assignment
  shape by provenance rather than field name. The tool description lists **how** to query
  (filters/relation types discovered via `getGraphSchema`) — not a frozen list of scenarios.
- [ ] **L3.2** Output is **evidence, not verdict**: returns the relation + the two real
  requests/responses. **The LLM decides** exploitability + approach. No hardcoded "this is IDOR".

### LAYER 4 — Regex-free Hypotheses (replaces rigidity)
**Goal:** Remove hardcoded regex; LLM decides hypotheses over relations.

- [ ] **L4.1** Refactor `src/research/hypothesis-engine.ts`: **delete all regex**
  (`/id|uuid|slug/`, `/user|billing|invoice/`, `/billing|admin|role/`). Feed the LLM the structured
  relations (L2/L3) and let it *propose* hypotheses via reasoning. Keep `ResearchHypothesis` output
  type so `experiment-planner`, campaign, UI stay intact. Keep non-detection logic (dedupe, stable
  IDs, confidence sort).
- [ ] **L4.2** Ensure downstream consumers (`experiment-planner.ts`, `campaign/planner.ts`,
  `graph-adapter.ts`) still work with the refactored generator output shape.

### LAYER 5 — Buddy Brain (update `brain-instructions.ts`)
**Goal:** Experienced-attacker buddy; mutual consensus; exploitation-first.

- [ ] **L5.1** Update `src/solver/brain-instructions.ts`:
  - Add **exploitation-first mandate**: "A bug report is low value. Your job with the user is to
    *prove exploitability and impact*." Drive candidates → reproducible proof.
  - Add **relational reasoning guidance**: use the relational query tool + `getCaptureOverview` to
    hunt trust-boundary / cross-API / workflow-order scenarios; reason over returned subgraph; never
    rely on name patterns. Discover valid relation/field vocabulary via the schema-discovery tool.
  - Reframe HITL as **mutual consensus** (not gatekeeping): propose approach, discuss via chat,
    agree, then execute together. Keep `askUser` as the seam.
  - **Experience-aware explanation**: calibrate *explanation depth* to user (infer from chat) —
    affects *how it explains*, never *what it may do*.
- [ ] **L5.2** "User level" as **product-domain context** (C1/Q3): add optional `productContext`
  block (what the app does, entities, roles) into brain context — sourced from graph + user chat.
  Informs the brain's model of the business logic; **not** a behavior throttle.

### LAYER 6 — Mutation + Oracle (reuse invariantProbe)
**Goal:** Turn a spotted scenario into a backend-bypass test.

- [ ] **L6.1** New `src/primitives/constraint-mutators.ts` (pure, typed):
  `mutationsFor(relation)` → generates violations from relation type + captured value *shape*
  (numeric/uuid/enum inferred structurally, not by name).
- [ ] **L6.2** Extend `src/primitives/invariantProbe.ts` (update, not new primitive): accept a
  relation-seeded spec via `TechniqueContext` open `[key:string]` field. Baseline = real captured
  request; mutated = violate the relation (foreign value / omit field / out-of-order / boundary).
  Oracle = existing `observeCompare` + `claimFor` + EvidenceGate (differential status/divergence —
  no substring guessing).

### LAYER 7 — Exploit-Readiness Output (C2 = Option C)
**Goal:** Impact = reproducible exploit, mutually executed.

- [ ] **L7.1** `ExploitProof` node (`src/graph/schema.ts`, L2.1): `{ findingId, request
  (method/url/headers/body), expectedVulnerableResponse, reproSteps[], replayable, status }`.
  Edge → `Finding`.
- [ ] **L7.2** Update `src/tools/control-tools.ts` (`writeFinding`): on probe confirmation, also
  emit an `ExploitProof`.
- [ ] **L7.3** Chat delivery: brain writes the concrete request (curl/HTTP) into chat + *offers*
  to run it.
- [ ] **L7.4** Agent replay (gated): `askUser` consensus → agent replays exploit live via existing
  http/browser tools; result recorded on `ExploitProof`.
- [ ] **L7.5** (minimal) Web UI findings tab shows `ExploitProof` (durable, viewable).

### LAYER 8 — Wiring (existing loop, no new engine)
- [ ] **L8.1** Relational query tool + refactored hypotheses join the **existing** solver toolpack
  (`toolpack.ts`) + brain context.
- [ ] **L8.2** Existing active-chaining hook in `solver.ts` consumes relations → emits
  `invariantProbe` intents → confirms → `ExploitProof`.
- [ ] **L8.3** HITL/`askUser` gates mutating probes + replay; budget tracker caps probe count.
- [ ] **L8.4** `human-observer` action order feeds ordering edges (complementary; console bridge
  unchanged).

### LAYER 9 — Tests + Verification
- [ ] **L9.1** `test/session/cdp-network-capture.test.ts`: mocked `context.conn`; emit the **full**
  `Network.*` event set incl. `requestWillBeSentExtraInfo`/`responseReceivedExtraInfo` → assert HAR
  entry has complete headers/cookies (proves ExtraInfo merge + human-traffic capture).
- [ ] **L9.2** `test/graph/relations.test.ts`: provenance/reingestion/ordering edges built
  structurally; cross-API reingestion detected.
- [ ] **L9.3** `test/graph/relation-tools.test.ts`: relational query returns subgraph for a
  value-from-A-feeds-B fixture.
- [ ] **L9.4** `test/graph/schema-discovery.test.ts`: `getGraphSchema` reflects live registry (no
  hardcoded list); `getCaptureOverview` + query tool descriptions contain no enumerated vocab.
- [ ] **L9.5** `test/research/hypothesis-engine.test.ts`: **assert no regex** — hypotheses derive
  from relations; update existing tests.
- [ ] **L9.6** `test/primitives/invariantProbe.test.ts` + `constraint-mutators.test.ts`: relation-
  seeded mutation → backend tolerates → confirmed; backend re-enforces → not confirmed.
- [ ] **L9.7** `test/graph/exploit-proof.test.ts`: `ExploitProof` node + confirming edge on confirm.
- [ ] **L9.8** Regression: `npx vitest run` green + `npm run build:cli` clean. Manual `interact`:
  manual login → brain uses relational query to spot cross-API trust-boundary → proposes in chat →
  user agrees → probe confirms → `ExploitProof` delivered.

---

## 3. Recommended sequencing (validate the seam before building on it)

1. **Pass A — L0 + L1** (capture awareness + faithful capture). Verify the LLM can *perceive the full
   capture* and the human-action HAR gap is closed, with complete headers via ExtraInfo.
2. **Pass B — L2 + L3** (relations + query tool). Verify the relational seam surfaces the
   "value from API-A feeds API-B" scenario on a fixture. **This is the make-or-break checkpoint** —
   if the relational seam finds the scenario, the rest is execution.
3. **Pass C — L4 + L5** (regex-free hypotheses + buddy brain).
4. **Pass D — L6 + L7 + L8** (mutation/oracle + exploit-readiness + wiring).
5. **Pass E — L9** (tests + verification).

---

## 4. Decisions locked

| # | Question | Decision |
|---|----------|----------|
| Q1 | New engine vs update? | **Update existing** brain/solver/session. No new engine. |
| Q2 | Exploit-readiness output? | **Option C**: ExploitProof node + chat delivery + askUser-gated replay. |
| Q3 | "User level" interferes with LLM? | **No** — product/domain context only, never a behavior throttle. |
| C1 | Hardcoded regex? | **Remove**; LLM decides over structured relational data. |
| C2 | Exploit output location? | **Option C** (node + chat + replay). |
| Blind truncation | LLM sees lossy summary? | **Layer 0** — complete structured access, LLM navigates. |
| O1/O2 | Playwright recordHar / page.route inside Stagehand? | **Unavailable** (CDP-native). Use CDP `Network.*` — the platform-native surface. |
| Slicing | Hand-roll HAR from CDP subset? | **No.** HAR assembled only by `har-parser.ts`; capture = thin subscriber. ExtraInfo events merged. |
| Vocab | Hardcoded node/edge/scenario lists in descriptions? | **No.** `getGraphSchema` live-discovery; descriptions type-agnostic. |

---

## 5. Is anything pending in the EXPANSION plan phase?

This plan is **orthogonal** to the existing `EXTENSIBILITY-TASK-PLAN.md` (MCP/plugin/skill
discovery + merit arbitration). That plan is **complete** (P0–P3 done, 1458 tests green at last
record). What is **pending / not yet started** that this business-logic work depends on or relates
to:

### 5.1 Directly required by this plan (must be done, not yet started)
- [ ] **Live HAR capture fix (L1)** — currently broken (`page.on('response')` unsupported). This is
  the foundation; without it L2–L8 have no data. **This is the #1 pending item.**
- [ ] **Relation graph edges (L2)** — provenance / reingest / ordering do not exist yet as
  queryable edges (only prose facts today).
- [ ] **Relational query tool (L3)** — does not exist.
- [ ] **`hypothesis-engine` regex removal (L4)** — file still has regex (verified).
- [ ] **`ExploitProof` node (L2/L7)** — does not exist.

### 5.2 Expansion-plan items that remain open (from EXTENSIBILITY-TASK-PLAN, not started)
> NOTE: The extensibility *framework* (P0–P3) is implemented. The items below are the **optional
> post-MVP expansions** that were scoped but not built:

- [ ] **MCP tool *result* caching / rate-limit per external server** (transport-level fairness).
- [ ] **Plugin sandboxing** (load user plugins in isolated context; currently trusted import).
- [ ] **Skill merit *decay* over time** (techniques that stop producing findings lose weight
  automatically — arbitration exists, decay loop not built).
- [ ] **Cross-session MCP server discovery persistence** (auto-detected servers remembered).
- [ ] **Web UI for MCP/plugin management** (currently CLI-only via `ultimatrix mcp add/list/remove/detect`).

### 5.3 Deliberately OUT of scope (do not build)
- DOM-attribute validation scraping (useless for modern RHF/Yup apps).
- A new engine/loop (anti-churn mandate).
- Regex/keyword-based detection or hypothesis generation (rigidity, rejected).
- Treating "user level" as an LLM behavior throttle.
- Hand-rolled HAR assembly from a subset of CDP events (bandaid; HAR owner = `har-parser.ts`).

---

## 6. Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `context.conn` doesn't emit `Network.*` (only `Target.*`) | Low (same browser-level domain) | Fallback to per-page CDP session on first empty capture |
| `getResponseBody` fails for opaque/large responses | Medium | try/catch + size guard, skip |
| `harContextForLLM` demotion breaks existing prompts | Low | Keep as optional; verify solver still gets enough context via L0/L3 |
| Relation graph too large / slow on dense apps | Medium | Topology-bounded queries (only existing relations) + budget cap (L8.3) |
| Over-explaining to an expert / under-explaining to beginner | Low | Infer from chat; explanation depth only |
| Secret leakage via commit | Pre-existing | `ultimatrix.yaml` excluded from all commits (plaintext cred in history) |

---

## 7. Definition of done (per layer)

- **L0:** LLM can call `getCaptureOverview` and receive complete structural metadata for a session
  with 1000+ requests without truncation; `getGraphSchema` returns live vocabulary; descriptions
  contain no enumerated type lists.
- **L1:** A manual human login in `interact` produces HAR entries with **complete** headers/cookies
  (ExtraInfo merged); capture module contains zero HAR-assembly logic (owned by `har-parser.ts`).
- **L2:** A fixture with value-from-A-feeds-B yields a reingest edge queryable from the graph.
- **L3:** Relational query returns that edge's subgraph + seeds; LLM free to ask any structural question.
- **L4:** `hypothesis-engine.ts` contains zero regex; hypotheses produced from relations in tests.
- **L5:** Brain instructions encode exploitation-first + mutual consensus + product-context.
- **L6:** Relation-seeded mutation confirmed when backend tolerates, rejected when it re-enforces.
- **L7:** Confirmed probe emits `ExploitProof`; chat shows request; `askUser` triggers replay.
- **L8:** Active-chaining consumes relations end-to-end; HITL + budget enforced.
- **L9:** All new/changed suites green; full `npx vitest run` regression passes; `build:cli` clean.

---

## 8. Origin tagging � capture-all, drop the blind localhost exclusion (APPROVED, implemented)

### 8.1 Rationale
The CDP capture previously hard-excluded `['localhost','127.0.0.1']`. Two failures:
- **False drop:** a user testing a local dev app (`http://localhost:3000`) loses its target traffic
  from HAR/graph � the LLM never sees the app under test.
- **Rigid bandaid:** dropping pre-empts LLM reasoning. Principle = "capture FULL, let the LLM decide."

### 8.2 Decision
- Capture **everything** (human + spider + agent + OAST callbacks + local dev target). No hard drop.
- Classify each `Endpoint` node with a typed `origin: 'target' | 'self'` at graph-ingestion time.
- Noise is scoped by the LLM via `queryGraph({ origin: 'target' })` � a reversible query, never a
  destructive drop. No `excludeDomains` param (removed entirely � rigid).

### 8.3 Self-origin resolution (platform-owned, no guess)
`self` origin = the OAST callback host, resolved from `getOastUrl()` (`oast/server.ts`):
`OAST_CALLBACK_HOST` > `config.oast.externalHost` > `http://localhost:<port>`. Parse host+port;
equality match against an entry host+port ? `origin: 'self'`. A localhost DEV TARGET (host:port ?
OAST origin) ? `origin: 'target'` (never falsely dropped). External OAST host also caught.

### 8.4 Changes
1. `src/session/cdp-network-capture.ts` � remove hardcoded localhost exclusion; capture-all; remove
   `excludeDomains`/hard-drop `shouldCapture` path.
2. `src/session/lifecycle.ts` � remove `excludeDomains: ['localhost','127.0.0.1']` from the
   `attachHarCaptureViaCdp` call.
3. `src/graph/schema.ts` � add `origin?: 'target' | 'self'` to `EndpointNode.properties`; add
   `'origin'` to `NODE_PROPERTIES[NodeType.ENDPOINT]`.
4. `src/analysis/har-bridge.ts` � import `getOastUrl`; resolve self host:port once; set `origin` on
   each endpoint node; propagate `origin: 'self'` to secrets/facts derived from a self entry.
5. `src/graph/relation-tools.ts` `getCaptureOverview` � add `originCounts: { target, self }`.
6. `src/graph/tools.ts` `queryGraph` � add optional `origin` to inputSchema + filters map.

### 8.5 Tests
- `har-capture`/`cdp-har-builder`: localhost dev target captured (regression vs old drop).
- `har-bridge`: entry at resolved OAST origin ? `origin: 'self'`; localhost dev target ?
  `origin: 'target'`; derived secret from self entry inherits `origin: 'self'`.
- `relation-tools`: `getCaptureOverview` returns `originCounts`.
- `graph/tools`: `queryGraph({ origin: 'target' })` filters correctly.

### 8.6 Principle compliance
No hardcoded vocab/substring/regex; `origin` is a typed equality check against a platform-owned
value; scoping is a reversible query decision, not a destructive drop; capture stays FULL.
