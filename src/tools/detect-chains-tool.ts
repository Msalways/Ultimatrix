import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { detectChains, verifyChain } from '../intelligence/chaining'
import type { FindingNode } from '../graph/schema'
import { getGlobalEvidenceGate } from './control-tools'

export const detectChainsTool = createTool({
  id: 'detectChains',
  description: 'Detect potential attack chains between findings in the knowledge graph. Returns linked findings that could be combined for higher-impact exploits.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      chains: z.array(z.object({
        source: z.string(),
        target: z.string(),
        rule: z.string(),
        severity: z.string(),
        description: z.string(),
      })),
      count: z.number(),
    }),
  }),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      const allNodes = store.queryNodes()
      const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]

      if (findings.length === 0) {
        return {
          ok: true,
          value: { chains: [], count: 0 },
        }
      }

      const chains = detectChains(findings)

      return {
        ok: true,
        value: {
          chains: chains.map(c => ({
            source: c.source.properties.technique,
            target: c.target.properties.technique,
            rule: c.rule.name,
            severity: c.rule.severity,
            description: c.rule.description,
          })),
          count: chains.length,
        },
      }
    } catch (_error) {
      return {
        ok: false,
        value: { chains: [], count: 0 },
      }
    }
  },
})

const perLinkEvidenceSchema = z.object({
  findingId: z.string(),
  technique: z.string(),
  endpoint: z.string(),
  hasRecordedEvidence: z.boolean(),
  claimVerified: z.boolean(),
  missing: z.array(z.string()),
  note: z.string(),
})

const verifiedChainSchema = z.object({
  chainId: z.string(),
  sourceFindingId: z.string(),
  targetFindingId: z.string(),
  rule: z.string(),
  verified: z.boolean(),
  perLinkEvidence: z.array(perLinkEvidenceSchema),
  baseSeverity: z.string(),
  escalatedSeverity: z.string().optional(),
  note: z.string(),
})

/**
 * Detect AND verify attack chains. Runs detection, then proves each composed
 * low-sev -> critical chain against the live EvidenceGate. Severity escalation
 * is only returned when every link is backed by real evidence.
 */
export const verifyChainsTool = createTool({
  id: 'verifyChains',
  description: 'Detect attack chains between findings and PROVE each one against the EvidenceGate. Returns verification status and severity escalation per chain (escalation only when fully evidenced).',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      chains: z.array(verifiedChainSchema),
      verifiedCount: z.number(),
      escalatedCount: z.number(),
    }),
  }),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      const allNodes = store.queryNodes()
      const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]

      if (findings.length === 0) {
        return {
          ok: true,
          value: { chains: [], verifiedCount: 0, escalatedCount: 0 },
        }
      }

      const gate = getGlobalEvidenceGate() ?? undefined
      const detected = detectChains(findings)
      const chains = detected.map(c => verifyChain(c, gate))

      const verifiedCount = chains.filter(c => c.verified).length
      const escalatedCount = chains.filter(c => c.verified && c.escalatedSeverity).length

      return {
        ok: true,
        value: { chains, verifiedCount, escalatedCount },
      }
    } catch (_error) {
      return {
        ok: false,
        value: { chains: [], verifiedCount: 0, escalatedCount: 0 },
      }
    }
  },
})
