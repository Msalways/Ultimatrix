import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import { getEngagementServices } from '../runtime/engagement-context'
import { buildRuntimeEnvelope, type RuntimeAlert } from '../runtime/context-envelope'
import { getCapturedRequestStore } from '../capture/captured-request-store'
import { CrossEngagementMemory } from '../intelligence/cross-engagement'
import { ContextWindowRegistry } from '../models/context-window-registry'
import { loadRelevantHints } from '../intelligence/reflexion-store'

/**
 * Single tool that provides all session context in one call:
 * - Graph summary (endpoints, findings, auth flows)
 * - Workflow state (tasks, artifacts, approvals)
 * - Blackboard facts and plan
 * - Alerts (stale execution, unsupported claims)
 * - Cross-engagement priors
 * - Recent discoveries (new endpoints, findings)
 * - Captured request count
 * - Reflexion hints from prior sessions
 *
 * The brain calls this once per turn instead of making 5-6 separate tool calls.
 */
export const getSessionContext = createTool({
  id: 'getSessionContext',
  description: 'Get the full session context: graph state, workflow status, alerts, cross-engagement priors, and recent discoveries. Call this once per turn to understand the current state.',
  inputSchema: z.object({}),
  execute: async () => {
    const services = getEngagementServices()
    const graph = services?.graph ?? getGlobalGraphStore()

    // F6 FIX: Return real target from graph store, not hardcoded empty string.
    const target = graph?.getTargetSummary()?.targetOrigin ?? ''

    // F6 FIX: Return real context window from registry, not hardcoded 128k.
    const config = services?.config ?? {}
    const registry = new ContextWindowRegistry(config as any)
    const modelId = (config as any).model ?? ''
    const contextWindow = registry.getContextWindow(modelId) || 32_000

    // Build alerts
    const alerts: RuntimeAlert[] = []
    const unsupported = services?.findingState?.evidenceGate?.getUnsupportedClaims?.() ?? []
    if (unsupported.length) {
      alerts.push({ type: 'unsupported-claims', count: unsupported.length })
    }

    // F6 FIX: Return real blackboard facts from engagement services if available.
    const factStrings: string[] = []
    const recentFacts: string[] = []
    try {
      const blackboard = services?.blackboard
      if (blackboard?.facts) {
        for (const fact of blackboard.facts) {
          factStrings.push(`${fact.intent}: ${fact.content}`)
        }
        recentFacts.push(...factStrings.slice(-5))
      }
    } catch { /* ignore */ }

    // Captured requests
    let capturedRequestTotal = 0
    try {
      capturedRequestTotal = getCapturedRequestStore().size
    } catch { /* ignore */ }

    // Runtime envelope
    const envelope = buildRuntimeEnvelope({
      target,
      contextWindow,
      graph: graph ?? undefined,
      alerts,
      blackboardFacts: { total: factStrings.length, recent: recentFacts },
      capturedRequests: { total: capturedRequestTotal },
    })

    // Cross-engagement priors
    let priorsBlock = ''
    try {
      const memory = new CrossEngagementMemory()
      await memory.load()
      const priors = memory.getPriorPatterns()
      if (priors.promptBlock) priorsBlock = priors.promptBlock
    } catch { /* ignore */ }

    // F6 FIX: Load reflexion hints from prior sessions.
    let reflexionBlock = ''
    try {
      const hints = loadRelevantHints('', target)
      if (hints.length > 0) {
        reflexionBlock = `\n\n## Prior Learning (Reflexion)\n${hints.map(h => `- ${h}`).join('\n')}`
      }
    } catch { /* ignore */ }

    // Graph summary
    let discoveriesBlock = ''
    try {
      const summary = graph?.getTargetSummary()
      if (summary) {
        discoveriesBlock = [
          `Endpoints: ${summary.totalEndpoints}`,
          `Findings: ${summary.totalFindings}`,
          `Pages: ${summary.totalPages}`,
          `Auth flows: ${summary.authFlows}`,
          `Roles: ${summary.rbacRoles}`,
          `Tests: ${summary.totalTests}`,
        ].join(' | ')
      }
    } catch { /* ignore */ }

    // Compose all context
    const parts = [
      envelope,
      priorsBlock ? `\n\n${priorsBlock}` : '',
      discoveriesBlock ? `\n\n## Graph Summary\n${discoveriesBlock}` : '',
      reflexionBlock,
    ].filter(Boolean)

    return { ok: true, context: parts.join('') }
  },
})
