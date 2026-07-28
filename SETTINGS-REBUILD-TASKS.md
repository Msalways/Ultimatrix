# Settings Rebuild + Data-Sharing Fixes — Task Breakdown

## Scope
Full CLI config parity in web UI. YAML = single source of truth. Forensic log gap fix.

---

## Phase 1: Backend Fixes (Shared Data + Config Persistence)

### T1.1 — Forensic Log in WebEngine
- **File:** `src/web/engine.ts`
- **Change:** Import `ForensicLog` + `setForensicLog`. In `init()`, create `ForensicLog` at `output/<slug>/forensic.ndjson` and call `setForensicLog()`.
- **Also:** In `destroy()`, flush and clear the forensic log.
- **Why:** Web sessions currently have zero forensic logging — all `getForensicLog()` calls return null.

### T1.2 — config-bridge: deepMerge + error handling + masked credential protection
- **File:** `src/web/config-bridge.ts`
- **Changes:**
  1. Add `deepMerge()` utility (recursive object merge, arrays replaced not merged)
  2. Fix `saveWebConfig()`: catch `ConfigError` from `validateConfig()`, return `{ok:false, errors}`
  3. Add `isMasked()` check: detect `****` prefix, skip overwriting real keys with masked values
  4. Merge creds properly: `deepMerge(current.creds, updates.creds)` before saving
- **Why:** Current code has wrong error handling, shallow merge loses nested config, masked keys overwrite real keys.

### T1.3 — saveProjectConfig: persist all missing sections
- **File:** `src/config.ts` (lines 1159-1262)
- **Missing sections to add:**
  - `engine` (line ~1169, after timeout)
  - `solver` (after modelTiers)
  - `spider` (after solver)
  - `antiLoop` (after spider)
  - `reflexion` (after antiLoop)
  - `verifier` (after reflexion)
  - `interaction` (after verifier)
  - `campaign` (after budgetPolicy)
  - `oast` (after campaign)
  - `compression` (after oast)
  - `truncation` (after compression)
  - `council` (after truncation)
  - `mcp` (after council)
  - `plugins` (after mcp)
  - `skillsDirs` (after plugins)
  - `skills` (after skillsDirs)
  - `requireCapableModel` (after modelCapabilities)
  - `authorization` (after scope)
- **Pattern:** `if (config.X) output.X = config.X` for simple objects, non-default checks for ones with defaults.

### T1.4 — New API endpoint: POST /api/config/validate
- **File:** `src/app/api/config/validate/route.ts` (NEW)
- **Purpose:** Validate partial config without saving. Used by modal for real-time validation.
- **Logic:** Load current config → deepMerge with body → validateConfig → return {ok} or {ok:false, errors}.

### T1.5 — New API endpoint: GET /api/config/providers
- **File:** `src/app/api/config/providers/route.ts` (NEW)
- **Purpose:** Return PROVIDER_INFO map so the modal builds provider dropdowns dynamically.
- **Logic:** Import PROVIDER_INFO from config.ts, return as JSON.

---

## Phase 2: Config Store + Shared Primitives

### T2.1 — Zustand config store
- **File:** `src/stores/config-store.ts` (NEW)
- **State:** config, original, dirty, saving, saved, error, needsRestart
- **Actions:** load(), update(patch), save(), reset(), markRestartNeeded()
- **Dirty detection:** Compare config vs original on each top-level key
- **Restart detection:** provider, model, engine, modelTiers changes → needsRestart=true

### T2.2 — ConfigField (label + input + error)
- **File:** `src/components/settings/config-field.tsx` (NEW)

### T2.3 — ConfigToggle (boolean switch)
- **File:** `src/components/settings/config-toggle.tsx` (NEW)

### T2.4 — ConfigSelect (dropdown)
- **File:** `src/components/settings/config-select.tsx` (NEW)

### T2.5 — ConfigNumber (number input with min/max)
- **File:** `src/components/settings/config-number.tsx` (NEW)

### T2.6 — ConfigSection (collapsible section)
- **File:** `src/components/settings/config-section.tsx` (NEW)

### T2.7 — RestartBanner
- **File:** `src/components/settings/restart-banner.tsx` (NEW)

---

## Phase 3: Tab Panels

### T3.1 — GeneralTab
- **File:** `src/components/settings/tabs/general-tab.tsx` (NEW)
- **Fields:** provider (select from PROVIDER_INFO), model, target, engine (select), depth, timeout, requireCapableModel

