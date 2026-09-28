/**
 * Dispositions — the single seam where the operator and the agent rule on the
 * same claims, in the same shape.
 *
 * Why this exists as its own tool rather than a flag or a mode:
 * - The operator's most valuable contribution is judgement ("this is normal",
 *   "that's not what we meant", "I'd do it differently"). Without a durable home
 *   for it, that judgement evaporates into scrollback and the same false positive
 *   is re-derived every session.
 * - The agent needs the same seam for its own verdicts, so that a human ruling
 *   and a verifier replay land in one history instead of two parallel systems
 *   that can drift.
 *
 * Deliberately NOT a flow: no ordering, no required sequence, no state machine.
 * Either side may append any number of times about any kind of claim, at any
 * point. Contradictions are permitted and surfaced rather than auto-resolved.
 * The `reason` is free text because a person who has to fill in a form stops
 * contributing, and that is the failure this design is meant to avoid.
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, buildClaimKey, type DispositionNode } from '../graph/schema'

export const recordDisposition = createTool({
  id: 'recordDisposition',
  description:
    'Record a ruling about a claim — yours or the assistant\'s. Use it when the operator states or corrects how the target actually behaves ("this is expected", "that is not a bug", "it is a bug"), when you reach a verdict, or when you disagree with a proposed action and want the reason on record. Either side may call this at any time; nothing depends on the order. Recording "expected" tells the system to stop re-raising that behaviour, which is the fastest way to cut noise.',
  inputSchema: z.object({
    endpoint: z.string().optional().describe('Ruling on something you OBSERVED at a URL? Pass the URL here, copied exactly. This is the normal way to rule on a finding, and you do not need to know any id, key, or technique string.'),
    technique: z.string().optional().describe('Optional: narrow to one finding class on that endpoint. Omit to cover every finding on it, which is usually what "that is normal" means.'),
    claimRef: z.string().optional().describe('ONLY when the claim has no URL: a behaviour, a plan, an assumption. Setting this for a finding will be REJECTED, because a finding ruling that matches nothing suppresses nothing.'),
    claimKind: z.enum(['finding', 'hypothesis', 'proposal', 'assumption', 'behaviour']).default('finding')
      .describe('What the claim is about. Use "behaviour" for a standing note about the app, "finding" for a ruling on a finding.'),
    origin: z.enum(['human', 'agent']).describe('Who is ruling. Use "human" whenever you are recording something THE OPERATOR told you — their statement about how the app behaves, their correction of your verdict, or their yes/no on a proposal. Use "agent" ONLY for a verdict you reached yourself from evidence. If you are unsure, the operator said it, so it is "human".'),
    value: z.enum(['proposed', 'verified', 'disproven', 'rejected', 'expected', 'contested'])
      .describe('proposed=nobody has ruled yet; verified=holds; disproven=refuted by evidence; rejected=not a defect; expected=normal/by-design behaviour (NOT a rejection — it suppresses re-raising); contested=sides disagree'),
    reason: z.string().describe('Plain language, why. Write it for the other person to read, not for a log parser.'),
    effectiveness: z.string().optional()
      .describe('Your read on whether acting on this is worth it: does it touch observed live surface, is it already disproven, is it likely noise, what is it worth versus what it costs. State this BEFORE acting so the operator can disagree.'),
    respondsTo: z.string().optional().describe('id of the disposition this answers, when you are replying to an earlier ruling.'),
    claimLabel: z.string().optional().describe('Human-readable label for the claim, useful when the claim has no finding behind it.'),
  }),
  execute: async (input) => {
    const store = getGlobalGraphStore()
    if (!store) return { ok: false, error: 'No graph store available' }

    const findingsOn = (endpoint: string) =>
      typeof (store as any).findingsForEndpoint === 'function'
        ? store.findingsForEndpoint(endpoint) as Array<{ id: string; properties: Record<string, unknown> }>
        : []
    const claimKeyOf = (f: { id: string; properties: Record<string, unknown> }) => {
      const logical = f.properties.findingId
      if (typeof logical === 'string' && logical) return logical
      return buildClaimKey(String(f.properties.technique ?? 'unknown'), String(f.properties.endpoint ?? ''), undefined)
    }

    // Resolution order, most reliable anchor first.
    //
    // Verified live, three consecutive failures of the same kind: the model
    // guessed a tool name, then an ad-hoc claim key, then ignored `endpoint`
    // entirely while holding the URL in its context. The lesson is that a model
    // must not be trusted to name a claim. So: the URL wins, and a caller-supplied
    // reference is only honoured after exact matching against every identifier
    // the system actually knows. Nothing here is fuzzy or pattern-based.
    let targetClaims: string[] = []
    let matchedFindings = 0
    if (input.endpoint) {
      const matches = findingsOn(input.endpoint)
      const narrowed = input.technique
        ? matches.filter(f => f.properties.technique === input.technique)
        : matches
      matchedFindings = narrowed.length
      targetClaims = narrowed.length > 0
        ? narrowed.map(claimKeyOf)
        : [`endpoint:${input.endpoint}`]
    }

    if (targetClaims.length === 0 && input.claimRef) {
      const ref = input.claimRef
      const findings = typeof (store as any).queryNodes === 'function'
        ? (store.queryNodes('Finding' as never) as Array<{ id: string; properties: Record<string, unknown> }>)
        : []
      const exact = findings.filter(f =>
        f.id === ref
        || f.properties.findingId === ref
        || f.properties.endpoint === ref
        || f.properties.technique === ref)
      matchedFindings = exact.length
      targetClaims = exact.length > 0 ? exact.map(claimKeyOf) : [ref]
    }

    if (targetClaims.length === 0) {
      return { ok: false, error: 'Provide endpoint for a ruling about something you observed, or claimRef for a claim with no URL.' }
    }

    // Fail closed on the one case that is always a mistake: a ruling ABOUT A
    // FINDING that matched no finding. Writing it would report a suppression
    // that did not happen — the exact failure this tool exists to prevent, so
    // it is refused outright rather than merely discouraged. Verified live: the
    // model kept inventing a reference, and an earlier version of this check
    // only tested for one specific prefix, so the invention sailed straight
    // through. The honest condition is simply "did it attach".
    if (input.claimKind === 'finding' && matchedFindings === 0) {
      // Say which half of the match failed. Verified live: the model passed a
      // param value in `technique`, narrowing the result to nothing, and was
      // told "No finding exists at <endpoint>" — which is false, the endpoint has
      // findings. Wrong guidance costs the caller attempts, and on the real run
      // it took five calls to land a ruling the model had phrased correctly.
      if (input.claimRef) {
        return {
          ok: false,
          error: `"${input.claimRef}" does not identify any finding, so this ruling would suppress nothing and was NOT recorded. Call again with endpoint set to the URL you observed, or with claimKind "behaviour" if the operator is describing standing behaviour rather than ruling on a finding.`,
        }
      }
      if (input.technique) {
        const available = findingsOn(input.endpoint!).map(f => String(f.properties.technique ?? ''))
        return {
          ok: false,
          error: available.length > 0
            ? `Findings exist at ${input.endpoint} but none has technique "${input.technique}". Available there: ${[...new Set(available)].join(', ')}. Omit technique to rule on all of them, or use claimKind "behaviour".`
            : `No finding exists at ${input.endpoint}, so a ruling on it would suppress nothing and was NOT recorded. Call again with claimKind "behaviour" if the operator is describing standing behaviour.`,
        }
      }
      return {
        ok: false,
        error: `No finding exists at ${input.endpoint}, so a ruling on it would suppress nothing and was NOT recorded. Call again with claimKind "behaviour" if the operator is describing standing behaviour.`,
      }
    }

    try {
      const recorded = targetClaims.map(claimRef => {
        // Idempotent, not deduplicating.
        //
        // Verified live: repeated attempts by the same origin with the same
        // value and reason produced six identical orphan rows that buried the
        // one ruling actually suppressing a finding. The log stays append-only —
        // history is not rewritten — but a write that adds no information is
        // not history. Returning the existing entry keeps the call successful
        // (the model did the right thing) while adding nothing to the noise, and
        // hands back the id so the model can reference it.
        const existing = store.getDispositions(claimRef).find(d =>
          d.properties.origin === input.origin
          && d.properties.value === input.value
          && (d.properties.reason ?? '') === input.reason)

        const node = existing ?? store.addDisposition({
          claimRef,
          claimKind: input.claimKind,
          origin: input.origin,
          value: input.value,
          reason: input.reason,
          ...(input.effectiveness ? { effectiveness: input.effectiveness } : {}),
          ...(input.respondsTo ? { respondsTo: input.respondsTo } : {}),
          ...(input.claimLabel ? { claimLabel: input.claimLabel } : {}),
        })
        // Keep the finding's own lifecycle a projection of this log so every
        // existing consumer (reports, proof floor, case file) sees the ruling
        // without knowing that dispositions exist.
        const derived = store.applyDispositions(claimRef)
        return {
          id: node.id,
          claimRef,
          alreadyOnRecord: Boolean(existing),
          attachedToFinding: Boolean(derived?.attached),
          ...(derived ? { lifecycle: derived.status, expected: derived.expected, contested: derived.contested } : {}),
        }
      })

      const attachedCount = recorded.filter(r => r.attachedToFinding).length
      const dedupedCount = recorded.filter(r => r.alreadyOnRecord).length
      return {
        ok: true,
        value: {
          value: input.value,
          origin: input.origin,
          claims: recorded,
          attachedCount,
          ...(dedupedCount > 0
            ? { note: `This ruling was already on record (${dedupedCount} claim(s)); nothing was duplicated. Use a different value or reason to change it.` }
            : attachedCount === 0
              ? { note: 'Recorded as standing knowledge. No existing finding matched, so nothing is suppressed yet; it will bind if a matching finding appears.' }
              : { note: `Attached to ${attachedCount} finding(s); they will no longer be raised.` }),
        },
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
})

export const getDispositions = createTool({
  id: 'getDispositions',
  description:
    'Read what has already been ruled on — yours and the assistant\'s, with reasons. Check this before re-proposing something, so you do not re-raise a behaviour the operator has already said is expected.',
  inputSchema: z.object({
    claimRef: z.string().optional().describe('Restrict to one claim. Omit for everything ruled on so far.'),
  }),
  execute: async ({ claimRef }) => {
    const store = getGlobalGraphStore()
    if (!store) return { ok: false, error: 'No graph store available' }
    const items = store.getDispositions(claimRef) as DispositionNode[]
    return {
      ok: true,
      value: {
        total: items.length,
        items: items.map((d) => ({
          id: d.id,
          claimRef: d.properties.claimRef,
          claimKind: d.properties.claimKind,
          origin: d.properties.origin,
          value: d.properties.value,
          reason: d.properties.reason,
          ...(d.properties.effectiveness ? { effectiveness: d.properties.effectiveness } : {}),
          at: d.createdAt,
        })),
      },
    }
  },
})

/**
 * Claims the operator has called normal. Surfaced as a prior, not a gate: the
 * agent may still re-open one with a reason, but it must not silently re-propose
 * something the human has already explained.
 */
export function expectedBehaviourRefs(store: ReturnType<typeof getGlobalGraphStore>): string[] {
  if (!store) return []
  return (store.queryNodes(NodeType.DISPOSITION) as DispositionNode[])
    .filter((d) => d.properties.value === 'expected')
    .map((d) => d.properties.claimRef)
}
