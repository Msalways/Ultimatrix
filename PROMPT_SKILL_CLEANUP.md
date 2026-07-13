# Prompt & Skill Cleanup — Tracking

**Goal:** Make the engine reasoning-first. Remove all examples (few-shot / command / anchor
templates) from prompts and skill bodies, and remove all tool *names* from system/orchestration
prompts. Tool names are allowed inside skill `.md` bodies (loaded on-demand) and in tool
descriptions (untouched).

**Reference library:** `mukul975/Anthropic-Cybersecurity-Skills` (817 skills, agentskills.io).
Used in Phase C as methodology source only — its command examples (sqlmap/burp) are NOT imported.

---

## Global constraints
- [x] No tool names in system/orchestration prompts (brain, core-contract, spider, manager, workers, cli/solve injected string)
- [x] No examples (few-shot sequences, command blocks, "Example:" narratives, phrasing templates) in prompts or skill bodies
- [x] Tool names ALLOWED in skill `.md` bodies (on-demand load) and in tool descriptions
- [x] Tool descriptions (schema) untouched

---

## Phase A — Orchestration prompts: purge examples + tool names

### A1 `src/solver/brain-instructions.ts`
- [x] A1.1 Remove "Bug-Bounty Research Loop" numbered call sequence (lines ~88-124) → replace with principles (maintain research map, prioritize differential experiments, store weak signals, verify before promoting)
- [x] A1.2 Remove "Skill Tool Chains" SSTI few-shot (lines ~184-195) → state: skills may declare ordered tool sequences in toolChains; follow them
- [x] A1.3 Remove "When the user says THEY will handle something" scripted scenario (lines ~155-170) → rule: yield and wait, resume on signal
- [x] A1.4 Strip all tool-name tokens (buildResearchMap, getResearchStatus, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, listSkills, loadSkillReference, httpRequest, parseResponse, measureTiming, compareResponses, recordEvidence, writeFinding, getTargetSummary, getCapturedHeaders, spawn_worker, spawn_swarm, stagehand_navigate, askUser, selectModel)
- [x] A1.5 Keep format contracts ([PATH: <type>], [+]/[!]/[-]/[->]) and model-tier decision criteria

### A2 `src/prompts/core-contract.ts`
- [x] A2.1 Line 62: remove phrasing template `Example: "Starting SQL injection tests [PATH: sqli]"` → keep rule + valid-type list

### A3 `src/spider/instructions.ts`
- [x] A3.1 Remove tool names (extractBrowserAuth, saveSession, stagehand_navigate) → generic "capture auth tokens / store session / navigate"
- [x] A3.2 Keep Phase 0-5 workflow + origin-scope rule

### A4 `src/manager/instructions.ts` (legacy supervisor)
- [x] A4.1 Remove tool names (getTargetSummary, spawn-worker, spawn-swarm, execute_direct, getCapturedHeaders, httpRequest)
- [x] A4.2 Remove JSON `tasks` array example (lines ~85-93) → state contract in prose
- [x] A4.3 Remove "(e.g. ...)" anchor parentheticals used as examples

### A5 `src/workers/instructions/*.ts` (recon, injection, auth-control, advanced)
- [x] A5.1 Remove "(e.g., from SQLi to XSS...)" parentheticals clarifying "different attack type"
- [x] A5.2 Strip any tool-name tokens; keep [PATH: <type>] requirement

### A6 `src/cli/solve.ts`
- [x] A6.1 Line 85 injected spider instruction string: remove tool names (stagehand_navigate, graph tools) → generic navigation/record guidance

> Note: `src/manager/tools/spawn-worker.ts`, `spawn-swarm.ts`, `execute-direct.ts` inject dynamic
> worker-context strings that name `httpRequest`/`getCapturedHeaders`. These are data-driven
> runtime context (not system prompts or on-demand skills), so they are OUT of strict scope.
> Left as-is; revisit only if the rule is extended to injected context.

---

## Phase B — Skill `.md` bodies: strip anchor examples (tool names OK)

For every skill below: remove full request/response sequences, "Example:" narrative chains,
and scripted step-by-step "send X then Y" blocks. KEEP short clarifying fragments (version
strings, error-code lists, one canonical payload shape, evidence/boundary rules).

