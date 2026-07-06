/**
 * Reaction Tools — Mastra tools for the agent to query UI reactions
 *
 * These tools let the agent check what happened after a browser action:
 * - detectReactions: Get all reactions since the last action
 * - getDialogEvidence: Check for native dialog evidence (XSS proof)
 * - getRecentChanges: Get recent DOM changes in the last N seconds
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalReactionObserver } from '../browser/reaction-observer'
import { getGlobalDialogWatcher } from '../browser/dialog-watcher'

/**
 * Detect all UI reactions since the last agent action.
 * Returns modals, toasts, errors, success messages, text changes, and native dialogs.
 * The agent should call this after EVERY browser action to know what happened.
 */
export const detectReactions = createTool({
  id: 'detectReactions',
  description: 'Detect what happened in the browser after your last action. Shows modals, toasts, snackbars, error messages, success messages, notifications, content changes, and native dialogs (alert/confirm/prompt). Call this after every browser interaction to understand the result.',
  inputSchema: z.object({
    sinceSeconds: z.number().optional().describe('Only show reactions from the last N seconds. Default: last 10 seconds.'),
  }),
  execute: async ({ sinceSeconds }) => {
    const observer = getGlobalReactionObserver()
    const sinceMs = (sinceSeconds ?? 10) * 1000
    const reactions = observer.getRecentReactions(sinceMs)

    if (reactions.length === 0) {
      return {
        ok: true,
        value: {
          reactionCount: 0,
          summary: 'No UI reactions detected after the last action.',
          reactions: [],
        },
      }
    }

    const summary = observer.getReactionSummary()

    return {
      ok: true,
      value: {
        reactionCount: reactions.length,
        summary,
        reactions: reactions.map(r => ({
          type: r.type,
          content: r.content,
          visible: r.visible,
          timestamp: r.timestamp,
        })),
      },
    }
  },
})

/**
 * Check for native dialog evidence — specifically useful for XSS proof-of-concept.
 * Returns alert/confirm/prompt dialogs that were triggered and auto-dismissed.
 */
export const getDialogEvidence = createTool({
  id: 'getDialogEvidence',
  description: 'Check for browser-native dialog evidence (alert, confirm, prompt). Useful for proving XSS — if alert() fires, the XSS payload executed. Also detects custom confirm/prompt dialogs.',
  inputSchema: z.object({
    sinceSeconds: z.number().optional().describe('Only return dialogs from the last N seconds. Default: all.'),
  }),
  execute: async ({ sinceSeconds }) => {
    const watcher = getGlobalDialogWatcher()
    const sinceMs = sinceSeconds ? sinceSeconds * 1000 : undefined
    const dialogs = sinceMs ? watcher.getRecentDialogs(sinceMs) : watcher.getDialogs()

    if (dialogs.length === 0) {
      return {
        ok: true,
        value: {
          dialogCount: 0,
          hasXSS: false,
          summary: 'No native dialogs detected.',
          dialogs: [],
        },
      }
    }

    const hasXSS = watcher.hasXSSEvidence()
    const summary = watcher.getDialogSummary()

    return {
      ok: true,
      value: {
        dialogCount: dialogs.length,
        hasXSS,
        summary,
        dialogs: dialogs.map(d => ({
          type: d.type,
          message: d.message,
          url: d.url,
          timestamp: d.timestamp,
        })),
      },
    }
  },
})

/**
 * Get recent DOM changes — what changed on the page in the last N seconds.
 * Returns a diff of visible text, new elements, and navigation events.
 */
export const getRecentChanges = createTool({
  id: 'getRecentChanges',
  description: 'See what recently changed on the page — new text appeared, errors showed up, modals opened, or the page navigated. Good for understanding the effect of your last action.',
  inputSchema: z.object({
    sinceSeconds: z.number().optional().describe('How far back to look. Default: 15 seconds.'),
  }),
  execute: async ({ sinceSeconds }) => {
    const observer = getGlobalReactionObserver()
    const watcher = getGlobalDialogWatcher()
    const sinceMs = (sinceSeconds ?? 15) * 1000

    const reactions = observer.getRecentReactions(sinceMs)
    const dialogs = watcher.getRecentDialogs(sinceMs)

    const parts: string[] = []

    if (dialogs.length > 0) {
      parts.push(`Native dialogs: ${dialogs.map(d => `[${d.type}] "${d.message}"`).join(', ')}`)
    }

    const errors = reactions.filter(r => r.type === 'error')
    if (errors.length > 0) {
      parts.push(`Errors: ${errors.map(e => e.content).join('; ')}`)
    }

    const successes = reactions.filter(r => r.type === 'success')
    if (successes.length > 0) {
      parts.push(`Successes: ${successes.map(s => s.content).join('; ')}`)
    }

    const toasts = reactions.filter(r => r.type === 'toast' || r.type === 'snackbar')
    if (toasts.length > 0) {
      parts.push(`Toasts: ${toasts.map(t => t.content).join('; ')}`)
    }

    const modals = reactions.filter(r => r.type === 'modal')
    if (modals.length > 0) {
      parts.push(`Modals/overlays appeared: ${modals.length}`)
    }

    const textChanges = reactions.filter(r => r.type === 'text-change')
    if (textChanges.length > 0) {
      parts.push(`Content changed: ${textChanges.map(t => t.content.slice(0, 80)).join('; ')}`)
    }

    const navChanges = reactions.filter(r => r.type === 'new-element')
    if (navChanges.length > 0) {
      parts.push(navChanges.map(n => n.content).join('; '))
    }

    if (parts.length === 0) {
      return {
        ok: true,
        value: {
          hasChanges: false,
          summary: 'No significant changes detected on the page.',
        },
      }
    }

    return {
      ok: true,
      value: {
        hasChanges: true,
        summary: parts.join('\n'),
        reactionCount: reactions.length,
        dialogCount: dialogs.length,
      },
    }
  },
})

export const reactionTools = [detectReactions, getDialogEvidence, getRecentChanges]
