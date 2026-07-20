# Ultimatrix — Lean Extensibility: Task-Level Plan

> **Scope note:** The tool-filter bug (`getOastUrl` → `getOastUrlTool`, drift guard, silent-drop warning) is **excluded** — owner is fixing it separately. This plan covers the extensibility framework only.

> **Goal:** Make Ultimatrix open-world and user-extensible — external MCP servers, code plugins, and user skills are discoverable and usable **without** any skill/keyword gate. Standard Cursor/Claude `mcpServers` config + OAuth 2.0. Skills use pure discovery; core safety is immutable; methodology precedence is decided by **evidence/merit arbitration**, not authorship.

---

## Phase 1 — `DynamicToolRegistry` (transports + OAuth + M2M)

**Goal:** One registry is the source of truth for built-in + plugin + MCP tools. Lazily connects; never blocks an agent that lacks a skill.

### Tasks
- [ ] **1.1** Create `src/extensions/tool-registry.ts`
  - `class DynamicToolRegistry` with: `registerBuiltins(reg: ToolRegistry)`, `registerPlugin(id, loader)`, `registerMcp(server)`, `resolve(id): Tool`, `list(): {id, description, inputSchema, source}[]`, `listByPrefix(prefix)`.
  - Lazy connect: MCP server connects on first `resolve`/`list` for that server (calls SDK `client.listTools()`), registers each tool as `mcp__<server>__<tool>` carrying the server-supplied `description` + `inputSchema`.
  - Plugin: `registerPlugin(id, () => import(path))` returning `{tool, schema}`; registered as `plugin__<id>__<tool>`.
- [ ] **1.2** Wire `src/mastra/tools.ts:147` `createToolRegistry()` to delegate built-ins into `DynamicToolRegistry` (built-in ids unchanged, so `resolveToolsForSkills` still matches).
- [ ] **1.3** Implement `OAuthClientProvider` (SDK `@modelcontextprotocol/sdk` v1.29.0, `client/auth.d.ts`):
  - `redirectUrl` = `http://127.0.0.1:<port>/callback` (spin local listener); `clientMetadata` = public client; `tokens()`/`saveTokens()` backed by secure store (Phase 5); `saveCodeVerifier()`/`codeVerifier()`; `redirectToAuthorization(url)` opens real browser / Stagehand page; `finishAuth(code)` after redirect.
  - Pass as `authProvider` to `StreamableHTTPClientTransport(url, { authProvider })`.
- [ ] **1.4** M2M shortcut: use SDK `auth-extensions` `ClientCredentialsProvider({ clientId, clientSecret, scope })` when config supplies client creds (no browser). Pass as `authProvider`.
- [ ] **1.5** `env`/`headers`/`args` + `${ENV_VAR}` interpolation (`resolveEnvVars`) threaded per transport (stdio `env`, http `headers`/`requestInit`).

### Verification
- Unit: `DynamicToolRegistry` resolves built-in; lazy-connects a mocked MCP server (return `listTools` → registered under `mcp__*`); plugin resolve; `list()` excludes nothing.

---

## Phase 2 — Discovery tools in `CORE_TOOLS`

**Goal:** Every agent always has `listTools` + `loadTool` (+ existing `listSkills`/`loadSkillReference`) so it can discover and enable ANY registered tool — no skill required.

### Tasks
- [ ] **2.1** Create `src/extensions/tool-tools.ts`:
  - `listTools` (always available) → `DynamicToolRegistry.list()`.
  - `loadTool({ id })` → `resolve(id)`, append `id` to session `acquiredTools` set, return the tool's `description` + `inputSchema` so the LLM knows the shape this turn.
- [ ] **2.2** Confirm/extend `src/tools/skill-tools.ts` `listSkills` (add `source` label) + `loadSkillReference` (cover user dirs). Add both to `CORE_TOOLS`.
- [ ] **2.3** Add `listTools`, `loadTool` to `CORE_TOOLS` in `src/solver/skills/tool-filter.ts`.
- [ ] **2.4** `src/solver/solver.ts`: per-turn brain rebuild unions `acquiredTools` into the allow-set (tool becomes directly callable next turn).
- [ ] **2.5** `src/workers/factory.ts` + `src/council/factory.ts`: receive `acquiredTools` via `toolIds`/`extraTools` at creation.

