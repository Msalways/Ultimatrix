/**
 * Dialog Evidence Injection — Wraps Stagehand tools to automatically
 * inject dialog evidence + UI reaction detection into every tool result.
 *
 * Root cause: CDP operations have side effects (native dialogs) that aren't
 * communicated back to the caller. The JS interceptor captures these events,
 * but Stagehand tool results don't include them. The agent has to manually
 * call getDialogEvidence and often forgets, leading to "ungrounded claims".
 *
 * This wrapper establishes a contract: every browser tool call returns both
 * its direct result AND any CDP-level side effects (dialogs + UI reactions).
 *
 * The wrapper also:
 * - Reads intercepted dialogs from window.__ULTIMATRIX_DIALOGS__
 * - Records intercepted dialogs as human actions (for flow reproduction)
 * - Runs captureBaseline()/detectReaction() cycle for UI reaction detection
 */

import { getGlobalDialogWatcher, type DialogEvent } from './dialog-watcher'
import { getGlobalReactionObserver, type ReactionResult } from './reaction-observer'
import { log } from '../utils/logger'
import { getGlobalGraphStore } from '../graph/store'
import { isUrlInScope, enforceAction } from '../safety/scope-guard'
import { recordBrowserEffectEvidence } from '../tools/control-tools'
import { getGlobalBotHandler } from './anti-bot'
import { wireRenderTrace } from '../capture/render-bridge'
import { getGlobalObserver } from '../capture/human-observer'
import { getActivePage, resolveContextPageAsync } from './manager'
import { getEngagementServices } from '../runtime/engagement-context'
import { isCamofoxHandle } from './provider'
import { randomUUID } from 'node:crypto'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const STAGEHAND_TOOL_NAMES = [
  'stagehand_act',
  'stagehand_extract',
  'stagehand_observe',
  'stagehand_navigate',
  'stagehand_screenshot',
  'stagehand_tabs',
  'stagehand_close',
  'browserInteract',
]

type ObservedControl = {
  tag: string
  role?: string
  name?: string
  type?: string
  id?: string
  placeholder?: string
  inputName?: string
  locators: Array<{ kind: 'role' | 'label' | 'placeholder' | 'text' | 'css'; value: string; role?: string }>
}

const observedControls = new WeakMap<object, { url: string; controls: ObservedControl[] }>()

