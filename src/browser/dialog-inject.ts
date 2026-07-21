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

import { createStagehandTools } from '@mastra/stagehand'
import { getGlobalDialogWatcher, type DialogEvent } from './dialog-watcher'
import { getGlobalReactionObserver, type ReactionResult } from './reaction-observer'
import { log } from '../utils/logger'
import { getGlobalGraphStore } from '../graph/store'
import { isUrlInScope } from '../safety/scope-guard'
import { recordStructuredEvidence } from '../tools/control-tools'
import { getGlobalBotHandler } from './anti-bot'
import { wireRenderTrace } from '../capture/render-bridge'
import { getGlobalObserver } from '../capture/human-observer'

const STAGEHAND_TOOL_NAMES = [
  'stagehand_act',
  'stagehand_extract',
  'stagehand_observe',
  'stagehand_navigate',
  'stagehand_screenshot',
  'stagehand_tabs',
  'stagehand_close',
]

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
 * Wrap all Stagehand tools so every tool result includes dialog evidence
 * and UI reaction detection.
 *
 * Before execution: snapshot dialog count + capture reaction baseline.
 * After execution: read intercepted dialogs, detect UI reactions, append evidence.
 */
export function wrapStagehandTools(browser: any): Record<string, any> {
  const raw = createStagehandTools(browser)
  const wrapped: Record<string, any> = {}
  const watcher = getGlobalDialogWatcher()
  const reactionObserver = getGlobalReactionObserver()

  for (const [name, tool] of Object.entries(raw)) {
    if (!STAGEHAND_TOOL_NAMES.includes(name)) {
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
        // Scope guard for browser navigation (explicit target URL)
        if (name === 'stagehand_navigate' && input?.url) {
          const scopeCheck = isUrlInScope(input.url)
          if (!scopeCheck.allowed) {
            return { success: false, error: `Scope violation: ${scopeCheck.reason}` }
          }
        }

        // Scope guard for every other browser action: must stay on a scoped page.
        if (name !== 'stagehand_navigate') {
          const page = context?.page
          const pageUrl = page?.url?.()
          if (pageUrl && pageUrl !== 'about:blank' && pageUrl !== '') {
            const pageScope = isUrlInScope(pageUrl)
            if (!pageScope.allowed) {
              return { success: false, error: `Scope violation: ${pageScope.reason}` }
            }
          }
        }

        const before = watcher.getDialogs().length

        // Capture reaction baseline BEFORE tool execution
        try { await reactionObserver.captureBaseline() } catch {}

        const result = await originalExecute(input, context)

        // Auto-record page after navigation
        if (name === 'stagehand_navigate' && result && result.success) {
          try {
            const page = context?.page
            if (page) {
              const store = getGlobalGraphStore()
              store.upsertPage(page.url(), {
                title: await page.title(),
                contentType: 'text/html',
                contentLength: 0,
                timestamp: Date.now(),
                sessionId: context?.sessionId,
              })
              log.dim(`[dialog-inject] Auto-recorded page: ${page.url()}`)
              // Render-trace every crawled HTML response
              wireRenderTrace(page)
              // Structured evidence that this URL was actually visited.
              recordStructuredEvidence({
                type: 'text',
                data: `navigated to ${page.url()}`,
                label: `navigate ${page.url()}`,
                observed: { url: page.url() },
              })

              // Bot detection after navigation
              const botHandler = getGlobalBotHandler()
              const challenge = await botHandler.detectChallenge(page)
              if (challenge.detected) {
                log.info(`[dialog-inject] Bot challenge detected: ${challenge.vendor} ${challenge.challengeType}`)
                recordStructuredEvidence({
                  type: 'text',
                  data: `Bot challenge: ${challenge.vendor} ${challenge.challengeType} on ${challenge.url}`,
                  label: `bot-challenge ${challenge.vendor}`,
                  observed: { url: challenge.url },
                })

                const resolved = await botHandler.waitForResolution(page, 10_000)
                if (resolved) {
                  log.info(`[dialog-inject] Bot challenge resolved automatically`)
                  recordStructuredEvidence({
                    type: 'text',
                    data: `Bot challenge resolved: ${challenge.vendor} ${challenge.challengeType}`,
                    label: `bot-resolved ${challenge.vendor}`,
                    observed: { url: challenge.url },
                  })
                } else {
                  log.dim(`[dialog-inject] Bot challenge not resolved — human intervention may be needed`)
                }
              }
            }
          } catch (error) {
            log.dim(`[dialog-inject] Auto-page-record failed: ${error}`)
          }
        }

        // Read intercepted dialogs from JS interceptor
        const page = context?.page
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

        // Log and record structured evidence
        if (newDialogs.length > 0) {
          log.info(`[dialog-inject] ${newDialogs.length} dialog(s) during ${name}: ${newDialogs.map(d => `[${d.type}] "${d.message}"`).join(', ')}`)
          for (const d of newDialogs) {
            recordStructuredEvidence({
              type: 'text',
              data: `[${d.type}] ${d.message}`,
              label: `dialog on ${d.url}`,
              observed: { url: d.url },
            })
          }
        }

        if (reactionResult?.hasChanges) {
          log.info(`[dialog-inject] UI reaction during ${name}: ${reactionResult.summary}`)
        }

        // Merge evidence into result
        if ((dialogEvidence || reactionEvidence) && result && typeof result === 'object') {
          return {
            ...result,
            ...(dialogEvidence ? { dialogEvidence } : {}),
            ...(reactionEvidence ? { reactionEvidence } : {}),
          }
        }

        if (dialogEvidence || reactionEvidence) {
          return { success: false, dialogEvidence, reactionEvidence, rawResult: result }
        }

        return result
      },
    }
  }

  const toolCount = Object.keys(wrapped).length
  log.dim(`[dialog-inject] Wrapped ${toolCount} Stagehand tools with dialog + reaction injection`)
  return wrapped
}
