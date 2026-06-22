# Phase 1 — Browser Foundation

**Goal:** Headed Chromium window appears on startup. Stagehand initialized before spider. No raw `chromium.launch()` for utility tasks. The spider crawls using AgentBrowser (headed) + Stagehand (headless extraction).

## Tasks

### 1.1 `src/browser/manager.ts`

- Add `headless` parameter to `getBrowser()` (default `false`)
- Export `initBrowser()` that creates + calls `ensureReady()`

```typescript
let _browserInit = false

export async function initBrowser(headless = false): Promise<AgentBrowser> {
  if (_browserInit) return getBrowser()
  const b = getBrowser()
  // Update headless
  ;(b as any).config = { ...(b as any).config, headless }
  await b.ensureReady()
  _browserInit = true
  return b
}
```

### 1.2 `src/workers/registry.ts`

- Rename `getStagehand()` → `initStagehand()` and export it
- Accept `headless` parameter instead of hardcoded `true`
- `createAllWorkers()` reuses the singleton (doesn't re-init)

```typescript
export async function initStagehand(headless = true): Promise<Stagehand | null> {
  if (_stagehand) return _stagehand
  _playwrightBrowser = await chromium.launch({ headless })
  const context = await _playwrightBrowser.newContext()
  const page = await context.newPage()
  _stagehand = new Stagehand({ page, context, browser: _playwrightBrowser })
  setGlobalStagehand(_stagehand)
  return _stagehand
}
```

### 1.3 `src/cli/index.ts`

Rewrite init order in the default (TUI) block:

```
1. initObservability()
2. checkForPreviousSession() / resumeSession()
3. createRecorder(target)
4. startOastServer()
5. load stores
6. initBrowser(headless=false)  ← headed window appears
7. initStagehand(headless=true)  ← headless attack engine
8. createSpiderAgent()
9. spiderAgent.generate()  ← now has both browsers available
10. createAllWorkers()  ← reuses Stagehand singleton
11. createSupervisor()  ← agents managed by Mastra sub-agents
12. startTUI()
```

Remove:
- Raw `chromium.launch()` block (lines 142-200)
- `dismissOverlays`, `exploreFormsOnPage`, `fillAndSubmitForm` imports
- `chromium` import from playright

### 1.4 `src/session.ts`

Same cleanup — remove raw `chromium.launch()` + spider-features.

### 1.5 `src/spider/instructions.ts`

Convert to function: `getSpiderInstructions(target: string)`. Tell spider to:
1. Use `browser_goto` for initial navigation (headed, visible)
2. Use `browser_snapshot` to read page state
3. Use `stagehandAct` for natural language actions (overlay dismiss, form fill)
4. Use `stagehandExtract` for structured data extraction
5. Record discovered pages/forms/actions to graph with `updateGraph`

### 1.6 `src/spider/agent.ts`

- Accept `target` param
- Inject target into instructions via `getSpiderInstructions(target)`
- Pass to Agent constructor

## Files to Remove

- `src/explorer/spider-features.ts`
- `src/explorer/spider-features.test.ts`

## Verification

```bash
npm run build && ultimatrix -t https://example.com
```

Expected:
- Headed Chromium window opens
- Spider navigates using browser_goto (user sees it)
- Spider progress logged
- TUI starts with graph populated
- `output/recordings/` has .spec.ts files from spider actions