/** Read visible page structure without making a second model call. */
async function readPageDom(page: any, mode: 'observe' | 'extract', maxLength = 20_000): Promise<any> {
  // Stagehand v3 serializes evaluate callbacks with Function#toString and
  // runs them in the page. TSX/esbuild can inject a module-local `__name`
  // helper into that function, which does not exist in the page realm. Pass a
  // self-contained expression string so the browser receives plain JavaScript.
  const limit = Number.isFinite(maxLength) ? Math.max(500, Math.min(20_000, Math.floor(maxLength))) : 20_000
  const expression = `(() => {
    try {
      const limit = ${limit};
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const cssPath = (el) => {
        const parts = [];
        let current = el;
        while (current && current.nodeType === 1) {
          const id = current.id || '';
          if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) { parts.unshift('#' + id); break; }
          const tag = current.tagName.toLowerCase();
          const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName) : [];
          const index = siblings.indexOf(current);
          parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (index + 1) + ')' : ''));
          current = current.parentElement;
        }
        return parts.join(' > ');
      };
      const controls = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="searchbox"],[contenteditable="true"]'))
        .filter(visible).slice(0, 80).map((el) => {
          const input = el instanceof HTMLInputElement ? el : null;
          const labelElement = input?.labels?.[0] ?? (el instanceof HTMLTextAreaElement ? el.labels?.[0] : null);
          const aria = (el.getAttribute('aria-label') || '').trim();
          const label = (labelElement?.innerText || labelElement?.textContent || '').trim();
          const placeholder = input?.placeholder || (el instanceof HTMLTextAreaElement ? el.placeholder : '');
          const text = String(el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
          const id = el.id || '';
          const inputName = el.getAttribute('name') || '';
          const role = el.getAttribute('role') || (el instanceof HTMLAnchorElement ? 'link' : el instanceof HTMLButtonElement ? 'button' : input?.type === 'search' ? 'searchbox' : input || el instanceof HTMLTextAreaElement ? 'textbox' : undefined);
          const accessibleName = aria || label || placeholder || text;
          const locators = [];
          if (role && accessibleName) locators.push({ kind: 'role', role, value: accessibleName });
          if (label) locators.push({ kind: 'label', value: label });
          if (placeholder) locators.push({ kind: 'placeholder', value: placeholder });
          if (text && (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.getAttribute('role') === 'button')) locators.push({ kind: 'text', value: text });
          const observedCssPath = cssPath(el);
          if (observedCssPath) locators.push({ kind: 'css', value: observedCssPath });
          if (inputName) locators.push({ kind: 'css', value: el.tagName.toLowerCase() + '[name=' + JSON.stringify(inputName) + ']' });
          return { tag: el.tagName.toLowerCase(), role, name: accessibleName || undefined, type: input?.type, id: id || undefined, placeholder: placeholder || undefined, inputName: inputName || undefined, locators };
        });
      const bodyText = (document.body?.innerText || '').slice(0, limit);
      return { title: document.title, text: bodyText, textLength: document.body?.innerText?.length ?? 0, controls,
        links: Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0, 100).map((a) => a.href) };
    } catch (error) {
      return { __error: String(error) };
    }
  })()`
  const snapshot = await page.evaluate(expression)
  if (snapshot?.__error) throw new Error(`DOM snapshot failed: ${String(snapshot.__error).slice(0, 200)}`)
  const url = String(page.url?.() ?? '')
  const controls = Array.isArray(snapshot?.controls) ? snapshot.controls as ObservedControl[] : []
  observedControls.set(page, { url, controls })
  const common = {
    success: true,
    source: 'live-dom',
    url,
    title: String(snapshot?.title ?? ''),
    controls,
    links: Array.isArray(snapshot?.links) ? snapshot.links : [],
    truncated: Number(snapshot?.textLength ?? 0) > String(snapshot?.text ?? '').length,
    textLength: Number(snapshot?.textLength ?? 0),
  }
  return mode === 'observe'
    ? { ...common, text: String(snapshot?.text ?? '').slice(0, 5000) }
    : { ...common, text: String(snapshot?.text ?? '').slice(0, maxLength) }
}