### Verification
- Unit: `loadTool` adds id to acquired set; `listTools` enumerates built-in + a registered mock MCP tool. Solver test: tool callable after `loadTool` on next turn.

---

## Phase 3 — Config schema

**Goal:** Standard, Cursor/Claude-compatible config for MCP, plugins, and user skills.

### Tasks
- [ ] **3.1** `src/config/schema.ts` + `src/config.ts`:
  ```yaml
  mcp:
    mcpServers:
      <name>: { command?, args?, env?, url?, headers?, type? }
    import?: .cursor/mcp.json      # or claude_desktop_config.json / .mcp.json
  plugins?:
    - { id, path, env? }
  skillsDirs?: [user skill dirs]
  skills?: { exclude?: string[] }
  ```
- [ ] **3.2** `resolveEnvVars(obj)` — substitute `${ENV_VAR}` → `process.env.NAME` in `env`/`headers`/`args`; literal values accepted (warn on plaintext secret-looking values).
- [ ] **3.3** Auto-detect `.mcp.json` in project root if no explicit `mcp` block. Imported file parsed with the same `mcpServers` shape.

### Verification
- Unit: config with `mcpServers` + `import` parses; `resolveEnvVars` interpolates; unknown shapes rejected by existing validator.

---

## Phase 4 — `mcp` CLI subcommands

**Goal:** Trivial, non-interactive onboarding of MCP servers (mirrors `claude mcp`).

### Tasks
- [ ] **4.1** Create `src/cli/mcp.ts`; register in CLI entry.
  - `ultimatrix mcp add <name> --stdio -c <cmd> -a "<args>" -e KEY=VAL`
  - `ultimatrix mcp add <name> --http <url>` (OAuth lazy on first connect)
  - `ultimatrix mcp list` / `ultimatrix mcp remove <name>` / `ultimatrix mcp init` (scaffold `.mcp.json` template).
- [ ] **4.2** Writes the standard `mcpServers` block into `ultimatrix.yaml` (or a `.mcp.json`). Remote-server OAuth deferred to first connect (keeps `add` non-interactive).

### Verification
- E2E (scripted): `mcp add burp --stdio …` then `list` shows it; config file contains standard shape.

---

## Phase 5 — Secure token store

**Goal:** OAuth tokens never touch `ultimatrix.yaml`.

### Tasks
- [ ] **5.1** Create `src/extensions/token-store.ts`: OS keychain if available, else encrypted file `~/.config/ultimatrix/mcp-tokens.json` (`0600`). API: `get(serverKey)`, `set(serverKey, tokens)`, `clear()`.
- [ ] **5.2** Wire into `OAuthClientProvider.tokens()`/`saveTokens()` (Phase 1.3).

### Verification
- Unit: tokens persist across calls; file perms `0600`; plaintext secrets never written to config.

---

## Phase 6 — Pure discovery for skills

