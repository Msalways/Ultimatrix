import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

/**
 * Marker-leak oracle.
 *
 * Industry-standard proof for BOLA / BOPLA / cross-tenant leakage (the pattern
 * used by overstep / Autorize / possession): a subject replays a request under a
 * foreign identity, and we check whether a string that *uniquely identifies the
 * victim's data* appears in the response the attacker received.
 *
 * This is a PURE comparison of caller-supplied typed values. It contains NO
 * vocabulary detection — the marker is provided by the caller (the matrix /
 * session under test), never inferred from a frozen keyword list. This honours
 * the project's no-hardcoded-vocabulary / no-regex-detection principle.
 */
export const detectMarkerLeak = createTool({
  id: 'detectMarkerLeak',
  description:
    'Compare a victim-owned data marker against an attacker-observed response to prove cross-identity / cross-tenant leakage. Pure typed-string comparison; no vocabulary detection. Use after replaying a request under an alternate session: if the victim marker appears in the attacker response, the object/field is leaked.',
  inputSchema: z.object({
    victimMarker: z
      .string()
      .describe('A string that uniquely identifies the victim\'s data (e.g. a known record value, username, or object id the victim owns).'),
    attackerResponseBody: z.string().describe('Response body the attacker (alternate identity) received.'),
    attackerResponseHeaders: z
      .record(z.string(), z.string())
      .optional()
      .describe('Optional response headers the attacker received (checked for leaked markers too).'),
    caseSensitive: z.boolean().optional().default(false).describe('Match case-sensitively. Defaults to case-insensitive.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    leaked: z.boolean(),
    where: z.enum(['body', 'header', 'none']),
    headerName: z.string().optional(),
    snippet: z.string().optional(),
    confidence: z.enum(['high', 'medium', 'low']),
  }),
  execute: async (ctx) => {
    const { victimMarker, attackerResponseBody, attackerResponseHeaders, caseSensitive } = ctx
    const normalize = (s: string) => (caseSensitive ? s : s.toLowerCase())
    const marker = normalize(victimMarker)

    if (marker.length === 0) {
      return { ok: false, leaked: false, where: 'none', confidence: 'low' }
    }

    // Body check
    if (normalize(attackerResponseBody).includes(marker)) {
      const idx = normalize(attackerResponseBody).indexOf(marker)
      const snippet = attackerResponseBody.slice(Math.max(0, idx - 20), idx + victimMarker.length + 20)
      return { ok: true, leaked: true, where: 'body', snippet, confidence: 'high' }
    }

    // Header check
    if (attackerResponseHeaders) {
      for (const [name, value] of Object.entries(attackerResponseHeaders)) {
        if (normalize(value).includes(marker)) {
          return { ok: true, leaked: true, where: 'header', headerName: name, snippet: value, confidence: 'high' }
        }
      }
    }

    return { ok: true, leaked: false, where: 'none', confidence: 'high' }
  },
})