function buildBrowserInteractTool(browser: any): any {
  return createTool({
    id: 'browserInteract',
    description: 'Perform one deterministic click, fill, or key press on exactly one visible control described by the latest page inspection. Use its exact locator (role, label, placeholder, text, or CSS). Fill and press are separate actions; inspect the page again after each action.',
    inputSchema: z.object({
      action: z.enum(['click', 'fill', 'press']),
      locator: z.object({
        kind: z.enum(['role', 'label', 'placeholder', 'text', 'css']),
        value: z.string().min(1).max(200),
        role: z.string().max(40).optional(),
      }),
      value: z.string().max(512).optional().describe('Required for fill; the exact text to enter.'),
      timeoutMs: z.number().int().positive().max(8000).default(5000),
    }),
    execute: async (input: any, context: any) => {
      const page = context?.page ?? await resolvePage(browser, context)
      if (!page) return { success: false, error: 'No active browser page available for this provider' }
      const currentUrl = String(page.url?.() ?? '')
      const observation = observedControls.get(page)
      if (!observation || observation.url !== currentUrl) {
        return { success: false, error: 'Observe the current page immediately before acting; no current DOM observation is available.' }
      }
      const locator = input.locator
      const match = observation.controls.some((control) => control.locators.some((item) =>
        item.kind === locator.kind && item.value === locator.value && (item.role ?? '') === (locator.role ?? ''),
      ))
      if (!match) return { success: false, error: 'The requested locator was not present in the latest visible-control observation.' }
      if (input.action === 'fill' && typeof input.value !== 'string') return { success: false, error: 'fill requires a value.' }
      if (input.action === 'press' && input.value !== undefined && !['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Space'].includes(input.value)) {
        return { success: false, error: 'press accepts only Enter, Tab, Escape, ArrowDown, ArrowUp, Home, End, or Space.' }
      }
      const observed = observation.controls.find((control) => control.locators.some((item) =>
        item.kind === locator.kind && item.value === locator.value && (item.role ?? '') === (locator.role ?? ''),
      ))
      if (input.action === 'fill' && (!observed || !['input', 'textarea'].includes(observed.tag) || ['password', 'hidden', 'file'].includes(String(observed.type ?? '')))) {
        return { success: false, error: 'fill is limited to observed, non-sensitive text inputs and textareas.' }
      }
      let target: any
      try {
        const observedCssPath = observed?.locators.find((item) => item.kind === 'css')?.value
        if (observedCssPath && typeof page.locator === 'function') {
          // Stagehand v3 exposes a Playwright-like `locator()` API but not
          // Playwright's `getByRole`/`getByText` helpers. Resolve the exact
          // element captured in the DOM inventory, regardless of provider.
          target = page.locator(observedCssPath)
        } else {
          switch (locator.kind) {
            case 'role': target = page.getByRole(locator.role, { name: locator.value, exact: true }); break
            case 'label': target = page.getByLabel(locator.value, { exact: true }); break
            case 'placeholder': target = page.getByPlaceholder(locator.value, { exact: true }); break
            case 'text': target = page.getByText(locator.value, { exact: true }); break
            case 'css': target = page.locator(locator.value); break
          }
        }
        const count = await target.count()
        if (count !== 1) return { success: false, error: `Observed locator must resolve to exactly one element; found ${count}.` }
        if (!await target.isVisible()) return { success: false, error: 'Observed element is no longer visible; observe the page again.' }
        if (input.action === 'click') await target.click({ timeout: input.timeoutMs })
        else if (input.action === 'fill') await target.fill(input.value, { timeout: input.timeoutMs })
        else if (typeof target.press === 'function') await target.press(input.value || 'Enter', { timeout: input.timeoutMs })
        else if (typeof page.keyboard?.press === 'function') await page.keyboard.press(input.value || 'Enter')
        else if (typeof page.mainSession?.send === 'function') {
          const key = input.value || 'Enter'
          const keyCode: Record<string, { key: string; code: string; windowsVirtualKeyCode: number; text?: string }> = {
            Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
            Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
            Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
            ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
            ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
            Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
            End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
            Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
          }
          const descriptor = keyCode[key]
          if (!descriptor) return { success: false, error: 'This browser provider cannot press the requested key.' }
          await target.click()
          await page.mainSession.send('Input.dispatchKeyEvent', { type: 'keyDown', ...descriptor })
          await page.mainSession.send('Input.dispatchKeyEvent', { type: 'keyUp', ...descriptor, text: undefined })
        } else return { success: false, error: 'This browser provider does not expose keyboard input.' }
        observedControls.delete(page)
        return {
          success: true,
          action: input.action,
          locator: { kind: locator.kind, value: locator.value, ...(locator.role ? { role: locator.role } : {}) },
          ...(input.action === 'fill' ? { valueLength: input.value.length } : input.action === 'press' ? { key: input.value || 'Enter' } : {}),
          url: String(page.url?.() ?? currentUrl),
        }
      } catch (error) {
        observedControls.delete(page)
        return { success: false, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }
      }
    },
  })
}

/**
 * Resolve the page owned by the wrapped provider. Mastra's tool execution
 * context carries `agent`, not a browser `page`; relying on context.page made
 * every page-derived safety/evidence branch silently disappear in normal
 * solver calls.
 */
/**
 * Resolve the page a browser tool should act on.
 *
 * Two defects lived here, both invisible because a failed lookup is
 * indistinguishable from a working one until a tool refuses to run.
 *
 * 1. `context.activePage()` is ASYNC. Calling it and returning the result handed
 *    back an unresolved Promise — truthy, so it passed every downstream check as
 *    "a page", and the tool failed on it much later.
 * 2. The `return` sat INSIDE the try block, so when the handle exposed no
 *    requireStagehand this function returned undefined immediately and the
 *    await getActivePage() fallback below was unreachable. `return` does not throw, so
 *    the catch never fired. That is why every stagehand_* tool answered "No
 *    active browser page available for this provider" on live runs where a page
 *    demonstrably existed — verified on OWASP Juice Shop 2026-09-29.
 */
