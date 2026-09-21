# Juice Shop Lethality Proof — Execution Plan

**Goal:** Run Ultimatrix against OWASP Juice Shop, prove real-world web app exploitation capability, publish evidence artifacts.

**Target:** OWASP Juice Shop (Docker, `http://localhost:3000`, 116 challenges across 16 categories)

**Date:** 2026-09-18

## Verified progress (2026-09-18)

- Live Juice Shop smoke test confirmed the target is reachable (`/` 200 and product search 200).
- The first solver failure was a tool bootstrap contract failure: graph/network tools were not callable on the first model turn. The solver now exposes the control-plane tools immediately and browser capabilities through lazy callable proxies.
- Live verification then caught a real provider-boundary defect: NVIDIA was passed as a native Stagehand provider. Stagehand now maps OpenAI-compatible providers through the OpenAI adapter while retaining the configured model id, API key, and base URL.
- Evidence: the fixed run initialized `openai/nvidia/nemotron-3-super-120b-a12b` and completed `stagehand_navigate` against Juice Shop. Focused regressions: 46 tests passed, including all 8 architecture cases (16 assertions).
- Remaining acceptance gate: complete a bounded autonomous run and report coverage/findings; a model-side `503 service_unavailable` or an operator interrupt must be recorded as an explicit run failure, never as a completed assessment.

---

## Phase 0 — Broken Basics Fix (1 day)

Fix the 3 things that block a clean autonomous run and hurt credibility when someone reads the source.

### 0.1 Fix `skills` CLI dead-end

**Problem:** `cli/index.ts` has a `case 'skills'` handler but `skills` is absent from the `knownCommands` set. Running `ultimatrix skills list` hits the "unknown command" guard before reaching the switch — dead-end bug.

**File:** `src/cli/index.ts`
**Fix:** Add `'skills'` to the `knownCommands` Set (around line 88-91).

### 0.2 Soft-abort in REPL (stop turn, keep session)

**Problem:** Ctrl+C kills the entire session. No "stop this turn, keep the session" exists. `phase: 'interrupt'` exists in the stream contract but nothing uses it.

