# Ultimatrix vs Strix — Lethality Audit

**Date:** 2026-08-22
**Comparator:** [usestrix/strix](https://github.com/usestrix/strix) (Apache-2.0, ~56k stars; Python on `openai-agents` SDK)
**Subject:** Ultimatrix v8.5 (`project-sentinal`; TypeScript, Mastra, 2067 tests)

---

## 1. Executive Summary

**Neither agent dominates. They are lethal in different ways and fail in different ways.**

| | Ultimatrix | Strix |
|---|---|---|
| **Lethal via** | Structured attack primitives + evidence-gated autonomous escalation | Unrestricted shell/Python in a Kali sandbox + Caido proxy replay |
| **Autonomy ceiling** | Zero code-enforced human gates between discovery and weaponized PoC (solver path) | Agent decides everything inside the container; human steers via chat |
| **Verification strength** | Fail-closed EvidenceGate, proof floors, ExploitProof nodes, graph dedup | Fail-open LLM dedup; PoCs are whatever the agent writes |
| **Failure mode** | Capability ceiling: can only attack through what's compiled into it | Trust ceiling: no structural truth-gate on findings |

**Ultimatrix verdict:** *Very lethal inside its scope fence.* Given a target URL, it crawls, diagnoses, fires injection/IDOR/authz/race/SSRF/AI-abuse attacks, chains session pivots, captures exfil artifacts, and persists reproducible exploit proofs end-to-end with zero human interaction (`src/solver/solver.ts:814-853`, `src/orchestration/playbook-runner.ts:92`, `src/campaign/executor.ts:73`). Its limit is *expressiveness*: it can only execute what exists in its 29 primitives + 9 binary adapters + HTTP tooling.

**Strix verdict:** *Higher raw ceiling, lower floor of trust.* Every Strix agent gets `exec_command` (shell) and Python in a Docker Kali container with all traffic proxied through Caido — so any technique a human hacker can run, it can run ad hoc, including tools we have no equivalent for (proxy interception, arbitrary exploit scripts). But its finding pipeline trusts LLM self-reporting: dedup is fail-open on error, there is no structural evidence gate, and "PoC validated" means the agent wrote a script and said it worked.

---

## 2. Architecture Side-by-Side

| Dimension | Ultimatrix | Strix |
|---|---|---|
| Language / runtime | TypeScript, Node, in-process | Python, `openai-agents` SDK |
| Execution isolation | Logical tenants only (`src/workspace.ts` — OS sandbox explicitly out of scope) | Hard isolation: per-scan Docker (Kali-based), `/workspace` mount |
| Agent loop | OODA solver (REASON→EXPLORE→CONCLUDE) + auto exploitation loop per turn | Turn-based `agent_loop` w/ memory compression |
| Multi-agent | Worker pool (4 specialists), Council debate (4 LLM members), deterministic Campaign executor | Graph-of-Agents: root spawns children (`spawn_agent`), inbox messaging (`send_message_to_agent`) |
| Inter-agent comms | Shared Blackboard + EvidenceLedger singletons | Message inboxes + persisted `agents.json` graph |
| HTTP layer | Outbound fetch (`httpRequest`) + raw TCP client (`raw-http-client.ts`) — **no proxy, no interception** | All traffic through Caido sidecar; agents query/replay via `list_requests` (HTTPQL) / `repeat_request` |
| Budget governance | Token budgets, rate limiter, quota tracker, budget-pruner | USD cost budget w/ reserve for root cleanup, turn limits, budget-pause (parks agents) |
| Memory/compression | Headroom compression, reflexion store, cross-engagement memory | MemoryCompressor, notes/todo/thinking state tools |
| Findings store | Knowledge graph (24 node types) w/ upsert dedup `finding:${endpoint}:${technique}` | Flat report state + LLM semantic dedup |
| Skills | 56 YAML-frontmatter skills, skill-driven tool filtering | Markdown playbooks + SKILL.md agent-integration pack |

---

## 3. Attack Capability Matrix

Legend: ✅ executable today · ⚠️ partial/manual · ❌ absent

| Class | Ultimatrix | Strix | Notes |
|---|---|---|---|
| SQLi (error/boolean/time/UNION) | ✅ `classicInjection` primitive + sqlmap adapter | ✅ shell + sqlmap | Parity |
| NoSQL injection | ⚠️ payloads in skill, no dedicated primitive | ✅ ad hoc script | Strix edge: arbitrary payload iteration |
| XSS (reflected/stored/DOM) | ⚠️ detection + reflection tracing (`render-tracer`) but no stored-XSS persistence harness | ✅ browser + proxy | Strix edge: Caido makes stored-XSS iteration trivial |
| SSRF (blind/OOB) | ✅ `ssrfOast` + local OAST server + callback polling | ✅ OAST-equivalent via shell listeners | Parity; our OAST is first-class structured evidence |
| IDOR / BOLA | ✅ `idorSwapper` + `marker-oracle` + `authzMatrix` | ✅ manual via replay | Our pipeline is stronger & auto-committed |
| Auth bypass / JWT | ✅ `authBypass` primitive, jwt_tool adapter | ✅ jwt_tool in sandbox | Parity |
| Race conditions | ✅ `concurrencyHarness` (parallel burst, divergence oracle) | ✅ single-packet via raw sockets | Theirs has finer network control; ours is automated |
| HTTP smuggling | ⚠️ raw TCP framing client exists; no automated smuggle-detect primitive | ✅ raw socket scripts | Strix edge |
| Deserialization | ⚠️ `deserialization` primitive registered; skill payloads stripped | ✅ ysoserial ad hoc | Both capable; fix our skill text |
| SSTI → RCE | ❌ detection only | ✅ ad hoc | Gap |
| XXE → file read / OOB | ⚠️ OAST wired; no xxe primitive | ✅ ad hoc | Gap (skill payloads also empty) |
| Workflow/state-machine bypass | ✅ `workflowBypass` + `invariantProbe` (relation-seeded) | ⚠️ manual reasoning | **We lead** — this is rare even commercially |
| Client-trust tampering (price/role flags) | ✅ `configTrust` | ⚠️ manual | We lead |
| Prompt-injection vs target AI features | ✅ `aiTrust` w/ OAST exfil oracle | ⚠️ emerging | We lead |
| Tenant isolation | ✅ `tenantIsolation` primitive + dual-session RBAC matrix | ⚠️ manual | We lead |
| Cloud/container (IAM privesc, docker escape, k8s RBAC) | ⚠️ recon probes + skills (payload blocks stripped); no cloud primitives | ✅ shell against metadata endpoints | Strix edge until we add primitives |
| Dependency CVEs (SCA) | ⚠️ gitleaks adapter only (secrets, not CVEs) | ✅ `create_dependency_report` SCA flow | Gap |
| SAST / source-repo targets | ❌ URL-only targets (`new URL(target)` fails on paths) | ✅ local dir + GitHub repo targets | Gap |
| OpenAPI/Postman contract ingestion | ❌ none (shadow-discovery merely probes `/openapi.json` paths) | ✅ full spec/collection-driven testing | High-value gap |
| Recon/OSINT | ✅ RDAP/DNS/subdomain brute/subfinder + framework fingerprinting | ✅ subfinder/httpx + Perplexity web search | Parity; their live web search is an OSINT edge |

---

## 4. Autonomy Audit — the Ultimatrix Spine

The autonomous kill-chain, all verified in code:

```
Spider/HAR capture → graph Endpoints
        │
Solver OODA turn (LLM decides attacks)
        │  every turn ends with:
        ▼
runExploitationLoop (solver.ts:814-853)
  technique → primitive map (exploitation-loop.ts:31-41)
  scope re-check → runPrimitiveById(commit:true)   ← NO HITL
        │
Primitive live-fires (29 registered, index.ts:67-99)
  generate → HTTP steps → EvidenceGate oracle
        │  confirmed:
        ▼
writeFinding + EXPLOIT_PROOF node (index.ts:275-320)
  proof floors enforced (critical≥2 structured, high≥1 non-text)
        │
Deterministic batch layers (zero LLM):
  playbook-runner.ts:92   — executes every candidate primitive
  campaign/executor.ts:73 — bounded-concurrency sweep, persists ≥0.7 confidence
```

**Gates that still exist (all narrow):**

1. **Scope fence** — transport-enforced on every request incl. redirects (`http-tools.ts:127`), but **allow-all when unset** (`scope-guard.ts:135`). This is the *only* universal runtime brake.
2. **Council HITL** — critical always requires human; high requires human unless `approvalMode:'autonomous'` (`council/approval.ts:104-108`). Governs the council engine only — **not** the default solver/multi-model path.
3. **External binaries** — deny-by-default opt-in (`scope-guard.ts:35`).
4. **Proposed-scope expansion** — needs explicit approval (CLI `--approve-origin`).
5. **`interactionMode:"ask"`** — restricts to read-only tools (`solver.ts:286`).

**Soft rules that are NOT enforced:** `brain-instructions.ts:12-13` says write/send/delete actions require approval — prompt-level advisory only. `emitSolverInterrupt` (`events/emitter.ts:171`) has zero callers (dead steering channel).

**Comparison:** Strix has *fewer* gates (human steers by chat mid-run; container is the safety boundary). Ultimatrix compensates with a trust gate (evidence) where Strix has none — but if your threat model is "agent must never do something destructive unattended," neither currently enforces destructiveness classification at execution time. That's a shared industry gap, not a parity gap.

---

## 5. Verification Strength (where we win)

| Mechanism | Ultimatrix | Strix |
|---|---|---|
| Claim verification | EvidenceGate: claims cross-checked against typed observed facts; truncated/unbacked = rejected, fail-closed | None — agent asserts PoC success |
| Proof floors | checkProof: critical ≥2 structured items, high ≥1 non-text; failed proofs excluded from reports | n/a |
| Dedup | Deterministic key upsert (endpoint+technique) at graph level — cannot lose findings, cannot duplicate them | LLM semantic dedup, **fail-open on API/parse error** (`dedupe.py:380`), plus deterministic CVE identity rules |
| Reproducibility | CaseFile JSON with replay recipe (method/url/headers/body/steps) + priorResponse reuse | Report narrative + PoC script files |
| Hallucination defense | Reflexion, anti-loop, core-contract prompts, architecture evals suite | Prompt discipline only |

This is our durable moat: **Strix finds more things; we can prove the things we claim.**

---

## 6. Skills Improvement Roadmap (for autonomous exploitation)

### Systemic defect found (P0)

**53 of 56 skills have had their fenced payload blocks (triple-backtick code fences) stripped.** Sections like "Universal Polyglots" (`modern-xss.md`), RCE chains (`ssti.md`), and every payload example in `xxe.md` are followed by blank space. Only `authorization.md`, `waf-bypass.md`, and `web-security-advanced.md` retained fenced content. The brain reads thin prose where dense arsenals should be. This is the **single biggest lethality limiter** — cheaper than any new module and pure upside.

**Action:** rebuild payload arsenals for all affected skills. Priority order by attack-class value:
1. `xxe.md` (every block empty), `ssti.md` (RCE chains empty), `modern-xss.md` (headline polyglots empty)
2. `nosql-injection.md`, `http-smuggling.md` (raw request templates), `command-injection-advanced.md`
3. `prototype-pollution.md` (gadget lists), `graphql-attacks.md` (introspection query body), `race-conditions-advanced.md`
4. Remaining long tail

### P1 — Deepen the weak five

| Skill | Lines | Problem | Fix |
|---|---|---|---|
| `blind-ssrf.md` | 62 | 5 trivial payloads | Add cloud-metadata paths, gopher/dict schemes, redirect-chain SSRF, OAST poll strategies |
| `second-order-sqli.md` | 59 | Trivial payloads | Stored-payload → consumer-context matrix, time-delay second-order, JSON storage vectors |
| `jwt-algorithm-confusion.md` | 59 | ~80% duplicates `jwt-advanced` | Merge into `jwt-advanced.md`; replace with a distinct `session-persistence.md` (invalidation, fixation, concurrent-session) |
| `api-security.md` | 116 | Sparse payloads | Mass-assignment field dictionaries, over-fetching/GraphQL alias batching, version-skew testing |
| `aws-iam-exploitation.md` | 114 | CLI commands stripped | Restore iam simulate-principal-policy chains, role-chaining graphs, metadata-credential pivot |

Also restore stripped command blocks in `docker-escape.md`, `kubernetes-security.md`.

### P1.5 — Wire skills to primitives (skill→execution seam)

Currently **only `authorization.md`** references `runPrimitive`. Every skill covering a primitive-backed class should declare its matching primitive in frontmatter/body so the solver goes prose→execution directly:

- `exploitation.md` / `vuln-discovery.md` → `classicInjection`
- race/business-logic skills → `concurrencyHarness`, `workflowBypass`, `configTrust`
- deserialization skill → `deserialization`
- smuggling skill → `smuggling`
- blind-ssrf → `ssrfOast`; api-security/BOLA → `idorSwapper` + marker-oracle

### P2 — Missing domains (new skills)

1. **Credential attacks** — stuffing/brute-force/spraying with lockout-detection logic and credential-vault integration (`useCredential` exists, no skill drives it)
2. **Post-exploitation & pivoting** — session reuse across hosts, token replay between environments, internal-network pivot from SSRF footholds (we have `recordSessionReach` + SESSION_REACHES edges — no skill teaches the brain to use them offensively)
3. **Mass assignment / parameter pollution at scale** — pairs with the api-security deepening

### P3 — Architecture caps on lethality (design decisions, no-bandaid compliant)

These cap lethality regardless of skill text. Each needs a deliberate design pass, not a quick glue:

1. **HTTP interception/replay tool** — Strix's `list_requests`+`repeat_request` (query captured traffic by filter, replay with modifications incl. framing fixes) is its sharpest edge. Our nearest seams: captured HAR entries + `raw-http-client.ts` (already does CL/TE framing correctly) + `priorResponse` mechanism. A `replayCapturedRequest(entryId, mutations)` tool would close most of the gap without adopting a proxy.
2. **Arbitrary command/script execution seam** — Strix runs anything; we run only registered primitives/adapters. A scoped, audited `runScript` (sandboxed, scope-guarded, evidence-recorded) is the honest answer to the expressiveness ceiling — big design decision given the safety posture.
3. **OpenAPI/Postman ingestion** — feed campaigns from contracts instead of crawl-discovered endpoints only (`campaign/planner` already builds endpoint×param matrices; it just needs richer sources). Shadow-discovery proves demand.
4. **Local-repo/SAST targets** — requires generalizing the target model beyond URLs (scope guard, workspace, engines all assume origins today).

### Effort estimates

| Item | Effort | Impact on lethality |
|---|---|---|
| P0 payload restoration (~50 skills) | M (bulk writing, no code risk) | ★★★★★ |
| P1 weak-five deepening | S–M | ★★★☆☆ |
| P1.5 primitive wiring | S | ★★★★☆ (turns knowledge directly into committed exploits) |
| P2 three new domains | M | ★★★☆☆ |
| P3.1 replay tool | M–L | ★★★★☆ |
| P3.2 script seam | L (design-heavy) | ★★★★★ |
| P3.3 contract ingestion | M | ★★★☆☆ |
| P3.4 repo targets | L | ★★☆☆☆ (different product axis) |

---

## 7. Bottom Line

Ultimatrix is already the more **disciplined** autonomous exploiter: nothing human stands between a confirmed finding and a committed, reproducible exploit proof, and every claim survives a fail-closed verification gauntlet Strix simply doesn't have. Strix is the more **expressive** one: shell-in-a-box means its technique space is unbounded, while ours ends at the boundary of the primitive registry and the absence of a replay/scripting seam.

The fastest route to dominance, in order: **restore the stripped payload arsenals (P0) → wire skills to primitives (P1.5) → ship a captured-request replay tool (P3.1)**. After those three, the "structured killer with receipts" positioning is defensible against both Strix and commercial platforms.
