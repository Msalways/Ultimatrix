/**
 * Active Chain Planner (P0 — the force-multiplier)
 *
 * The original `chaining.ts` is POST-HOC: it detects links between findings that
 * already exist. This module is ACTIVE: after a finding lands, it proposes the
 * next concrete attack step (a primitive to run, or a manual follow-up) that
 * would escalate a low/medium finding into a critical chain — the pattern that
 * real bug-bounty reports show pays out (7 of 10 high-severity reports are
 * chains, not single bugs).
 *
 * Matching is typed (see `techniqueMatches` in `chaining.ts`) — no substring
 * scanning of free-form LLM text. Dispatch reuses the existing primitive
 * framework (`runPrimitiveById`) so every executed step is still gated by the
 * EvidenceGate.
 */

import { getTechniqueRegistry } from '../skills/technique-registry'
import { listPrimitives } from '../primitives/framework'
import { runPrimitiveById } from '../primitives'
import { techniqueMatches } from './chaining'
import type { ChainRule, ChainSeverity } from '../types/shared'
import type { FindingNode } from '../graph/schema'

/** A proposed next step to escalate a chain from a source finding. */
export interface ChainStep {
  kind: 'primitive' | 'followup'
  sourceFindingId: string
  rule: ChainRule
  targetTechnique: string
  /** Present when a registered primitive can execute the next step directly. */
  primitiveId?: string
  rationale: string
  expectedSeverity: ChainSeverity
}

/**
 * Map a chain-rule *target* technique token to a concrete primitive id. Targets
 * that have no 1:1 primitive (e.g. `session-hijack`, `token-theft`) are returned
 * as `followup` steps instead of being force-mapped.
 */
const CHAIN_TARGET_TO_PRIMITIVE: Record<string, string> = {
  idor: 'bolaFuzzer',
  ssrf: 'ssrfMetadata',
  'internal-scan': 'ssrfMetadata',
  injection: 'rceClass',
  sqli: 'classicInjection',
  'data-exfiltration': 'classicInjection',
  authorization: 'authzMatrix',
  'privilege-escalation': 'authzMatrix',
  'mass-assignment': 'bolaFuzzer',
  business_logic: 'configTrust',
  'header-injection': 'headerInjection',
  'prompt-injection': 'aiAgentAttack',
  ai: 'aiAgentAttack',
  race_condition: 'concurrencyHarness',
  workflow_bypass: 'workflowBypass',
  jwt: 'authBypass',
  'session-hijack': 'atoChain',
  'token-theft': 'atoChain',
  'privilege escalation': 'authzMatrix',
}

/**
 * "Deepen" mapping: when a source finding's own technique has a dedicated
 * next-stage primitive, prefer proposing that (e.g. an IDOR finding → the BOLA
 * multi-role engine, the highest-payout BOLA family) before falling back to the
 * rule-target mapping.
 */
const SOURCE_DEEPEN_PRIMITIVE: Record<string, string> = {
  idor: 'bolaFuzzer',
  ssrf: 'ssrfMetadata',
}

function primitiveExists(id: string): boolean {
  return listPrimitives().some(p => p.id === id)
}

/**
 * Propose the next chain step for a single source finding. Returns the first
 * matching chain rule that yields a concrete next action. `null` if no chain
 * applies.
 */
export function proposeChainStep(source: FindingNode): ChainStep | null {
  const tech = source.properties.technique.toLowerCase()
  const rules = getTechniqueRegistry().getChainRules()

  for (const rule of rules) {
    if (!techniqueMatches(rule.source, tech)) continue

    // Prefer a dedicated deepen primitive for this source technique.
    const deepen = SOURCE_DEEPEN_PRIMITIVE[rule.source]
    if (deepen && primitiveExists(deepen)) {
      return {
        kind: 'primitive',
        sourceFindingId: source.id,
        rule,
        targetTechnique: rule.source,
        primitiveId: deepen,
        rationale: `${rule.description} — deepen with ${deepen}.`,
        expectedSeverity: rule.severity,
      }
    }

    const primitiveId = CHAIN_TARGET_TO_PRIMITIVE[rule.target]
    if (primitiveId && primitiveExists(primitiveId)) {
      return {
        kind: 'primitive',
        sourceFindingId: source.id,
        rule,
        targetTechnique: rule.target,
        primitiveId,
        rationale: `${rule.description} — propose running ${primitiveId} to escalate.`,
        expectedSeverity: rule.severity,
      }
    }

    return {
      kind: 'followup',
      sourceFindingId: source.id,
      rule,
      targetTechnique: rule.target,
      rationale: `${rule.description} — no direct primitive; manual follow-up: ${rule.target}.`,
      expectedSeverity: rule.severity,
    }
  }

  return null
}

/** Derive a minimal primitive context from a finding node. */
function contextFromFinding(f: FindingNode): Record<string, any> {
  const p = f.properties as Record<string, any>
  const url = p.endpoint || p.url || undefined
  return {
    target: url,
    endpointUrl: url,
    endpointMethod: p.method || 'GET',
  }
}

export interface ActiveChainingOptions {
  /** Max number of primitives to execute in one pass (safety budget). */
  maxSteps?: number
  /** Injectable dispatcher (tests mock this to avoid live HTTP). */
  runPrimitive?: (primitiveId: string, context: Record<string, any>) => Promise<unknown>
}

export interface ActiveChainingResult {
  steps: ChainStep[]
  executed: Array<{ step: ChainStep; outcome: unknown }>
}

/**
 * Active chaining loop: for each finding, propose the next step and — when the
 * step maps to a concrete primitive — execute it through the EvidenceGate-backed
 * primitive framework. Re-running after new findings appear extends the chain.
 */
export async function runActiveChaining(
  findings: FindingNode[],
  options: ActiveChainingOptions = {},
): Promise<ActiveChainingResult> {
  const maxSteps = options.maxSteps ?? 5
  const runner =
    options.runPrimitive ??
    ((id: string, ctx: Record<string, any>) => runPrimitiveById(id, ctx, { commit: true }))

  const steps: ChainStep[] = []
  const executed: Array<{ step: ChainStep; outcome: unknown }> = []

  for (const finding of findings) {
    if (executed.length >= maxSteps) break
    const step = proposeChainStep(finding)
    if (!step) continue
    steps.push(step)
    if (step.primitiveId) {
      const outcome = await runner(step.primitiveId, contextFromFinding(finding))
      executed.push({ step, outcome })
    }
  }

  return { steps, executed }
}
