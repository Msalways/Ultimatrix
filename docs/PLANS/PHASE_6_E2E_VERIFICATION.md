# Phase 6 — End-to-End Verification

**Goal:** Full flow test. Everything works together.

## Tasks

### 6.1 TypeScript Check

```bash
npx tsc --noEmit
```

Expected: 0 errors.

### 6.2 Unit Tests

```bash
npx vitest run
```

Expected: All tests pass. Update tests for removed files (delegate-tool, injection-tools, stagehand-tools, explorer).

### 6.3 Build

```bash
npm run build
```

Expected: Clean tsup build (ESM + CJS + DTS).

### 6.4 Full Flow Test

```bash
ultimatrix -t https://example.com
```

Verify in this order:

1. **Headed window opens** — Chromium window appears, navigates to target
2. **Spider crawls** — Pages/forms/endpoints discovered, logged to graph
3. **Chat works** — Type "what did you find?" → Supervisor queries graph
4. **Test generation** — "test /login for vulnerabilities" → LLM generates test cases
5. **Spec files** — `output/recordings/<session>/*.spec.ts` exists with content
6. **Exit** — Ctrl+D → all browsers close, OAST stops, console restores

### 6.5 Playwright Tests Run

```bash
npx playwright test output/recordings/*.spec.ts
```

Expected: Generated tests execute without errors (or with expected failures for security tests).

## Cleanup

Remove any remaining dead code:
- Unused imports
- Dead variables
- Old comment references to removed files

## Delivery

All 7 phases complete. Product is:
- Headed browser visible on startup
- LLM thinks and generates test cases dynamically
- Every interaction recorded as Playwright tests
- Audit team runs `npx playwright test` for regression
- Clean Mastra integration (no hacks)
