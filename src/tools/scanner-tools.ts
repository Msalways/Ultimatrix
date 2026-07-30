/**
 * Mastra tool builder for external-tool adapters.
 *
 * Each `ToolAdapter` becomes one LLM-callable tool. The tool:
 *  1. Checks the binary is available (graceful `skip` if not).
 *  2. Runs it against the (scope-guarded) target.
 *  3. Bridges the result through the evidence gate (re-verify before any
 *     Finding is possible) and returns BOTH the raw result and the bridge
 *     verdict (confirmed vs candidate) so the brain can decide what to persist.
 *
 * No substring routing — the brain selects the tool from its own reasoning and
 * the skill `toolRefs` it is allowed to use.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { bridgeToolResult } from './adapters/bridge'
import { ALL_ADAPTERS, getAdapter, type ToolAdapter } from './adapters'
import type { AdapterFinding } from './adapters/types'

function _findingShape() {
  return z.object({
    url: z.string().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
    detail: z.string(),
    raw: z.string(),
  })
}

export function buildAdapterTool(adapter: ToolAdapter) {
  return createTool({
    id: adapter.id,
    description: adapter.description,
    inputSchema: z.object({
      target: z.string().describe('Target URL/host (or token/source per tool). Must be in scope.'),
      options: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Tool-specific options (templates, wordlist, token, source, ports, etc.)'),
    }),
    execute: async ({ target, options }: { target: string; options?: Record<string, unknown> }) => {
      const result = await adapter.run({ target, options })
      const bridge = await bridgeToolResult(adapter, result)
      return {
        tool: adapter.id,
        status: result.status,
        target: result.target,
        output: result.output,
        findings: result.findings,
        durationMs: result.duration,
        evidenceGate: {
          confirmed: bridge.confirmed as AdapterFinding[],
          candidates: bridge.candidates as AdapterFinding[],
          skipped: bridge.skipped as AdapterFinding[],
          evidenceIds: bridge.evidenceIds,
        },
        rawOutput: result.rawOutput,
      }
    },
  })
}

export const adapterTools = ALL_ADAPTERS.map(buildAdapterTool)

export const scannerTools = Object.fromEntries(adapterTools.map(t => [t.id, t])) as Record<
  string,
  ReturnType<typeof buildAdapterTool>
>

export { ALL_ADAPTERS, getAdapter }
