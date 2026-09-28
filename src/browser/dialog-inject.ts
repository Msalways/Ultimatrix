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
import { getActivePage } from './manager'
import { getTargetTransportGovernor } from '../runtime/target-governor'
import { isCamofoxHandle } from './provider'
import { randomUUID } from 'node:crypto'

const STAGEHAND_TOOL_NAMES = [
  'stagehand_act',
  'stagehand_extract',
  'stagehand_observe',
  'stagehand_navigate',
  'stagehand_screenshot',
  'stagehand_tabs',
  'stagehand_close',
]

/**
 * Resolve the page owned by the wrapped provider. Mastra's tool execution
 * context carries `agent`, not a browser `page`; relying on context.page made
 * every page-derived safety/evidence branch silently disappear in normal
 * solver calls.
 */
function resolvePage(browser: any, context: any): any {
  if (context?.page) return context.page
  if (isCamofoxHandle(browser)) return browser.page
  try {
    const stagehand = browser?.requireStagehand?.()
    const active = stagehand?.context?.activePage
    const activePage = typeof active === 'function' ? active() : active
    return activePage
      ?? (Array.isArray(stagehand?.context?.pages) ? stagehand.context.pages[0] : undefined)
      ?? stagehand?.context?.pages?.[0]
  } catch {
    // Fall through to the engagement-scoped manager for legacy handles.
  }
  try {
    return getActivePage()
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
export function wrapStagehandTools(browser: any): Record<string, any> {
  // Use the browser's configured toolset so lifecycle-sensitive exclusions
  // (notably close for the shared session) cannot be reintroduced.
  const raw = browser.getTools() as Record<string, any>
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
        const page = resolvePage(browser, context)
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

        // Capture reaction baseline BEFORE tool execution
        try { await reactionObserver.captureBaseline() } catch {}

        // Pass the provider page into the tool context. Mastra normally gives
        // tools only `{ agent }`; Stagehand/Camoufox tools themselves still
        // receive their normal context fields.
        const toolContext = { ...(context && typeof context === 'object' ? context : {}), page }
        let result: any
        const governorUrl = name === navigateToolName && typeof input?.url === 'string' ? input.url : pageUrl()
        const releaseTargetSlot = await getTargetTransportGovernor().acquire(governorUrl || 'about:blank')
        try {
          result = await originalExecute(input, toolContext)
        } catch (error) {
          result = { success: false, error: error instanceof Error ? error.message : String(error) }
        } finally {
          releaseTargetSlot()
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
        if (page) {
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
        try {
          reactionResult = await reactionObserver.detectReaction()
        } catch {}

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
