/**
 * Dialog Evidence Injection — Wraps Stagehand tools to automatically
 * inject dialog evidence into every tool result.
 *
 * Root cause: CDP operations have side effects (native dialogs) that aren't
 * communicated back to the caller. The dialog watcher captures these events,
 * but Stagehand tool results don't include them. The agent has to manually
 * call getDialogEvidence and often forgets, leading to "ungrounded claims".
 *
 * This wrapper establishes a contract: every browser tool call returns both
 * its direct result AND any CDP-level side effects (dialogs). This is not
 * a bandaid — it's a missing abstraction in the agent's execution model.
 *
 * CdpConnection dispatches events by CDP method name:
 *   - Events WITH sessionId → session.dispatch(method, params)
 *   - Events WITHOUT sessionId → connection-level handlers
 * Page.javascriptDialogOpening always has a sessionId → goes to session only.
 * The dialog watcher registers session.on("Page.javascriptDialogOpening", handler).
 * This wrapper reads the watcher's stored events after each tool call.
 */

import { createStagehandTools } from '@mastra/stagehand'
import { getGlobalDialogWatcher, type DialogEvent } from './dialog-watcher'
import { log } from '../utils/logger'
import { getGlobalGraphStore } from '../graph/store'
import { isUrlInScope } from '../safety/scope-guard'
import { recordStructuredEvidence } from '../tools/control-tools'
import { getGlobalBotHandler } from './anti-bot'

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

/**
 * Wrap all Stagehand tools so every tool result includes dialog evidence.
 *
 * Before execution: snapshot dialog count from the watcher.
 * After execution: if new dialogs appeared, append evidence to the result.
 * The agent ALWAYS sees dialog evidence inline — no manual getDialogEvidence needed.
 */
export function wrapStagehandTools(browser: any): Record<string, any> {
  const raw = createStagehandTools(browser)
  const wrapped: Record<string, any> = {}

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

        const watcher = getGlobalDialogWatcher()
        const before = watcher.getDialogs().length

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

                // In headful mode, we can wait for auto-resolution or prompt user
                // In headless mode, just record and continue (the challenge may persist)
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

        const after = watcher.getDialogs().length
        if (after > before) {
          const newDialogs = watcher.getDialogs().slice(before)
          const evidence = buildDialogEvidence(newDialogs)
          log.info(`[dialog-inject] ${newDialogs.length} dialog(s) during ${name}: ${newDialogs.map(d => `[${d.type}] "${d.message}"`).join(', ')}`)

          // Structured evidence: a native dialog is hard proof of XSS/etc.
          for (const d of newDialogs) {
            recordStructuredEvidence({
              type: 'text',
              data: `[${d.type}] ${d.message}`,
              label: `dialog on ${d.url}`,
              observed: { url: d.url },
            })
          }

          if (result && typeof result === 'object') {
            return {
              ...result,
              dialogEvidence: evidence,
            }
          }
          return { success: false, dialogEvidence: evidence, rawResult: result }
        }

        return result
      },
    }
  }

  const toolCount = Object.keys(wrapped).length
  log.dim(`[dialog-inject] Wrapped ${toolCount} Stagehand tools with dialog evidence injection`)
  return wrapped
}
