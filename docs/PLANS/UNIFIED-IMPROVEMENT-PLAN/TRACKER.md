# Unified Improvement Plan - Tracker

**Last Updated**: 2026-08-27  
**Overall Progress**: 40% (7/20 major tasks complete)

---

## 📋 Phase F1: Constants Extraction & Maintainability

### F1.1 - Timeout Constants Extraction
- [ ] Create `src/constants/timeouts.ts` with all timeout values
- [ ] Extract from `src/config.ts`, `src/browser/`, `src/session/`, `src/evals/`
- [ ] Replace hardcoded timeouts with constants imports
- [ ] Update imports across affected files
- [ ] Add tests for timeout constants

**Files to modify:**
- `src/config.ts` - timeout constants (5000, 30000, 60000, 300000, 120000, 15000, 8000, 10000, 8000, 5000)
- `src/browser/` - browser timeouts
- `src/session/` - session timeouts
- `src/evals/` - eval timeouts

### F1.2 - Browser/Viewport Constants
- [ ] Create `src/constants/browser.ts`
- [ ] Extract viewport (1280x720), domSettleTimeout (5000)
- [ ] Replace in `src/config.ts`, `src/browser/`, `src/capture/`, `src/evals/`

### F1.3 - Network/HTTP Constants
- [ ] Create `src/constants/network.ts`
- [ ] Extract timeouts (30000, 60000, 30000, 15000, 5000, 10000, 8000)
- [ ] Replace in `src/http/`, `src/http/client.ts`, `src/session/`

### F1.4 - Size/Buffer Limits
- [ ] Create `src/constants/sizes.ts`
- [ ] Extract: 1MB (1024*1024), 64MB, 256KB, 50000, 100000, 64MB
- [ ] Update: `gadgetGen.ts`, `har-parser.ts`, `tool-result-store.ts`

### F1.5 - Retry/Backoff Constants
- [ ] Create `src/constants/retries.ts`
- [ ] Extract: maxRetries=3, backoffSteps=[5000,15000,30000], baseBackoffMs=2000, maxBackoffMs=30000

### F1.6 - String/Enum Constants
- [ ] Create `src/constants/strings.ts`
- [ ] Environments: LOCAL, PRODUCTION, DEVELOPMENT, STAGING, TEST
- [ ] Browser providers: stagehand, camoufox
- [ ] Engine types: multi-model, legacy, solver, council
- [ ] Engine tiers: fast, balanced, powerful
- [ ] Log levels, scope modes, engine types, interaction modes

### F1.6 - Port Constants
- [ ] Create `src/constants/ports.ts`
- [ ] PORT=3000, OAST=1000, etc.

### F1.7 - Size/Limit Constants
- [ ] Create `src/constants/limits.ts`
- [ ] maxEndpointsInSummary, maxFindingsPerTurn, maxBlackboardFactsInSummary
- [ ] maxEndpointsInSummary: 10, maxFindingsPerTurn: 20, maxBlackboardFactsInSummary: 100

### F1.7 - Create Constants Index & Exports
- [ ] `src/constants/index.ts` - main exports
- [ ] Update imports across codebase

### F1.8 - Replace Hardcoded Values Across Codebase
- [ ] Run codemod/script to replace magic numbers
- [ ] Update imports in all affected files

### F1.9 - Add ESLint Rules
- [ ] Configure `no-magic-numbers` rule
- [ ] Add `prefer-constants` rule pointing to `src/constants/`

### F1.8 - Tests & Verification
- [ ] Add tests for constants in `test/constants/`
- [ ] Run full test suite
- [ ] Run `tsc --noEmit` and `npm run build:cli`

---

## 📋 Phase F2: Canonical Registries (DONE - 1877696)

- [x] F2.1 SkillRegistry live read-through to shared loader index
- [ ] F2.2 Contract test I2: mid-session import spawnable
- [ ] F2.3 Engagement-scoped selector for council + toolpack
- [ ] F2.4 Registry rule documented in AGENTS.md

---

## Phase F3: Agent Result Envelope (DONE - 34745f9)

- [x] F3.1 WorkerExecutionEnvelope type
- [ ] F3.2 Executor bridges toolResults → coreEvidenceLedger
- [ ] F3.3 Full result persisted via ToolResultStore; getToolResult works
- [ ] F3.4 Swarm chaining passes resultRef (not 200-char slices)
- [ ] F3.5 Shared buildInformedTask helper
- [ ] F3.6 Worker informed-task carries Session Intelligence block

---

## Phase F4: Resource Claim Registry (DONE)