### T3.2 — ProvidersTab
- **File:** `src/components/settings/tabs/providers-tab.tsx` (NEW)
- **Fields:** Per-provider credential forms (apiKey masked, baseUrl). Show configured providers + "Add Provider". Azure/Bedrock special fields.

### T3.3 — ModelTiersTab
- **File:** `src/components/settings/tabs/model-tiers-tab.tsx` (NEW)
- **Fields:** 3 tier cards (fast/balanced/powerful) with provider select + model text. ModelCapabilities table below.

### T3.4 — ScopeSafetyTab
- **File:** `src/components/settings/tabs/scope-safety-tab.tsx` (NEW)
- **Fields:** scope.allowedDomains, allowedPaths, allowedProtocols, enforcement, authorization

### T3.5 — BrowserTab
- **File:** `src/components/settings/tabs/browser-tab.tsx` (NEW)
- **Fields:** browser.headless, viewport, domSettleTimeout, env, selfHeal, verbose, spider.enabled/maxSteps/maxDurationMs

### T3.6 — SolverTab
- **File:** `src/components/settings/tabs/solver-tab.tsx` (NEW)
- **Fields:** solver (maxToolCalls, maxDurationMs, maxParallel, maxRounds, maxActiveChainSteps), antiLoop, reflexion, verifier, interaction

### T3.7 — BudgetTab
- **File:** `src/components/settings/tabs/budget-tab.tsx` (NEW)
- **Fields:** budgetPolicy (enforcement, scope, resetOn, allocation sliders, maxModelCallsPerTask, trackTokens), rateLimit (global)

### T3.8 — AdvancedTab
- **File:** `src/components/settings/tabs/advanced-tab.tsx` (NEW)
- **Fields:** campaign, oast, compression, truncation, memory, agent, context, council, mcp[], plugins[], skillsDirs, skills.exclude

---

## Phase 4: Modal Shell + Integration

### T4.1 — Rewrite settings-modal.tsx
- **File:** `src/components/settings-modal.tsx` (REWRITE)
- **Structure:** 8-tab horizontal bar + content area + footer (Cancel / Save)
- **Integration:** Uses config-store, shows RestartBanner, dirty-close confirmation
- **Width:** w-[800px] max-h-[85vh]

### T4.2 — Config change detection for restart
- **Engine-affecting fields:** provider, model, engine, modelTiers
- **On change:** needsRestart=true → RestartBanner shown above footer

---

## Phase 5: Verification

### T5.1 — Build check
- `npm run build:cli` — clean
- `npx tsc --noEmit` — zero new errors in src/components/settings/, src/stores/config-store.ts, src/web/

### T5.2 — Test check
- `npm test` — all 1745+ tests pass

### T5.3 — Functional verification
- GET /api/config returns full masked config with all sections
- POST /api/config saves to both providers.yaml and ultimatrix.yaml
- POST /api/config/validate validates without saving
- GET /api/config/providers returns PROVIDER_INFO
- Settings modal loads full config, all tabs populated
- Save persists to YAML, reload shows saved values
- Masked keys preserved on save (not overwritten)
- Forensic log file created during web solve

---

## File Manifest

### New files (20)
```
src/stores/config-store.ts
src/components/settings/config-field.tsx
src/components/settings/config-toggle.tsx
src/components/settings/config-select.tsx
src/components/settings/config-number.tsx
src/components/settings/config-section.tsx
src/components/settings/restart-banner.tsx
src/components/settings/tabs/general-tab.tsx
src/components/settings/tabs/providers-tab.tsx
src/components/settings/tabs/model-tiers-tab.tsx
src/components/settings/tabs/scope-safety-tab.tsx
src/components/settings/tabs/browser-tab.tsx
src/components/settings/tabs/solver-tab.tsx
src/components/settings/tabs/budget-tab.tsx
src/components/settings/tabs/advanced-tab.tsx
src/app/api/config/validate/route.ts
src/app/api/config/providers/route.ts
```

### Modified files (4)
```
src/web/engine.ts          — T1.1: Add ForensicLog creation
src/web/config-bridge.ts   — T1.2: deepMerge, error handling, masked key protection
src/config.ts              — T1.3: saveProjectConfig persist all sections
src/components/settings-modal.tsx — T4.1: Full rewrite with 8 tabs
```
