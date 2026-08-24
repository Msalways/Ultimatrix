import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { log } from '../utils/logger'
import { promoteFindingCandidate, buildTextEvidence } from './control-tools'

export const addDiscovery = createTool({
  id: 'addDiscovery',
  description: 'Add a user-reported finding or observation to the graph. Use when the user tells you about a vulnerability they found.',
  inputSchema: z.object({
    endpoint: z.string().describe('Affected endpoint URL'),
    method: z.string().optional().default('GET').describe('HTTP method'),
    technique: z.string().describe('Vulnerability technique (e.g., "SQL Injection", "IDOR")'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
    confidence: z.number().min(0).max(1).default(0.8),
    description: z.string().describe('Description of the finding'),
    evidence: z.array(z.string()).optional().describe('Evidence items'),
    experimentIds: z.array(z.string()).optional().describe('Proven experiment IDs required for non-informational promotion'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
  }),
  execute: async ({ endpoint, method, technique, severity, confidence, description, evidence, experimentIds, tags }) => {
    try {
      const store = getGlobalGraphStore()

      store.addEndpoint({
        url: endpoint,
        method: method || 'GET',
        tags: ['user-discovered'],
        source: 'user-input',
      })

      const gateResult = await promoteFindingCandidate({
        type: technique,
        endpoint,
        method: method || 'GET',
        severity,
        confidence,
        description,
        experimentIds,
        tags: [...(tags || []), 'user-reported'],
        source: 'human',
        tool: 'addDiscovery',
        evidence: buildTextEvidence(evidence, endpoint, method),
      })
      if (!gateResult.ok) {
        log.warn(`User discovery rejected by gate: ${gateResult.error}`)
        return { ok: false, error: gateResult.error }
      }

      store.save().catch(() => {})

      log.info(`User discovery added: ${technique} on ${endpoint} (${severity})`)

      return {
        ok: true,
        value: {
          findingId: gateResult.value.findingId,
          endpoint,
          technique,
          severity,
          confidence,
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