- [x] F4.1 claim-registry.ts with check-and-set, TTL, release/refresh
- [x] F4.2 Exploitation loop + playbook claim-before-fire
- [ ] F4.3 Metadata-first technique→primitive resolution (frozen map = last resort)
- [x] I4 contract test: concurrent claim blocks second path

---

## Phase F5: Stigmergic Coordination Layer (Swarm Intelligence)

### F5.1 PheromoneCoordinator
- [ ] Create `src/runtime/pheromone-coordinator.ts`
- [ ] Emit/subscribe API with typed signals
- [ ] Exponential decay per signal type
- [ ] TTL-based expiry with sweep-on-read

### F5.2 Worker Pheromone Emission
- [ ] Worker emission in `worker-pool-executor.ts` after execution
- [ ] Emit on: endpoint discovered, vuln found, cred found, session established
- [ ] Signal types: ENDPOINT_DISCOVERED, VULN_FOUND, CREDENTIAL_FOUND, SESSION_ESTABLISHED

### F5.3 Pheromone-Aware Task Scheduler
- [ ] Replace `maxParallel` with pheromone-weighted priority queue
- [ ] Workers subscribe to relevant signal types
- [ ] Pheromone decay background job (exponential decay per signal type)

### F5.3 Swarm Chaining via ResultRefs
- [ ] Sequential: pass resultRef instead of 200-char JSON
- [ ] Parallel: pass resultRefs array
- [ ] Prior findings inject as `[full output: <ref> via get-tool-result]`

### F5.4 Stigmergic Skill Selection
- [ ] Pheromone-weighted skill selection in SkillRegistry
- [ ] Skills get pheromone boost from recent successes

### F5.5 Pheromone Decay Background Job
- [ ] Exponential decay per signal type
- [ ] Configurable half-lives per signal type
- [ ] Expose metrics for dashboard

---

## Phase F6: Missing Lethal Primitives (Fuel Tank)

### F6.1 Credential Reuse Engine (Weeks 1-3) - HIGHEST ROI
- Core engine: found cred → validate → spray → graph edges
- Spray engine with rate limiting, lockout detection
- Per-protocol validators (SSH, WinRM, SMB, LDAP, HTTP, API, Cloud)
- Graph integration: Credential node + REUSES edges

### F6.2 Exploit Chain Engine (Weeks 4-6)
- Chain executor: SQLi → RCE → Persistence → Lateral
- 4 built-in chains: sqli-to-rce, auth-bypass→rce, idor→data-exfil, ssrf→cloud
- Chain state persisted in graph (CHAIN node + STEP edges)

### F6.3 AD/Kerberos Primitive Pack
- kerberoast, dcsync, golden-ticket, rbcd, shadow-credentials
- dcsync, golden-ticket, rbcd, shadow-credentials
- Next primitives mapping

### F6.4 Cloud Primitive Pack v1
- AWS: IAM enum, S3, IMDS, Lambda, STS assume-role
- Azure: Graph API, Key Vault, MSI
- GCP: IAM, Secret Manager, Cloud Functions

### F6.5 Lateral Movement Pack
- PTH, PTK, DCSync, RBCD, Shadow Credentials
- Pass-the-Hash/Ticket, DCSync, RBCD, Shadow Credentials

### F6.6 Cloud PrivEsc Pack
- AWS: IMDS→IAM→Role assumption, iam:PassRole
- Azure: Graph API, Key Vault, MSI
- GCP: IAM, Secret Manager, Cloud Functions

### F6.7 Lateral Movement Pack
- Pass-the-Hash/Ticket, DCSync, RBCD, Shadow Credentials
- Pass-the-Key, Overpass-the-Hash

### F6.8 Cloud PrivEsc Pack
- AWS: IMDS→IAM→Role assumption, iam:PassRole
- Azure: Graph API, Key Vault, MSI
- GCP: IAM, Secret Manager, Cloud Functions

---

## 📝 Specification Files to Create

### Priority 1 (This Week)
- [ ] `specs/F5-STIGMERGIC.md` - Stigmergic Coordination Layer
- [ ] `specs/F6-PRIMITIVES.md` - Missing Lethal Primitives

### Next Week
- [ ] `impl/F5-STIGMERGIC.md` - Implementation plan
- [ ] `specs/F6-PRIMITIVES.md` - Detailed primitive specs
- [ ] `impl/F6-PRIMITIVES.md` - Credential Reuse Engine impl plan

---

## 🚫 Deferred / Not Doing

- F7 Go Worker Runtime - DEFERRED (TypeScript SDK decision)
- Legacy engine removal - FROZEN per user request

---

*Last Updated: 2026-08-27 | Next Review: 2026-09-01*