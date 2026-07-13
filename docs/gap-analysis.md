# Ultimatrix v8 — Gap Analysis & Real-World Bug-Bounty Impact Report

> **Scope**: Full honest assessment of whether Ultimatrix can make real impact against
> modern real-world targets (attack, vulnerability discovery, system compromise) in a
> bug-bounty context. Grounded in the actual codebase, not marketing claims.
>
> **Date**: 2026-07-11 · **Basis**: code-level review of `src/solver/`, `src/intelligence/`,
> `src/tools/`, `src/browser/`, `src/spider/`, `skills/`, `src/models/`, `src/config.ts`.

---

## 1. Executive Verdict

**Short answer:** Ultimatrix is a *capable augmentation/accelerator* for a skilled human
hunter — **not** a turnkey autonomous "break the system" bug-bounty machine.

- It has **genuine attack transports** (raw HTTP with auth replay, real Chromium/Playwright
  for SPAs, subprocess delegation to `nmap`/`sqlmap`/`ffuf`/`nuclei`, local OAST, 9 technique
  primitives) — this is real, not a wrapper-around-nothing.
- Its **real-world impact is gated by four structural constraints**: (1) intelligence layers
  are *advisory-only* and do not hard-gate hallucination, (2) a per-turn budget of 50 tool
  calls / 5 minutes limits deep exploit chains, (3) capability is entirely
  **model-dependent** (weak models fail), and (4) it **cannot log in autonomously** — it
  needs a human or pre-captured session.
- Against **modern hardened targets** (Cloudflare/bot-management, WAFs, multi-step
  business-logic, OAuth/JWT auth flows), it is **weak-to-partial** without heavy human
  driving.

**Confidence:** High on the mechanics (code-verified). The autonomy claims in AGENTS.md
overstate the degree of hands-off capability.

---

## 2. What The System Actually Is

A dual-engine, LLM-driven, tool-augmented security agent:

- **Legacy engine** (`config.engine: 'legacy'`) — supervisor + 4 worker agents (v6).
- **Solver engine** (`config.engine: 'solver'`) — OODA loop, single `agent.stream()` per
  REPL turn, LLM drives all tool selection (`src/solver/solver.ts:599-615`).

**Real transports the LLM can invoke:**

| Transport | Source | Reality |
|-----------|--------|---------|
| Raw HTTP/S | `src/tools/http-tools.ts` | `fetch`, arbitrary method/headers/body, **auth replay** supported |
| Headless Chromium | `@mastra/stagehand` via `src/browser/dialog-inject.ts` | navigate/act/extract/observe/screenshot; **JS-rendered SPA**; native-dialog XSS proof |
| External binaries | `src/tools/traditional-tools.ts` | `nmap` (real port scan), `sqlmap`, `ffuf`, `nuclei` via `exec` |
| Local OAST | `src/oast/server.ts` | Node HTTP listener on **`localhost` only** |
| Technique primitives | `src/primitives/index.ts` | 9 primitives (race, IDOR, SSRF-OAST, authz-matrix, etc.) over HTTP |

**Anti-hallucination:** `EvidenceGate` (`src/intelligence/evidence-gate.ts`) cross-checks
claims against recorded tool output.

---

## 3. Real Strengths (What Genuinely Works)

1. **Raw HTTP with authenticated replay** — `httpRequest`, `omitHeader`, `followRedirects`,
   `multipartUpload` support custom methods/headers/body and replay of captured auth headers.
   Enables real IDOR / horizontal-privilege / CSRF-token-drop testing.
2. **SPA + XSS proof via real browser** — Stagehand/Playwright renders JS apps; the CDP
   dialog watcher (`src/browser/dialog-watcher.ts`) auto-captures `alert/confirm/prompt` as
   hard XSS evidence. This is beyond what `curl`-style scanners do.
3. **Real binary delegation** — when installed, `nmap`/`sqlmap`/`ffuf`/`nuclei` provide
   industrial-grade port scanning, SQLi automation, fuzzing, and template CVE checks.
4. **Deep skill knowledge in key domains:**
   - `skills/injection/vuln-discovery.md` — modern SSRF (IMDSv2, gopher/dict, IP-encoding),
     SSTI engine fingerprinting + RCE, XXE filters, command-injection `${IFS}` tricks.
   - `skills/web-attacks/race-conditions-advanced.md` — **Turbo Intruder, single-packet
     (HTTP/2 multiplexing), TOCTOU chains, GraphQL batched-mutation races.**
   - `skills/recon/recon.md` — JS-bundle secret analysis, source maps, `__NEXT_DATA__`,
     GraphQL introspection.
   - `skills/web-attacks/business-logic.md` — concrete price/quantity/role/workflow tampering.
5. **Attack-chain inference** — `src/solver/attack-path.ts` BFS over graph edges
   (`CHAINS_TO`/`PRODUCES`/`EXPLOITS`) surfaces multi-hop chains from recorded findings.
6. **Evidence discipline** — the codebase is unusually serious about proof: OAST callbacks,
   dialog capture, screenshots, `verifyPendingFindings`.