**Goal:** Remove the keyword/auto-trigger; skills reachable only via discovery. (Also fixes the project's no-substring-detection rule violated by `matchSkills`.)

### Tasks
- [ ] **6.1** `src/session.ts:45-53`: **remove** `resolveSkillsForInput(line)` auto-trigger + `loadSkill` injection.
- [ ] **6.2** `src/solver/skills/registry.ts`: **remove** `matchSkills` substring scoring (`registry.ts:84-91`); keep `SkillRegistry` as the discovery index for `listSkills` only.
- [ ] **6.3** `src/solver/skills/loader.ts`: `initSkillIndex` merges built-in `SKILLS_DIR` + user `skillsDirs`; prefixes user ids with `user/`; tags each `SkillMeta` with `source: 'core' | 'user'` and `core: boolean`.
- [ ] **6.4** Brain/council base instructions: add discovery block — "Discover methodology with `listSkills`; load details with `loadSkillReference` when relevant. Discover tools with `listTools`; enable with `loadTool`."
- [ ] **6.5** Relax `test/skills/tool-wiring.test.ts`: a `toolRef`, if present, must be a built-in `TOOL_ID` or external (`mcp__`/`plugin__`) id, else **warn** (not hard-fail) — skills no longer gate tools.

### Verification
- Unit: `listSkills` sees a user skill in a `skillsDirs` dir (namespaced `user/<id>`, `source:'user'`); no auto-injection on arbitrary input; `matchSkills` unused.

---

## Phase 7 — Conflict management (safety floor + merit arbitration)

**Goal:** When core + user skill both fit a task, core *safety* is immutable; *methodology* precedence is decided by verified evidence, not authorship.

### Tasks
- [ ] **7.1** **Safety floor:** core safety instructions (scope guard, evidence gate, rate limits) stay code-injected in base agent instructions — never overridable by any skill text.
- [ ] **7.2** `src/solver/skills/registry.ts`: when a task matches both `core` and `user/<id>` skills, mark both `candidate` (no static winner); `listSkills` emits `source`.
- [ ] **7.3** `src/intelligence/outcome-feedback.ts`: record per-skill `verifiedFindings` / `reflexionEscalations`; compute a per-task-type `skillPreference` weight (core vs user). Persist via existing reflexion store.
- [ ] **7.4** Agent instruction: "When a core and user skill both fit, you may use either; let verified evidence + reflexion decide; the better one is preferred next time."
- [ ] **7.5** `src/config/schema.ts`: `skills.exclude?: string[]` lets a user explicitly drop a core skill.

### Verification
- Unit (`test/skills/arbitration.test.ts`): user skill yielding verified findings is promoted for that task type; user skill that hallucinates (fails EvidenceGate) is demoted; safety instruction text from a user skill cannot disable scope guard.

---

## Phase 8 — Tests + full verification

### Tasks
- [ ] **8.1** New tests: `test/extensions/tool-registry.test.ts`, `test/extensions/tool-tools.test.ts`, `test/extensions/token-store.test.ts`, `test/extensions/mcp-cli.test.ts`, `test/skills/discovery.test.ts`, `test/skills/arbitration.test.ts`, `test/skills/conflict.test.ts`.
- [ ] **8.2** Run `npm test` — 1399 existing + new green.
- [ ] **8.3** `npm run build:cli` — clean ESM/CJS/DTS build.
- [ ] **8.4** Manual: `npx ultimatrix solve -t <url>` works via discovery path; `ultimatrix mcp add burp --stdio …` → `listTools` shows `mcp__burp__*`; conflict scenario promotes/demotes correctly.
- [ ] **8.5** Commit excluding `ultimatrix.yaml` (`git add -- ':!ultimatrix.yaml'`); push origin/master.

---

## File map
| File | Phase |
|---|---|
| `src/extensions/tool-registry.ts` (new) | 1 |
| `src/mastra/tools.ts` | 1, 2 |
| `src/extensions/tool-tools.ts` (new) | 2 |
| `src/tools/skill-tools.ts` | 2, 6 |
| `src/solver/solver.ts` | 2 |
| `src/workers/factory.ts`, `src/council/factory.ts` | 2 |
| `src/config.ts`, `src/config/schema.ts` | 3, 7 |
| `src/cli/mcp.ts` (new) | 4 |
| `src/extensions/token-store.ts` (new) | 5 |
| `src/session.ts` | 6 |
| `src/solver/skills/registry.ts` | 6, 7 |
| `src/solver/skills/loader.ts` | 6 |
| `src/intelligence/outcome-feedback.ts` | 7 |
| `test/extensions/*.test.ts` (new), `test/skills/{discovery,arbitration,conflict,tool-wiring}.test.ts` | 8 |

---

# Research-backed lethal attack-surface priorities (bug-bounty 2024–2026)

*Why this section exists:* the user asked what real hunters attack so Ultimatrix goes "more lethal."
The basic OWASP-Top-10 tier (SQLi/XSS/single-IDOR/basic authz) is what modern frameworks (Next/Rails/
Spring/Django) have largely **closed**. The money is in the tier below — and especially in **chaining**.

## What actually pays (cross-platform data)
- **HackerOne** paid ~$81M (2024–25, +13% YoY); broken access control / IDOR is the **fastest-growing** class;
  **AI vulns +210%, prompt injection +540%**. Median critical payout = **$20k**.
- **Synack 2026 State of Vulns**: Injection 40.6% + Broken Access 32.8% dominate; **RCE +39% YoY**;
  XSS/SQLi *declining* year over year (frameworks hardening).
- **Sentinel-Sec / Bugcrowd**: BAC criticals +36%; recurring real-world combo = *"IDOR + mass-assignment + exposed
  S3 on a bank"*. Top classes: IDOR, BAC, mass assignment, SSRF→cloud, ATO via password reset, JWT misconfig,
  **GraphQL**, prompt injection.
- **Real payout ranges:** RCE $10k–$100k+, ATO $3k–$50k, SSRF→cloud-metadata $5k–$25k, cross-tenant priv-esc $5k–$40k.
- **The universal multiplier — chaining:** 7 of 10 high-pay reports are *chains*, not single bugs.
  IDOR→email-change→password-reset→ATO. Open-redirect→OAuth→ATO. CSPT→cache-deception→ATO.
  SSRF→IMDS→IAM creds. Low + Low = Critical.

## The critical methodology insight (why single-session scanning is blind)
- **BOLA/IDOR is relational**, not signature-based. A single authenticated session sees only its own 200s.
  Hunters use **multi-role replay** (≥3 sessions: privileged, same-tenant lower, cross-tenant stranger) and diff.
- **Empirical BOLA taxonomy** (107 HackerOne disclosures, 2021–2026): **Action-Level Object 41.7%**
  (unauthorized *write/delete* on another's object), **Direct Object Reference 36.9%**, Tenant Isolation 8.3%,
  Workflow-Context, Chained Disclosure, Object Rebinding. Standard read-only BOLA testing **misses the largest family**.
- **Techniques that turn basic→lethal:** method-switching (GET 403 but DELETE 200 / HEAD leaks), **mass-assignment**
  (`role`/`isAdmin` in PUT body), GraphQL global-ID BOLA + introspection + nested resolvers, predictable-UUID
  enumeration via leaked sibling/list endpoints, cross-tenant replay, 2FA/prototype-chain bypass (`__proto__` as OTP).
- **AI-agent attacks (fastest-growing):** prompt injection → RCE in agents (Trail of Bits: argument injection on
  "safe" commands; TIP RCE-2 via tool-description + tool-return poisoning; ToolHijacker manipulates tool selection;
  EchoLeak zero-click data exfil). Our `ai-trust` is basic — needs tool-poisoning / argument-injection sub-classes.

## Lethal gaps vs. our current code
We have the *pieces* but lack the orchestration:
- Have: multi-session worker pool, `authStateDetector`, `testSessionValid`, `auth-recorder`, `rbac-learner`,
  `ssrfOast`, `ai-trust`, `concurrencyHarness`, `invariantProbe`/`workflowBypass`.
- Missing: **cross-role diff engine**, **action-level / method-switch / mass-assignment BOLA**, **ATO chain**,
  **GraphQL BOLA**, **RCE-class** (SSTI/proto-pollution/cmd-inj/upload/XXE), **AI-agent RCE**, and the
  **active chaining planner** (P0).

## Revised "lethal" ordering for native primitives (P1)
- **P1.1 BOLA multi-role replay engine** (THE #1 money class): cross-role diff matrix + action-level
  (GET/PUT/PATCH/DELETE/HEAD) + method-switch + mass-assignment + cross-tenant. Builds on existing multi-session +
  `authStateDetector`. *Highest ROI.*
- **P1.2 ATO chain primitive**: IDOR→email-change→password-reset→takeover; OAuth/SAML misconfig;
  2FA/prototype-chain (`__proto__`) bypass. Composes with P1.1.
- **P1.3 SSRF → cloud-metadata exfil** (extend `ssrfOast`): IMDSv2 token flow → IAM creds → critical.
- **P1.4 RCE-class**: SSTI, prototype-pollution→sink, OS command injection, upload/XXE.
- **P1.5 GraphQL BOLA**: introspection + global-ID object swap + field-level authz + batching/alias DoS.
- **P1.6 AI-agent attacks** (extend `ai-trust`): tool-description poisoning, argument injection, TIP→RCE.

**P0 chaining planner** stays the force-multiplier (research confirms chains = the payout).
**P2 substrate** lets hunters bring SAML / deserialization / nuclei / Burp-Autorize-style replay as MCP plugins.

## Implementation sequence (locked)
P0 (chaining planner) → P1.1 (BOLA multi-role) → P1.2 (ATO chain) → P1.3 (SSRF→metadata)
→ P1.4 (RCE-class) → P1.5 (GraphQL) → P1.6 (AI-agent) → P2 (substrate) → P3 (plugin examples)
→ P3 long tail via plugins.

## Key sources
- HackerOne 9th Hacker-Powered Security Report; Bugcrowd State of Bug Bounty.
- Synack 2026 State of Vulnerabilities Report.
- "Broken Object Level Authorization in the Wild" (arXiv 2605.25865, 107 HackerOne disclosures).
- Pentrova "BOLA Hunting in Microservices" (multi-role replay); invicti BOLA testing guide.
- Trail of Bits "Prompt injection to RCE in AI agents" (2025); EchoLeak CVE-2025-32711; ToolHijacker; TIP RCE-2.
- Real chains: IDOR→ATO (Medium/ghostyjoe), CSPT→cache-deception→ATO, OAuth misconfig→ATO, $15k CSPT+2FA bypass.

---

## Implementation status (build)

### DONE
- **P0 — Active Chain Planner**
  - `src/intelligence/chain-planner.ts` (new): `proposeChainStep`, `runActiveChaining`, `ChainStep`.
    Typed token matcher (no substring of free text). `runPrimitiveById` dispatch keeps every
    executed step EvidenceGate-gated.
  - `src/intelligence/chaining.ts`: removed the fragile `sourceTech.includes(rule.source)`
    matcher; added `techniqueTokens` / `techniqueMatches` (primitive-id→slug alias map, case-insensitive).
    `suggestFollowUp` rewritten to use chain rules + registered primitives (typed).
  - Tests: `test/intelligence/chain-planner.test.ts` (10), `test/intelligence/chaining.test.ts` (existing, still green).
- **P1.1 — BOLA Multi-Role Replay Engine**
  - `src/primitives/bolaFuzzer.ts` (new): horizontal read + **action-level write/delete** (the 41.7% family)
    + method-switch + mass-assignment, status/behavior-authoritative oracle, EvidenceGate-confirmed.
  - Registered in `src/primitives/index.ts` (now 12 primitives; auto-exposed as `runPrimitive` tool via `z.enum`).
  - Chain planner deepens `idor` findings → `bolaFuzzer` (`SOURCE_DEEPEN_PRIMITIVE`).
  - Coverage guards updated: `test/primitives/registry.test.ts` (expected ids), `test/primitives/coverage.test.ts` (bola keywords).
  - Tests: `test/primitives/bolaFuzzer.test.ts` (4).
  - Verification: `npm run build:cli` clean; `test/intelligence`+`test/primitives`+`test/tools` = 342 passing.

- **P1.2–P1.6 — Lethal attack primitives (5 new)**
  - `src/primitives/atoChain.ts` (account takeover: IDOR→profile-swap, reset, 2FA/proto-chain bypass), `ssrfMetadata.ts` (SSRF→AWS IMDSv2→IAM creds), `rceClass.ts` (SSTI / cmd-inj / proto-pollution / XXE), `graphqlBola.ts` (introspection + global-ID swap + field authz), `aiAgentAttack.ts` (tool-poisoning / argument-injection / TIP→exfil).
  - All registered in `src/primitives/index.ts` (now 17 primitives; auto-exposed via `runPrimitive` tool).
  - Chain planner deepens sources to the right primitive: `idor→bolaFuzzer`, `ssrf→ssrfMetadata`, `sqli→classicInjection`, `xss→atoChain`, `jwt→atoChain`, `session-hijack/token-theft→atoChain`, `prompt-injection/ai→aiAgentAttack`, etc.
  - Tests: `test/primitives/atoChain.test.ts` (3), `ssrfMetadata.test.ts` (5), `rceClass.test.ts` (5), `graphqlBola.test.ts` (5), `aiAgentAttack.test.ts` (4). Drift/coverage guards updated.

- **P2 — Extensibility Substrate (all 8 phases)**
  - `src/extensions/`: `types.ts`, `tool-registry.ts` (DynamicToolRegistry: built-in + plugin + MCP over stdio/http/sse with OAuth2/PKCE + client-credentials), `tool-tools.ts` (listTools/loadTool discovery), `mcp-client.ts`, `resolve-env.ts` (${ENV} interpolation, secret warnings), `token-store.ts` (AES-256-GCM, 0600), `index.ts` (applyConfigExtensions).
  - `src/cli/mcp.ts` + `cli/index.ts`: `ultimatrix mcp add|remove|list|detect`.
  - Config: `mcp`, `plugins`, `skillsDirs`, `skills.exclude` in `src/config.ts` / `config/schema.ts`.
  - Pure discovery: removed `SkillRegistry.matchSkills` substring scorer and `resolveSkillsForInput` (session.ts) — skills surfaced via listSkills/searchSkills only; user skills namespaced `user/<id>`, `skills.exclude` honored in loader.
  - Safety floor unchanged: scope guard, evidence gate, rate limits remain code-injected/non-overridable.
  - Tests: `test/extensions/{tool-registry,tool-tools,resolve-env,mcp-client,protocol-plugin}.test.ts` (20). Full suite 1449→~1451 passing; `npm run build:cli` clean.

- **P3 — Protocol/surface plugin examples**
  - `plugins/protocol-surface/index.ts`: `register()` exporting `detectSmuggling` (CL/TE desync), `probeCachePoisoning` (unkeyed-header reflection), `graphqlIntrospect` — real evidence-backed probes reusing the HTTP tool, wrapped by DynamicToolRegistry with full safety guards.
  - Opt-in via `plugins: ['./plugins/protocol-surface']` in `ultimatrix.yaml`.
  - Test: `test/extensions/protocol-plugin.test.ts` (registration + lazy resolve).

### NEXT / OPEN
- `runActiveChaining` (chain-planner) was wired into the solver post-finding hook (guarded budget) AND has since been **retired as a duplicate escalation spine** — superseded by `runExploitationLoop` (weaponization spine, W0.2), which is the single escalation driver. `chain-planner` module + its own unit tests (`test/intelligence/chain-planner.test.ts`) remain intact and available via `runPrimitive`/`chain-planner` directly. The solver no longer double-runs two competing hooks against the same `maxActiveChainSteps` budget (removed the budget-overlap smell).
- Live MCP subprocess + OAuth browser flow remain integration-tested only via mocks (no real server spawned in CI).

### Remaining optional post-MVP expansions (open, out of current scope)
- MCP tool *result* caching / rate-limit per external server (transport-level fairness).
- Plugin sandboxing (load user plugins in isolated context; currently trusted import).
- Skill merit *decay* over time (techniques that stop producing findings lose weight automatically).
- Cross-session MCP server discovery persistence (auto-detected servers remembered).
- Web UI for MCP/plugin management (currently CLI-only).