async function resolvePage(browser: any, context: any): Promise<any> {
  if (context?.page) return context.page
  if (isCamofoxHandle(browser)) return browser.page
  if (process.env.ULTIMATRIX_BROWSER_TRACE) {
    console.log('[bt-resolvePage] ' + JSON.stringify({
      browser: !!browser,
      browserCtor: browser?.constructor?.name,
      hasRequireStagehand: typeof browser?.requireStagehand,
    }))
  }
  try {
    const stagehand = browser?.requireStagehand?.()
    if (process.env.ULTIMATRIX_BROWSER_TRACE) {
      const ctx: any = stagehand?.context
      let rawActive = 'n/a'
      let rawPages = 'n/a'
      try { rawActive = JSON.stringify(await ctx?.activePage?.()) ?? 'undefined' } catch (e) { rawActive = 'THREW ' + (e as Error).message.slice(0, 60) }
      try { const p = await ctx?.pages?.(); rawPages = Array.isArray(p) ? 'array[' + p.length + ']' : typeof p } catch (e) { rawPages = 'THREW ' + (e as Error).message.slice(0, 60) }
      const direct = await resolveContextPageAsync(ctx)
      console.log('[bt-resolvePage]   raw activePage=' + String(rawActive).slice(0, 60) + '  pages=' + rawPages +
        '  resolverSameScope=' + (direct ? 'PAGE' : 'null') + '  ctxIdentity=' + (ctx === (browser as any)?.requireStagehand?.()?.context))
    }
    const fromContext = await resolveContextPageAsync(stagehand?.context)
    if (process.env.ULTIMATRIX_BROWSER_TRACE) {
      console.log('[bt-resolvePage]   fromContext=' + (fromContext ? 'PAGE' : 'null'))
    }
    if (fromContext) return fromContext
  } catch (error) {
    if (process.env.ULTIMATRIX_BROWSER_TRACE) {
      console.log('[bt-resolvePage]   context path threw: ' + String((error as Error)?.message ?? error).slice(0, 120))
    }
  }
  try {
    const fallback = await getActivePage()
    if (process.env.ULTIMATRIX_BROWSER_TRACE) {
      console.log('[bt-resolvePage]   manager fallback=' + (fallback ? 'PAGE' : 'null'))
    }
    return fallback
  } catch {
    return undefined
  }
}

function getToolNamesForBrowser(_browser: any): string[] {
  // Both providers intentionally expose the same stagehand_* vocabulary.
  return STAGEHAND_TOOL_NAMES
}

function getCloseToolName(_browser: any): string {
  return 'stagehand_close'
}

function getNavigateToolName(_browser: any): string {
  // Camoufox deliberately keeps the Stagehand tool ids for provider parity.
  return 'stagehand_navigate'
}

function buildDialogEvidence(newDialogs: DialogEvent[]): string {
  if (newDialogs.length === 0) return ''
  const lines = newDialogs.map(d =>
    `  [${d.type}] "${d.message}" on ${d.url}`
  )
  return `Native dialog(s) fired during this action:\n${lines.join('\n')}`
}

function buildReactionEvidence(reactionResult: ReactionResult): string {
  if (!reactionResult.hasChanges || !reactionResult.summary) return ''
  return `UI reaction(s) after this action:\n${reactionResult.summary}`
}

/**
 * Wrap browser tools (Stagehand or Camoufox) so every tool result includes dialog evidence
 * and UI reaction detection.
 *
 * Before execution: snapshot dialog count + capture reaction baseline.
 * After execution: read intercepted dialogs, detect UI reactions, append evidence.
 */