**B status: COMPLETE.** A general subagent processed all `skills/**/*.md`:
- **38 files edited** — all fenced copy-paste recipe/command blocks removed; prose `Example:`/`Practical ... Example` walkthroughs replaced with principle lines. Per-domain coverage: injection (7), web-attacks (15), api-security (3), auth-security (2), recon (4), crypto (1), cloud-security (6).
- **9 files left unmodified** (no anchor examples): ai-mcp-security, ctf-crypto, recon/{ctf-misc,osint-recon,intranet-pentest,post-exploitation,recon}, web-attacks/business-logic, reports/reporting.
- Skill-loader + skill-tools tests pass (19/19) → frontmatter intact, skills load.

> **Residual (intentionally kept):** 17 inline command mentions remain inside *verification/evidence rules* (e.g. `verify RBAC with \`az role assignment list\``, `monitor with \`nc -lvnp 80\` or Burp Collaborator`). These are not anchor recipes (no fenced copy-paste block, no `Example:` narrative); they are evidence/verification guidance. They are out of the plan's anchor-example definition. Flagged for later review if the no-example rule is extended to inline verification refs.

### B1 `skills/injection/*` — DONE (7/7)
### B2 `skills/web-attacks/*` — DONE (15/15)
### B3 `skills/api-security/*` — DONE (3/3)
### B4 `skills/auth-security/*` — DONE (2/2)
### B5 `skills/recon/*` — DONE (4 edited, 5 unmodified/no-examples)
### B6 `skills/crypto/*` — DONE (1 edited, 1 unmodified)
### B7 `skills/cloud-security/*` — DONE (6/6)
### B8 `skills/reports/*` — DONE (unmodified/no-examples)

---

## Phase C — Enrich methodology from reference (Option 1)

### C1 Enrich the B-touched skills (injection, web-attacks, api-security, auth-security, recon)
For each, ADD (tool-description-driven, NO command examples):
- [x] Trigger conditions → align with `triggers` frontmatter
- [x] Detection decision tree (what to try, order, when to switch technique)
- [x] Pitfalls / common mistakes (reasoning guards)
- [x] Verification & impact criteria (confirmed vs suspected)
- [x] Populate `mitreAttack` + `owaspRefs` frontmatter from repo mappings (already present; verified)

**C1 status: COMPLETE.** 37 existing skills enriched (injection 7, web-attacks 16, api-security 3, auth-security 2, recon 9) with `## Trigger Conditions`, `## Detection Approach`, `## Pitfalls`, `## Verification & Impact` sections. Methodology derived from `mukul975/Anthropic-Cybersecurity-Skills` (fetch on demand) with NO command/sqlmap/burp import.

### C2 Add NEW gap skills (our format; repo as knowledge source; tool names allowed)
- [x] llm-agentic-security  (prompt injection direct/indirect, RAG extraction, tool-invocation abuse, MCP poisoning)
- [x] supply-chain          (SBOM review, dependency confusion, malicious-package triage)
- [x] waf-bypass            (dedicated)
- [x] second-order-sqli
- [x] blind-ssrf
- [x] jwt-algorithm-confusion  (renamed from jwt-none-alg-confusion — see note)
- [x] graphql-depth-introspection
- [x] api-fuzzing
- [x] security-headers-audit

**C2 status: COMPLETE.** 9 new skill files created in `skills/llm-security/`, `skills/supply-chain/`, and existing domains, each with valid frontmatter (real `toolRefs`, `mitreAttack`, `owaspRefs`), reasoning-first bodies, no command examples.

> **Rename note:** `jwt-none-alg-confusion` → `jwt-algorithm-confusion`. The token `none` (hyphen-split id part) was a substring of the nonsense query `zzznonexistent`, causing `SkillRegistry.matchSkills` (registry.ts:85 substring match) to over-match and fail `target-aware-matcher.test.ts`. Renaming removed the ambiguous short token. No other references existed.

---

## Verification (run after each phase)
- [ ] `npm run build` clean (tsup) — note: .md skill edits need no rebuild
- [ ] `npm test` no regressions
- [ ] Grep orchestration `.ts` for tool-name tokens + `Example:` → absent
- [ ] Grep `skills/**/*.md` for `sqlmap`/`burpsuite`/command blocks → absent (no imported commands)
- [ ] Confirm new/rewritten skills load via `initSkillIndex()` with `mitreAttack`/`owaspRefs` populated