---

## 4. Gap Catalogue (Code-Referenced)

### 4.1 Engine & Control Gaps
- **Intelligence layers are advisory-only.** `solver.ts:7-9`: EvidenceGate, Reflexion,
  LoopDetector "observe **passively** — they record state but do NOT gate or interrupt the
  agent." The only hard stops are `maxToolCalls` (50, `config.ts:234`) and `maxDurationMs`
  (5 min, `config.ts:235`).
- **EvidenceGate is weak.** It only **downgrades severity by one notch** on unverified
  `writeFinding` claims (`control-tools.ts:119-133`) — it does **not block** the finding, and
  does **not constrain free-text narrative** at all. Verification is **case-insensitive
  substring matching** of extracted tokens (`evidence-gate.ts:95-125`) — e.g. a claim
  mentioning "200" matches any "200" anywhere in prior output. Not semantic.
- **`verifyPendingFindings` confirms liveness, not exploitability** — marks findings
  verified if the endpoint returns HTTP 200–499 (`control-tools.ts:254-320`).
- **Anti-loop / reflexion only nag.** They inject warning text into the next goal
  (`solver.ts:488-515`); they never interrupt. `maxTokens` is **deprecated and not enforced**
  (`config.ts:116`).

### 4.2 Model Dependency
- **All providers forced through `createOpenAICompatible`** (`factory.ts:69-148`) — no
  provider-specific reasoning client; capability = whatever the endpoint returns.
- **Small models cannot hold context.** `groq/llama3-8b-8192` = 8K tokens → only **4**
  retained conversation messages (`config.ts:352-359`) and a **4,000-char** goal cap
  (`solver.ts:40-48`). Complex multi-step vulns are effectively impossible on such models.
- **No reasoning/planning guarantee** — entirely model-dependent.

### 4.3 Scope & Guardrails
- **Scope guard is opt-in and permissive by default.** `isUrlInScope` returns
  `allowed:true` whenever no scope config is set (`scope-guard.ts:20-23`). Out-of-scope
  requests are blocked only if `setScopeConfig` was explicitly called.
- **Only `stagehand_navigate` is scope-checked** among browser actions
  (`dialog-inject.ts:73`); act/extract/etc. are not.
- **No robots.txt, no client-side rate limiting, no backoff** in HTTP tools.
- **`httpRequest` does not follow redirects** by default (`redirect:'manual'`).

### 4.4 Authentication Gaps
- **No autonomous credential login in the solver engine.** `config.creds` is for **LLM
  provider API keys only**, not target logins. The spider is told *"do NOT submit login
  forms without credentials"* (`lifecycle.ts:377`).
- Auth requires **human-in-the-loop** (`saveSession`/`restoreSession`, `flow-tools.ts`) or
  **pre-captured HAR/headers**. The agent cannot discover credentials and log in itself.

### 4.5 Recon Gaps
- **`runRecon` whois and DNS are dead no-ops** — commented-out TODOs
  (`recon-tools.ts:40-59`). Subdomain enumeration relies solely on `crt.sh`.

### 4.6 Skill-Depth Gaps (Named-But-Empty)
- `skills/injection/exploitation.md` — **skeleton**; most section bodies empty
  (Blind SQLi, SSRF→RCE, reverse shell are headers only).
- `skills/web-attacks/web-pentest.md` — **orchestration router**; technique bodies empty.
- `skills/web-attacks/web-security-advanced.md` — title says "payload-driven" but CSP/CORS/
  prototype-pollution/cache-poisoning bodies are **empty**.
- `skills/auth-security/authorization.md` — **JWT `alg:none`, RS256→HS256 confusion, jku/x5u,
  OAuth redirect/scope/code-interception are named section headers with EMPTY bodies.** Only
  IDOR/RBAC methodology is real.
- `skills/api-security/ai-mcp-security.md` — **conceptual only**, no payloads/PoCs.

### 4.7 OAST Gap
- OAST listener binds to **`localhost` only** (`oast/server.ts:7`). External targets cannot
  reach it, so **true out-of-band callbacks from remote targets do not work** — no public
  interactsh-style server. Blind SSRF/XXE/RCE OOB detection is effectively local-only.

### 4.8 Reliability / Build Gaps
- **316 TypeScript errors** in legacy modules (`src/context/`, `src/lib/agent-manager.ts`,
  `src/swarm/builder.ts` — missing `./chains`, `./formatter`). Pre-existing tech debt,
  non-blocking for v8 but indicates unfinished surface area.
- **Cloudflare challenges break Stagehand crawl** (documented known issue) — a major gap for
  modern targets.
- **`ffuf` default wordlist** `/usr/share/wordlists/common.txt` likely absent on Windows.
- **ESLint not configured.**

### 4.9 Dispatcher Fragility
- Skill routing is **lexical-substring scoring** over frontmatter (`tool-filter.ts:68-115`),
  returns top-3. **No semantic/embedding routing.**
- **Exact-spelling dependency**: the deepest race skill declares trigger `"turbowlence"`
  (misspelled) — a user typing "turbo attack" won't match it.