export function wrapStagehandTools(browser: any, captureFlush?: () => Promise<unknown>): Record<string, any> {
  const passiveObserver = getEngagementServices()?.passiveObserver
  const flushCapturedRequests = captureFlush ?? passiveObserver?.flushCapturedRequests?.bind(passiveObserver)
  // Use the browser's configured toolset so lifecycle-sensitive exclusions
  // (notably close for the shared session) cannot be reintroduced.
  const raw = { ...(browser.getTools() as Record<string, any>) }
  // Stagehand's observe/extract and act operations make secondary LLM calls.
  // Keep those optional: DOM facts and simple visible-control actions can be
  // gathered deterministically from the already-authorized Playwright page.
  if (!raw.browserInteract) raw.browserInteract = buildBrowserInteractTool(browser)
  const wrapped: Record<string, any> = {}
  const watcher = getGlobalDialogWatcher()
  const reactionObserver = getGlobalReactionObserver()

  const toolNames = getToolNamesForBrowser(browser)
  const closeToolName = getCloseToolName(browser)
  const navigateToolName = getNavigateToolName(browser)

  for (const [name, tool] of Object.entries(raw)) {
    if (name === closeToolName) continue
    if (!toolNames.includes(name)) {
      wrapped[name] = tool
      continue
    }

    const originalExecute = (tool as any).execute
    if (typeof originalExecute !== 'function') {
      wrapped[name] = tool
      continue
    }

    wrapped[name] = {
      ...tool,
      execute: async (input: any, context: any) => {
        const actionId = randomUUID()
        const correlationToken = `browser:${actionId}`
        const actor = typeof input?.actor === 'string'
          ? input.actor
          : typeof context?.actor === 'string' ? context.actor : undefined
        const evidenceIds: string[] = []
        const recordActionEffect = (input: Parameters<typeof recordBrowserEffectEvidence>[0]) =>
          recordBrowserEffectEvidence({ ...input, executionId: input.executionId ?? actionId, ...(actor ? { session: actor } : {}) })
        const page = await resolvePage(browser, context)
        const pageUrl = () => {
          try { return String(page?.url?.() ?? '') } catch { return '' }
        }
        if (!page) {
          return { success: false, error: 'No active browser page available for this provider' }
        }
        try {
          enforceAction('browser_action', { toolId: name })
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) }
        }

        // Scope guard for browser navigation (explicit target URL)
        if (name === navigateToolName && input?.url) {
          const scopeCheck = isUrlInScope(input.url)
          if (!scopeCheck.allowed) {
            return { success: false, error: `Scope violation: ${scopeCheck.reason}` }
          }
        }

        // Scope guard for every other browser action: must stay on a scoped page.
        if (name !== navigateToolName) {
          const currentUrl = pageUrl()
          if (currentUrl && currentUrl !== 'about:blank' && currentUrl !== '') {
            const pageScope = isUrlInScope(currentUrl)
            if (!pageScope.allowed) {
              return { success: false, error: `Scope violation: ${pageScope.reason}` }
            }
          }
        }

        const before = watcher.getDialogs().length
        const readOnlyInspection = name === 'stagehand_observe'
          || name === 'stagehand_extract'
          || name === 'stagehand_screenshot'

        // Read-only inspection cannot create UI reactions. Stagehand's
        // accessibility snapshot can also hang on a live page, so keep these
        // tools on their deterministic DOM path without reaction snapshots.
        if (!readOnlyInspection) {
          try { await reactionObserver.captureBaseline() } catch {}
        }

        // Pass the provider page into the tool context. Mastra normally gives
        // tools only `{ agent }`; Stagehand/Camoufox tools themselves still
        // receive their normal context fields.
        const toolContext = { ...(context && typeof context === 'object' ? context : {}), page }
        let result: any
        try {
          if (name === 'stagehand_observe') {
            result = await readPageDom(page, 'observe')
          } else if (name === 'stagehand_extract') {
            result = await readPageDom(page, 'extract', Math.max(500, Math.min(20_000, Number(input?.maxLength) || 20_000)))
          } else {
            result = await originalExecute(input, toolContext)
          }
        } catch (error) {
          result = { success: false, error: error instanceof Error ? error.message : String(error) }
        }

        if (result?.success === false) {
          const message = String(result.error ?? result.message ?? 'provider returned success=false')
            .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/\b(?:api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/gi, '[credential redacted]')
            .slice(0, 240)
          log.warn(`[dialog-inject] ${name} failed on ${pageUrl() || 'unknown page'}: ${message}`)
        }

        if (name !== 'stagehand_observe' && name !== 'stagehand_extract') {
          // Any action, navigation, tab switch, or explicit control may make
          // the prior locator inventory stale.
          observedControls.delete(page)
        }

        if ((name === 'stagehand_observe' || name === 'stagehand_extract') && result?.success) {
          const controls = Array.isArray(result.controls) ? result.controls as ObservedControl[] : []
          const summary = controls.slice(0, 16).map((control) => ({
            tag: control.tag,
            role: control.role,
            name: control.name,
            type: control.type,
            locators: control.locators.slice(0, 3),
          }))
          const effect = recordActionEffect({
            data: `observed ${controls.length} visible controls from the live DOM`,
            label: `${name} live DOM snapshot`,
            url: pageUrl(),
            effects: { source: 'live-dom', controlCount: String(controls.length), controls: JSON.stringify(summary) },
            correlationToken,
          })
          evidenceIds.push(effect.id)
        }

        if (name === 'browserInteract' && result?.success) {
          const effect = recordActionEffect({
            data: `browser ${String(result.action)} on an observed visible control`,
            label: `browser control ${String(result.action)}`,
            url: String(result.url ?? pageUrl()),
            effects: {
              action: String(result.action),
              locatorKind: String(result.locator?.kind ?? ''),
              locator: String(result.locator?.value ?? '').slice(0, 120),
              ...(typeof result.valueLength === 'number' ? { valueLength: String(result.valueLength) } : {}),
              ...(typeof result.key === 'string' ? { key: result.key } : {}),
            },
            correlationToken,
          })
          evidenceIds.push(effect.id)
        }

        // Browser transport policy counts each actual HTTP request. Flush the
        // shared HAR capture after the action so newly observed UI inputs are
        // available to the planner in this turn; charging the action itself as
        // another request double-counted browser traffic and spent the budget.
        try {
          await flushCapturedRequests?.()
        } catch (error) {
          log.dim(`[dialog-inject] Browser capture flush failed: ${error instanceof Error ? error.message : String(error)}`)
        }

         // Auto-record page after navigation
         if (name === navigateToolName && result?.success) {
           let navigationEvidenceRecorded = false
           try {
             const currentUrl = pageUrl()
             if (currentUrl) {
               const store = getGlobalGraphStore()
               // Wrap in transaction if store supports it
               if ('beginTransaction' in store && typeof store.beginTransaction === 'function') {
                 await store.beginTransaction().then(async () => {
                   try {
                     if ('mergePage' in store && typeof store.mergePage === 'function') {
                       store.mergePage(currentUrl, {
                         title: typeof page.title === 'function' ? await page.title() : '',
                         contentType: 'text/html',
                         contentLength: 0,
                         timestamp: Date.now(),
                         sessionId: context?.agent?.threadId ?? context?.sessionId,
                       })
                     }
                     await (store as any).commitTransaction()
                   } catch (error) {
                     await (store as any).rollbackTransaction()
                     throw error
                   }
                 })
               } else if ('mergePage' in store && typeof store.mergePage === 'function') {
                 // GraphStore - no transaction support
                 store.mergePage(currentUrl, {
                   title: typeof page.title === 'function' ? await page.title() : '',
                   contentType: 'text/html',
                   contentLength: 0,
                   timestamp: Date.now(),
                   sessionId: context?.agent?.threadId ?? context?.sessionId,
                 })
               }
               log.dim(`[dialog-inject] Auto-recorded page: ${currentUrl}`)
               // Render-trace every browser navigation response.
               wireRenderTrace(page)
               // Runtime-produced browser evidence is correlated and typed.
               const navigationEvidence = recordActionEffect({
                 data: `navigated to ${currentUrl}`,
                 label: `navigate ${currentUrl}`,
                 url: currentUrl,
                 effects: { pageUrl: currentUrl, navigation: 'true' },
                 correlationToken,
               })
               evidenceIds.push(navigationEvidence.id)
                navigationEvidenceRecorded = true

               // Bot detection after navigation
               const botHandler = getGlobalBotHandler()
               const challenge = await botHandler.detectChallenge(page)
               if (challenge.detected) {
                 log.info(`[dialog-inject] Bot challenge detected: ${challenge.vendor} ${challenge.challengeType}`)
                 const challengeEvidence = recordActionEffect({
                   data: `Bot challenge: ${challenge.vendor} ${challenge.challengeType} on ${challenge.url}`,
                   label: `bot-challenge ${challenge.vendor}`,
                   url: challenge.url,
                   effects: { botChallenge: challenge.vendor, botChallengeType: challenge.challengeType },
                   correlationToken,
                 })
                 evidenceIds.push(challengeEvidence.id)

                 const resolved = await botHandler.waitForResolution(page, 10_000)
                 if (resolved) {
                   log.info(`[dialog-inject] Bot challenge resolved automatically`)
                   const resolvedEvidence = recordActionEffect({
                     data: `Bot challenge resolved: ${challenge.vendor} ${challenge.challengeType}`,
                     label: `bot-resolved ${challenge.vendor}`,
                     url: challenge.url,
                     effects: { botChallengeResolved: 'true', botChallenge: challenge.vendor },
                     correlationToken,
                   })
                   evidenceIds.push(resolvedEvidence.id)
                 } else {
                   log.dim(`[dialog-inject] Bot challenge not resolved — human intervention may be needed`)
                 }
               }
             }
           } catch (error) {
             // Graph persistence is best effort. The typed browser effect is
             // still required even when the workspace is not initialized.
             if (!navigationEvidenceRecorded) {
               const currentUrl = pageUrl()
               if (currentUrl) {
                 const navigationEvidence = recordActionEffect({
                   data: `navigated to ${currentUrl}`,
                   label: `navigate ${currentUrl}`,
                   url: currentUrl,
                   effects: { pageUrl: currentUrl, navigation: 'true' },
                   correlationToken,
                 })
                 evidenceIds.push(navigationEvidence.id)
               }
             }
             log.dim(`[dialog-inject] Auto-page-record failed: ${error}`)
           }
         }

        // Read intercepted dialogs from JS interceptor
        let newDialogs: DialogEvent[] = []
        if (page && !readOnlyInspection) {
          try {
            newDialogs = await watcher.readInterceptedDialogs(page)
          } catch {}
        }

        // Also check watcher's legacy count (in case any CDP events still fire)
        const after = watcher.getDialogs().length
        if (after > before && newDialogs.length === 0) {
          newDialogs = watcher.getDialogs().slice(before)
        }

        // Record intercepted dialogs as human actions (for flow reproduction)
        if (newDialogs.length > 0) {
          const humanObserver = getGlobalObserver()
          for (const d of newDialogs) {
            humanObserver.record({
              type: 'click',
              selector: `dialog:${d.type}`,
              value: d.message,
              url: d.url,
              timestamp: d.timestamp,
              metadata: { dialogType: d.type, intercepted: true },
            })
          }
        }

        // Detect UI reactions (modals, toasts, errors, etc.)
        let reactionResult: ReactionResult | null = null
        if (!readOnlyInspection) {
          try {
            reactionResult = await reactionObserver.detectReaction()
          } catch {}
        }

        // Build evidence strings
        const dialogEvidence = buildDialogEvidence(newDialogs)
        const reactionEvidence = buildReactionEvidence(reactionResult ?? { reactions: [], hasChanges: false, summary: '', baseline: null, current: null })

        // Log and record runtime-produced browser effects
        if (newDialogs.length > 0) {
          log.info(`[dialog-inject] ${newDialogs.length} dialog(s) during ${name}: ${newDialogs.map(d => `[${d.type}] "${d.message}"`).join(', ')}`)
          for (const d of newDialogs) {
            const effect = recordActionEffect({
              data: `[${d.type}] ${d.message}`,
              label: `dialog on ${d.url}`,
              url: d.url,
              effects: {
                nativeDialogType: d.type,
                nativeDialogMessage: d.message,
                nativeDialogUrl: d.url,
              },
              correlationToken,
            })
            evidenceIds.push(effect.id)
          }
        }

        if (reactionResult?.hasChanges) {
          log.info(`[dialog-inject] UI reaction during ${name}: ${reactionResult.summary}`)
          const effects: Record<string, string> = {
            reactionCount: String(reactionResult.reactions.length),
            reactionSummary: reactionResult.summary,
          }
          reactionResult.reactions.forEach((reaction, index) => {
            effects[`reaction:${index}:type`] = reaction.type
            effects[`reaction:${index}:content`] = reaction.content
          })
          const effect = recordActionEffect({
            data: reactionResult.summary || 'browser UI state changed',
            label: `reaction during ${name}`,
            url: pageUrl(),
            effects,
            correlationToken,
          })
          evidenceIds.push(effect.id)
        }

        // Merge evidence into result
        if (result && typeof result === 'object') {
          return {
            ...result,
            browserAction: { actionId, correlationToken, pageUrl: pageUrl(), evidenceIds, ...(actor ? { actor } : {}) },
            ...(dialogEvidence ? { dialogEvidence } : {}),
            ...(reactionEvidence ? { reactionEvidence } : {}),
          }
        }

        return {
          success: false,
          error: 'Browser tool returned no structured result',
          rawResult: result,
          browserAction: { actionId, correlationToken, pageUrl: pageUrl(), evidenceIds, ...(actor ? { actor } : {}) },
          ...(dialogEvidence ? { dialogEvidence } : {}),
          ...(reactionEvidence ? { reactionEvidence } : {}),
        }
      },
    }
  }

  const toolCount = Object.keys(wrapped).length
  log.dim(`[dialog-inject] Wrapped ${toolCount} Stagehand tools with dialog + reaction injection`)
  return wrapped
}