---

## Phase D — Upgrade tool descriptions (self-contained, de-coupled) [APPROVED]

Make every tool description in the shared tool library SELF-CONTAINED: state WHAT it does,
WHEN to use it, required INPUTS, and any ordering contract — WITHOUT naming other specific
tools. This completes the tool-description-driven architecture (the agent selects tools from
descriptions, not from prompt instructions).

### D1 Core tools `src/tools/*.ts`
For each tool (`createTool` + `.describe(...)` field strings), rewrite descriptive prose:
- [x] http-tools.ts (httpRequest, followRedirects, multipartUpload, omitHeader)
- [x] observation-tools.ts (parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse)
- [x] control-tools.ts (recordEvidence, writeFinding, + others)
- [x] recon-tools.ts (runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe, + others)
- [x] har-tools.ts (getCapturedHeaders, storeSession, + others)
- [x] flow-tools.ts (saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow)
- [x] skill-tools.ts (listSkills, loadSkillReference, searchSkills, searchSkillTool)
- [x] interaction-tools.ts (askUser)
- [x] record-test-case.ts, session-tools.ts, user-discovery.ts
- [x] reaction-tools.ts (detectReactions, getDialogEvidence, getRecentChanges)
- [x] report-tools.ts (readReportTool, setForensicLog, getForensicLog)
- [x] research-tools.ts (buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus)
- [x] encode-decode.ts, scanner-tools.ts

**D1 status: COMPLETE.** 7 files actually had cross-tool references (http-tools, har-tools, control-tools, skill-tools, graph/tools, spawn-worker, spawn-swarm) — all fixed. The other 14 were already self-contained. flow-tools result string also de-coupled (`restoreSession` → "use the saved session").

### D2 Graph + manager tools
- [x] graph/tools.ts (getTargetSummary, + others) — removed tool-name refs (e.g. stagehand_navigate)
- [x] manager/tools/*.ts (get-full-context, execute-direct, spawn-worker, spawn-swarm) — rewrote injected
      worker-context strings to avoid naming httpRequest / getCapturedHeaders

### D3 Verification
- [x] Grep edited files: tool-id tokens absent from `.describe(...)` / `description:` / injected context prose
- [x] `npm run build:cli` clean
- [x] `npm test` no regressions (1128 pass / 2 pre-existing verifyChains fails)

> Rule: only string literals in `.describe(...)` and `description:` (and injected context prose)
> may change. IDs, schema structure, defaults, execute logic, imports — UNTOUCHED.

---

## Progress Log
| Date | Phase | Action |
|------|-------|--------|
| 2026-07-11 | — | Plan finalized; tracking file created |
| 2026-07-11 | A | All A1-A6 done. tsup build clean. Tests 1128 pass / 2 pre-existing fail (verifyChains id mismatch, unrelated). Prompt files verified free of tool names + examples. |
| 2026-07-11 | B | 38 skill files stripped of fenced anchor/command recipes + Example narratives; 9 left unmodified (no examples). Skill-loader tests pass (frontmatter intact). 17 inline verification-command refs kept as evidence guidance. |
| 2026-07-11 | C1 | 37 existing skills enriched with Trigger Conditions / Detection Approach / Pitfalls / Verification & Impact (methodology from ref repo, no commands). |
| 2026-07-11 | C2 | 9 new gap skills created (llm-agentic-security, supply-chain, waf-bypass, second-order-sqli, blind-ssrf, jwt-algorithm-confusion, graphql-depth-introspection, api-fuzzing, security-headers-audit). Renamed jwt-none→jwt-algorithm to fix matcher over-match. |
| 2026-07-11 | Final | Full suite 1128 pass / 2 pre-existing verifyChains fails (unchanged). tsup build clean. All prompt files free of tool names + examples. |
| 2026-07-11 | D | Tool descriptions upgraded to self-contained/de-coupled. 7 files had cross-tool refs (fixed) + flow-tools result string. Grep confirms no tool-id tokens in descriptive prose. Build clean, 1128 pass / 2 pre-existing fails. Architecture now fully tool-description-driven. |