---

## 5. Per-Surface Bug-Bounty Verdict

| Attack surface | Verdict | Why |
|----------------|---------|-----|
| Classic web (SQLi/XSS/IDOR) | 🟢 **Moderate–Good** | Raw HTTP + auth replay + browser XSS proof + `sqlmap`; deep `vuln-discovery` skill |
| Race conditions | 🟢 **Good (with strong model)** | Genuinely modern skill; primitives support concurrency |
| Business logic | 🟡 **Partial** | Good skill knowledge, but model-dependent + 50-call budget limits multi-step abuse |
| Auth (JWT/OAuth) | 🟠 **Weak–Partial** | Techniques *named* but skill bodies empty; no autonomous login |
| SPA / GraphQL | 🟡 **Partial** | Real browser + introspection, but Cloudflare breaks crawl |
| Network / infra | 🟢 **Good (if binaries present)** | Real `nmap`; but requires local install |
| Blind / OOB (SSRF/XXE) | 🟠 **Weak** | OAST is localhost-only — remote callbacks fail |
| WAF bypass | 🔴 **Weak** | Detection only; bypass knowledge thin |
| AI / MCP | 🔴 **Conceptual** | High-level framing, no actionable exploitation |
| Modern hardened targets (CF/bot-mgmt) | 🔴 **Struggles** | Crawl blocked; no anti-bot evasion |

---

## 6. Overall Impact Verdict

**Can it make real impact on modern targets?** — **Yes, but conditionally and as an
augmentation, not autonomously.**

- **Where it wins:** A skilled hunter who (a) picks a strong large-context model, (b) logs in
  manually / supplies a session, and (c) has `nmap`/`sqlmap`/`ffuf`/`nuclei` installed, gets a
  real acceleration on recon → primitive-driven testing → browser-proven findings. The
  evidence discipline (OAST/dialog/screenshot) means findings it *does* produce tend to be
  well-substantiated.
- **Where it loses:** Fully autonomous discovery of subtle multi-step business-logic or
  auth-flow (JWT/OAuth) bugs, blind OOB vulns against remote targets, and anything behind
  Cloudflare/bot-management. The advisory-only intelligence layers and weak substring
  EvidenceGate mean it can still *report* shaky claims (severity is merely downgraded, not
  blocked), so human triage of output remains mandatory.

**Net:** A strong *co-pilot* for bug bounty; not a replacement for the hunter. The gap between
the AGENTS.md autonomy narrative and the code reality is the single biggest risk to trusting
its output unsupervised.

---

## 7. Prioritized Remediation Roadmap

### P0 — Trust & Safety (close the credibility gap)
1. **Make EvidenceGate hard-block, not downgrade.** Reject unverified `writeFinding` claims
   and gate the free-text narrative, not just structured severity
   (`evidence-gate.ts`, `control-tools.ts:119-133`).
2. **Replace substring verification with structured fact matching** (status/URL/method as
   typed fields, not string `includes`) (`evidence-gate.ts:95-125`).
3. **Enforce scope by default** — flip `isUrlInScope` to deny when no scope is configured, or
   require explicit `--allow-any` (`scope-guard.ts:20-23`); scope-check *all* browser actions.
4. **Model-tier gating** — refuse or warn when a sub-16K-context model is selected for
   complex goals (`factory.ts`, `config.ts`).

### P1 — Coverage (turn named techniques into real ones)
5. **Fill skeleton skills** with actual methodology: `exploitation.md`, `web-pentest.md`,
   `web-security-advanced.md`, and the **JWT/OAuth** sections of `authorization.md`.
6. **External OAST** — support a public/interactsh-style callback host so remote OOB vulns
   (SSRF/XXE/blind RCE) are detectable (`oast/server.ts`).
7. **Fix recon dead code** — implement whois/DNS in `runRecon` (`recon-tools.ts:40-59`); add
   subdomain sources beyond crt.sh.
8. **Robust skill dispatcher** — add semantic/embedding routing; fix the `turbowlence`
   misspelling and other exact-spelling triggers (`tool-filter.ts`).
9. **Rate limiting / backoff / robots awareness** in HTTP tools for program-safe scanning.

### P2 — Autonomy & Hardening
10. **Autonomous auth flows** — wire test-account credentials into the solver so it can log in
    and test authenticated surface without a human (`config` + `auth-recorder.ts`).
11. **Anti-bot / Cloudflare handling** for Stagehand crawl (documented blocker).
12. **WAF-bypass knowledge** — expand `waf-bypass.md` beyond detection into real evasion.
13. **Legacy build cleanup** — resolve the 316 tsc errors or formally excise
    `src/context/`, `src/lib/agent-manager.ts`, `src/swarm/`; add ESLint.
14. **Ship `nmap`/`sqlmap`/`ffuf`/`nuclei` availability checks** + Windows-compatible default
    wordlists (`delegator.ts:42`).

---

*This report is documentation only; no source was modified. Implementation of the roadmap is
out of scope pending approval.*
