# 02. Camoufox Provider (Phase A)

## Goal

Implement `CamoufoxProvider` as a real, selectable browser backend (anti-detection Firefox via Playwright) to root-cause-fix bot-challenge-blocked crawls, and de-type the browser seam so no provider is structurally privileged.

## Current State

- `BrowserProvider` interface + `resolveBrowserProvider` exist (src/browser/provider.ts). `'camofox'` is in `PLANNED_PROVIDERS` — **throws** at provider.ts:54-65 and manager.ts:73-78. Fail-closed placeholder only.
- `BrowserSession.browser` is typed as the concrete Stagehand handle (`StagehandBrowser`, provider.ts:29-34) — the seam itself bakes in one vendor.
- ~10 call sites reach into `requireStagehand()` / `stagehand.context.conn`: manager.getActivePage (186-197), state-bridge, dialog-watcher (`V3Context.addInitScript`), lazy-services:96-107 + lifecycle:475-503 (capture dispatch by Stagehand sniffing), spider-runtime getStagehandPage (676-687), flow-tools ×3.
- Deep CDP coupling: cdp-network-capture.ts subscribes Chromium-only `Network.*` incl. ExtraInfo events. Firefox has no CDP equivalent for these.
- Frozen vendor vocabulary: `stagehand_*` tool names hardcoded in spider/instructions.ts:80-82, lib/agent-manager.ts:442, mastra/tools.ts:999; graph-bridge.ts dispatches on those names.
- reaction-observer uses Stagehand-only `page.snapshot()`; passive-observer/render-trace attach Playwright-style `page.on(...)` that silently no-ops on Stagehand pages.
- Tests/evals lock camofox→throws: test/browser/provider.test.ts:46-48,90; test/runtime/engagement-runtime.test.ts:128-130; evals/fixtures.ts:243-251.
- Deps today: `@mastra/stagehand ^0.2.4`, `playwright ^1.52.0`. No stealth packages.

## Root Cause Framing

Cloudflare et al. block crawls because our browser is fingerprintable — a property of Chromium+automation signals, not of crawl logic. Challenge-retry logic treats the symptom; a stealth browser treats the cause. Camoufox launches through Playwright (`firefox.launch`), yielding real Page/Context objects — most MEDIUM-tier couplings port directly, and some hacks become unnecessary (native Firefox Playwright `page.on('dialog')` replaces the init-script interceptor).

## Gaps Addressed

- No second browser backend despite the seam existing since Slice 05.
- Capture path silently no-ops off-Chromium.
- Vendor tool names frozen into prompts and graph-bridge dispatch.

## In Scope

1. **De-type the seam**: generalize `BrowserSession.browser` to an abstract handle:
   ```typescript
   export interface BrowserHandle {
     getPage(): Promise<unknown>            // provider page object
     getTools?(): Record<string, unknown>   // provider-native tool map (optional)
   }
   ```
   Update all consumers to the handle; remove `requireStagehand()` reaches in favor of provider-dispatched helpers.
2. **CamoufoxProvider** implementing `BrowserProvider` via `playwright.firefox.launch({ executablePath })` with camoufox binary resolution (camoufox-js or pinned download), fingerprint options surfaced through config (humanize, locale, viewport, proxy passthrough).
3. **Provider-dispatched capture**: new `attachHarCaptureViaPlaywright(context)` sibling in src/session/ feeding the SAME single HAR-entry builder owned by har-parser.ts (`createHarEntryBuilder`). Replace the `stagehand?.context?.conn ? CDP : fallback` sniffing in lazy-services/lifecycle with provider-name dispatch. Playwright context request/response events + `response.body()` are the platform-native Firefox capture surface — explicitly NOT a from-scratch Network.* subset (standing constraint #1).
4. **Tool surface parity**: same 7 tool IDs implemented over Playwright primitives — navigate/screenshot/tabs direct; act/extract/observe via aria snapshot + evaluate (crawl-grade v1; Stagehand's self-healing LLM actions are out of scope for v1).
5. **Observers simplify**: dialog handling → native `page.on('dialog')`; reaction-observer → `locator.ariaSnapshot()` diff; passive observer works natively.
6. **Purge frozen vocabulary**: parameterize the 3 instruction sites to capability language ("the navigation tool"); make graph-bridge dispatch on typed result fields, not tool-name strings.
7. **Config + locks**: default remains `stagehand`; camofox opt-in per engagement; WorkflowStore provider-lock and resume-mismatch hard-reject stay unchanged. Flip PLANNED_PROVIDERS membership, both throw sites, the 3 test files, and the eval fixture.
8. Anti-bot challenge detection additionally invoked at browser launch + landing grounding (currently only after successful navigate — dialog-inject.ts:158); on challenge at launch → honest stopReason, not 'error'.

## Out of Scope

- Removing Stagehand (coexistence; per-workflow choice).
- Matching Stagehand's self-healing AI-driven act()/extract() quality.
- Chromium CDP capture changes (untouched for stagehand provider).
- Fingerprint rotation pools / proxy infrastructure.

## Public Types / Interfaces

```typescript
// src/browser/provider.ts
export interface BrowserSession {
  sessionId: string
  provider: BrowserProviderName
  browser: BrowserHandle          // was: StagehandBrowser
}

// NEW src/browser/camoufox-provider.ts
export class CamoufoxProvider implements BrowserProvider { ... }

// NEW src/session/playwright-network-capture.ts
export function attachHarCaptureViaPlaywright(context: PlaywrightBrowserContext): HarCaptureHandle

// config
browser: { provider: 'stagehand' | 'camofox', camofox?: { humanize?: boolean, locale?: string, ... } }
```

## Data Flow

Config resolves provider at engagement start (unchanged flow). Camoufox session exposes a Playwright page; capture attaches Playwright context listeners feeding createHarEntryBuilder → identical HAR JSON downstream (har-bridge, CapturedRequestStore ingest, replay tools all provider-blind). Spider grounding uses raw Playwright methods it already prefers.

## Failure Modes

- Camoufox binary absent/unfetchable → fail-closed error at provider start with remediation message (no silent chromium fallback — that would mask the fingerprinting problem).
- Playwright capture misses ExtraInfo-equivalent header detail → accepted platform limitation, documented; bodies still captured via response.body().
- Provider mid-engagement switch → already hard-rejected by WorkflowStore (keep).
- ariaSnapshot unavailable (< Playwright 1.49) → version floor enforced in package.json.
- Silent no-op observers → replace silent guards with explicit capability reporting from provider.

## Tests

- resolveBrowserProvider returns CamoufoxProvider when configured (mock binary).
- Resume mismatch still rejects across either provider pair.
- Playwright capture produces HAR entries byte-compatible in shape with CDP builder fixtures (same builder — schema-level test).
- Tool-surface contract: 7 ids present, navigate records page, dialog evidence recorded natively.
- graph-bridge dispatches on result shape, not name (regression test).
- Eval fixtures updated: camofox now constructs (fake binary path), mismatch case preserved.
- Full suite + build green.

## Acceptance Criteria

- [ ] `ultimatrix.yaml` with `browser.provider: 'camofox'` runs interact end-to-end against a challenge-protected target without `stopReason:'error'`.
- [ ] HAR from a camoufox session flows into graph + replay store identically to stagehand sessions.
- [ ] Zero `requireStagehand()` reaches outside the StagehandProvider itself.
- [ ] Zero `stagehand_` strings in prompt/instruction prose.
- [ ] Existing stagehand behavior regression-free (default config unchanged).

## Dependencies

01 (brain) recommended first — small and independent. Spec 03's challenge-handling items overlap at task 8.