**Files:** `src/session/lifecycle.ts`, `src/session.ts`
**Fix:** On first SIGINT during solver turn: set `abortController.abort()`, emit `[PHASE: interrupt]` to chat, return to REPL prompt (don't exit). On second SIGINT: full exit. This uses the existing `abortController` in lifecycle.ts.

### 0.3 Wire approval inbox (web)

**Problem:** `/api/spider/approve` endpoint exists but no UI component calls it. The HITL safety contract is inoperable from the web.

**Files:** `src/app/api/spider/approve/route.ts` (verify exists), `src/components/chat-stream.tsx` (add approval card rendering for `approval-request` SSE event type)
**Fix:** When SSE emits `approval-request`, render an approve/deny card in ChatStream that POSTs to `/api/spider/approve`.

### 0.4 Delete dead weight

**Files to delete:**
- `src/ui/banner.ts` (dead — nothing imports it)
- `src/ui/index.ts` (dead — re-exports banner)
- 16 components in `src/components/ui/` importing `ink` (terminal-only, not usable in browser)

**Verify before deleting:** grep for imports of each file.

### Tests
- `test/cli/known-commands.test.ts` — verify `skills` is in knownCommands
- Existing REPL test — verify SIGINT returns to prompt (not exit) on first press

---

## Phase 1 — Juice Shop Autonomous Run (2-3 days)

### 1.1 Docker target setup script

**No code changes to Ultimatrix.** Create a shell script (`scripts/juice-shop-run.sh`) that:
1. Checks if Juice Shop container is running (`docker ps | grep juice-shop`)
2. If not, pulls and starts: `docker run -d -p 3000:3000 bkimminich/juice-shop`
3. Waits for health check: `curl -sf http://localhost:3000/rest/products/search?q=q | grep -q items`
4. Runs: `npx ultimatrix solve -t http://localhost:3000 -o ./juice-shop-results`
5. Captures exit code and report path

### 1.2 Config for Juice Shop run

**File:** `ultimatrix.juice-shop.yaml` (gitignored — has API key)
```yaml
provider: groq
model: llama-3.1-8b-instant
target: http://localhost:3000
engine: solver
solver:
  maxToolCalls: 100
  maxTokens: 120000
  maxDurationMs: 600000
```

**Run command:**
```bash
# Set API key
export GROQ_API_KEY=gsk_xxx

# Option A: init + solve
npx ultimatrix init --provider groq --model llama-3.1-8b-instant --key $GROQ_API_KEY
npx ultimatrix solve -t http://localhost:3000 -o ./juice-shop-results

# Option B: config file
ULTIMATRIX_CONFIG=ultimatrix.juice-shop.yaml npx ultimatrix solve -t http://localhost:3000 -o ./juice-shop-results
```

### 1.3 Autonomous fallback for `askUser` during solve

**Problem:** Some brain tools call `askUser` which blocks in autonomous mode.

**File:** `src/tools/interaction-tools.ts`
**Fix:** When `interactionMode === 'run'`, `askUserConfirm` auto-approves (already works). Verify `waitForInput` returns a sensible default (not empty string). Add a 5s timeout fallback.

### 1.4 Verify browser tools work against Juice Shop

**Known issue:** Some browser tools depend on Stagehand CDP connection. Verify that `stagehand_navigate`, `stagehand_extract`, `stagehand_act` work against a local Juice Shop.

**Fallback:** If Stagehand tools fail, the HTTP tools (`httpRequest`) still work for most challenges.

### 1.5 Increase solver rounds for comprehensive coverage

Juice Shop has 116 challenges. The default `maxRounds: 5` is too low.

**File:** `src/config.ts` (or CLI flag)
**Option:** Add `--max-rounds` flag to `solve` command, or set `solver.maxToolCalls: 100` in config.

---

## Phase 2 — Challenge Execution Strategy (1-2 days)

Run Ultimatrix in waves, not one monolithic pass. Each wave targets a category.

### Wave 1: Injection (14 challenges) — Ultimatrix's strongest area
- `classicInjection` primitive → Login Admin/Bender/Jim, User Credentials, Christmas Special, Database Schema
- `nosqlInjection` primitive → NoSQL DoS/Exfiltration/Manipulation, Ephemeral Accountant
- `sstiBlind` primitive → SSTi
- `aiTrust`/`aiAgentAttack` primitives → Chatbot Prompt Injection, System Prompt Extraction, Greedy Chatbot Manipulation

### Wave 2: XSS (9 challenges)
- `modern-xss` skill → DOM XSS, Reflected XSS, API-only XSS, Bonus Payload, Video XSS
- `headerInjection` primitive → HTTP-Header XSS
- `render-tracer` → trace payload landing

### Wave 3: Broken Access Control + Auth (21 challenges)
- `authBypass`/`atoChain`/`credentialReuse` → Login Amy/MC SafeSearch/Cloud Admin, Reset Passwords
- `idorSwapper`/`bolaFuzzer` → Manipulate Basket, View Basket, Forged Feedback
- `authzMatrix` → Admin Section, Five-Star Feedback
- `jwt-advanced`/`jwt-algorithm-confusion` → Forged/Unsigned JWT

### Wave 4: Business Logic + Crypto (10 challenges)
- `configTrust` → Product Tampering (price), Deluxe Fraud, Payback Time, Zero Stars
- `businessLogicAbuse` → Wallet Depletion, Coupon Abuse
- `concurrencyHarness` → Multiple Likes
- `encodeDecode` → Forged Coupon (crypto encoding)

### Wave 5: Misc + Config (remaining)
- `cors-misconfig` → CORS challenges
- `open-redirect` → Unvalidated Redirects
- `xxe` → XXE Data Access, XXE DoS
- `information-disclosure` → Confidential Document, Exposed Credentials, Access Log
- `file-upload-attacks` → Upload Type/Size

### Known unachievable (no skill/primitive covers):
- CAPTCHA Bypass (requires CAPTCHA solver)
- Email interception (requires email server)
- Web3/Blockchain (requires Ethereum provider)
- Steganography (requires image analysis)
- 2FA bypass (requires TOTP/SMS interception)

**Expected hit rate:** 60-80% of 116 challenges (70-93 solvable; 23-46 unachievable due to infrastructure gaps)

---

## Phase 3 — Evidence Artifact Collection (1 day)

### 3.1 Capture what the run produces

After the solve run:
```bash
# Check results
ls -la ./juice-shop-results/
cat ./juice-shop-results/solve-*.json | jq '.findings | length'
cat ./juice-shop-results/solve-*.json | jq '.findings[] | {title, severity, proof}'
```

### 3.2 Verify evidence chain quality

For each finding in the output, verify:
- [ ] `proofCheck.passed === true` (evidence gate verified)
- [ ] `request.method` + `request.url` present (reproducible)
- [ ] `response.status` + `response.body` present (evidence)
- [ ] `reproductionSteps` present (human-readable)
- [ ] `exploitProofNodeId` present (linked to ExploitProof graph node)

### 3.3 Extract replayable curl commands

From each finding's `request` field, generate:
```bash
curl -X '<method>' '<url>' \
  -H '<header>: <value>' \
  --data-raw '<body>'
```

### 3.4 Generate HTML report

```bash
npx ultimatrix report -f html -o ./juice-shop-results/report.html
```

The report generator (`src/report/generator.ts`) already produces HTML with:
- Severity badges
- Evidence chains (request/response)
- Reproduction steps
- Proof status
- Forensic timeline

### 3.5 Document results

Create `docs/JUICE-SHOP-RESULTS.md` with:
- Total challenges attempted
- Challenges solved (by category)
- Challenges failed (by category + reason)
- Top 5 most impressive findings (with curl + evidence)
- Comparison to other tools (PentestGPT: never tested Juice Shop; hackingBuddyGPT: Linux privesc only)

---

## Phase 4 — UX Polish (parallel, after Phase 1-2 stable)

### 4.1 Findings as Evidence Cards (web)

**Files:** `src/components/graph-panel.tsx` (Findings tab), new `src/components/evidence-inspector.tsx`

Replace flat finding list with expandable cards:
- Severity badge (color-coded)
- Title + CWE
- Proof status badge (PASSED/FAILED)
- One-click "Show evidence" → inline request/response viewer
- "Copy as curl" button
- "Replay" button (calls `replayExploitProof`)
- Linked ExploitProof node display

### 4.2 Inline findings in ChatStream

**File:** `src/components/chat-stream.tsx`

When SSE emits `finding` event, render as an inline evidence card (not just a text line). Severity-colored, expandable, with action buttons.

### 4.3 Mission Dashboard Strip

**File:** `src/components/status-bar.tsx`

Show live during engagement:
- Token budget burn (from `token-budget-tracker.ts`)
- OODA phase (from solver state)
- Findings count by severity
- Active campaign slices (if campaign running)
- Claim holds count

### 4.4 Engagement Lifecycle (Debrief screen)

**File:** New `src/components/debrief-screen.tsx`

Post-engagement summary:
- Findings recap (sorted by severity)
- Evidence gallery (all ExploitProof request/response pairs)
- Report generation button (HTML/MD/JSON)
- Export actions (download, copy to clipboard)
- "What's next" suggestions (re-run with different skills, deeper on specific findings)

### 4.5 Clean up dead web components

**Delete:** 16 `src/components/ui/*.tsx` files importing `ink`
**Delete:** `src/ui/banner.ts`, `src/ui/index.ts`
**Delete:** Orphaned deps in `package.json` (`ink`, `d3` if unused by graph panel)

---

## Phase 5 — Publish + Iterate (after Phases 1-4)

### 5.1 Publish Juice Shop results as GitHub artifact

Upload to a public gist or release:
- `juice-shop-results/` directory (report + evidence)
- Challenge hit-rate table
- Top 5 curl-verified findings
- Video walkthrough (optional)

### 5.2 Update README

Add section: "Proven against OWASP Juice Shop" with badge + link to results.

### 5.3 Iterate on failed challenges

For each failed challenge:
- Is it a skill gap? → Write new skill
- Is it a tool gap? → Wire existing tool or adapter
- Is it an infrastructure gap? (CAPTCHA, email, Web3) → Document as known limitation

---

## Effort Summary

| Phase | Days | Depends on |
|-------|------|------------|
| 0 — Broken basics | 1 | Nothing |
| 1 — Juice Shop run | 2-3 | Phase 0 |
| 2 — Challenge execution | 1-2 | Phase 1 (parallel with run) |
| 3 — Evidence collection | 1 | Phase 1-2 |
| 4 — UX polish | 5-8 | Phase 0 (parallel with 1-3) |
| 5 — Publish | 1 | Phase 1-4 |
| **Total** | **11-16 days** | |

---

## Success Criteria

| Metric | Target | How measured |
|--------|--------|-------------|
| Juice Shop challenges solved | ≥ 70/116 (60%) | Flag extraction + evidence gate |
| Evidence chain integrity | 100% of findings have proofCheck.passed | JSON report validation |
| Replayable findings | ≥ 80% of findings have curl-able request | Report inspection |
| Broken basics fixed | 0 dead-end bugs, soft-abort works | Manual test + CI |
| Web UI evidence inspector | Findings expandable with request/response | Visual inspection |
| Published artifacts | Report + curl commands + hit-rate table | GitHub release |

---

## Relevant Files

### Modified
- `src/cli/index.ts` — skills command fix
- `src/session/lifecycle.ts` — soft-abort
- `src/tools/interaction-tools.ts` — askUser autonomous fallback
- `src/components/chat-stream.tsx` — approval cards + inline findings
- `src/components/graph-panel.tsx` — evidence inspector
- `src/components/status-bar.tsx` — mission dashboard strip

### Created
- `scripts/juice-shop-run.sh` — Docker target setup + run
- `ultimatrix.juice-shop.yaml` — Juice Shop config
- `src/components/evidence-inspector.tsx` — findings evidence cards
- `src/components/debrief-screen.tsx` — post-engagement summary
- `docs/JUICE-SHOP-RESULTS.md` — results documentation

### Deleted
- `src/ui/banner.ts`, `src/ui/index.ts` — dead code
- 16 `src/components/ui/*.tsx` — ink imports (browser-incompatible)

### Referenced (no changes)
- `src/report/generator.ts` — already produces HTML/MD/JSON reports
- `src/solver/solver.ts` — autonomous solver engine
- `src/safety/scope-guard.ts` — auto-scopes to localhost
- `src/browser/manager.ts` — headless browser auto-launch
- `skills/injection/` — 74 skills covering all Juice Shop categories
- `src/primitives/` — 33 attack primitives
