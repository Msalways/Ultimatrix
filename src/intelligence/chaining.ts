import { getGlobalGraphStore, type GraphStore } from '../graph/store'
import { NodeType, EdgeType } from '../graph/schema'
import type { FindingNode } from '../graph/schema'
import { getTechniqueRegistry } from '../skills/technique-registry'
import { listPrimitives } from '../primitives/framework'
import type { ChainRule, ChainSeverity, Severity } from '../types/shared'
import type { EvidenceGate } from './evidence-gate'

export type { ChainRule, ChainSeverity }

/**
 * Typed technique matcher (no substring scanning of free-form text).
 *
 * A finding's `technique` property is a controlled classification slug — set by
 * primitives, not LLM prose. We match by exact token membership against a
 * normalized token set, never by `String.includes(rule)` on arbitrary text.
 *
 * The token set is derived by:
 *   1. lowercasing,
 *   2. splitting on non-alphanumeric boundaries (so `data-exfiltration` yields
 *      `data`, `exfiltration`, and the full `data-exfiltration`),
 *   3. splitting camelCase,
 *   4. aliasing a primitive *id* (e.g. `idorSwapper`) to its canonical slug
 *      (`idor`) so production findings (tagged with the primitive id) match the
 *      same rules as test fixtures (tagged with the slug).
 */
const PRIMITIVE_TECHNIQUE: Record<string, string[]> = {
  idorSwapper: ['idor'],
  bolaFuzzer: ['bola', 'idor'],
  graphqlBola: ['graphql', 'bola'],
  ssrfOast: ['ssrf'],
  ssrfMetadata: ['ssrf', 'cloud-metadata'],
  classicInjection: ['injection', 'sqli'],
  authzMatrix: ['authorization'],
  configTrust: ['business_logic'],
  headerInjection: ['header-injection'],
  aiTrust: ['prompt-injection', 'ai'],
  aiAgentAttack: ['ai', 'agent'],
  authBypass: ['auth-bypass', 'jwt', 'sqli-login'],
  concurrencyHarness: ['race_condition'],
  invariantProbe: ['invariant'],
  workflowBypass: ['workflow_bypass'],
  atoChain: ['ator', 'chain'],
  rceClass: ['rce', 'injection'],
}

// Case-insensitive lookup so a lowercased primitive id (e.g. "idorswapper")
// still aliases to its canonical slug ("idor").
const PRIMITIVE_TECHNIQUE_LC: Record<string, string[]> = {}
for (const [k, v] of Object.entries(PRIMITIVE_TECHNIQUE)) {
  PRIMITIVE_TECHNIQUE_LC[k.toLowerCase()] = v
}

export function techniqueTokens(technique: string): Set<string> {
  const t = (technique || '').toLowerCase()
  const set = new Set<string>()
  if (!t) return set
  set.add(t)
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (!raw) continue
    set.add(raw)
    // camelCase split (e.g. "idorswapper" stays; "openRedirect" -> "open","redirect")
    for (const c of raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/)) {
      if (c) set.add(c.toLowerCase())
    }
  }
  const aliases = PRIMITIVE_TECHNIQUE_LC[t]
  if (aliases) for (const a of aliases) set.add(a)
  return set
}

/** True iff `ruleToken` is an exact token of the finding's technique classification. */
export function techniqueMatches(ruleToken: string, findingTech: string): boolean {
  return techniqueTokens(findingTech).has(ruleToken.toLowerCase())
}

/** A detected (but not yet verified) chain: a source finding linked to a target
 *  finding by a chain rule. Mirrors the tuple returned by `detectChains`. */
export interface DetectedChain {
  source: FindingNode
  target: FindingNode
  rule: ChainRule
}

/** Per-link evidence result for one finding in a chain. */
export interface PerLinkEvidence {
  findingId: string
  technique: string
  endpoint: string
  /** The finding has non-empty recorded evidence in the graph. */
  hasRecordedEvidence: boolean
  /** The EvidenceGate confirms the finding's claim against real tool output. */
  claimVerified: boolean
  /** Evidence flags/facts that were missing from the tool-output buffer. */
  missing: string[]
  note: string
}

/** Result of verifying a composed low-sev -> critical chain. */
export interface VerifiedChain {
  chainId: string
  sourceFindingId: string
  targetFindingId: string
  rule: string
  /** True only when EVERY link in the chain is backed by evidence. */
  verified: boolean
  perLinkEvidence: PerLinkEvidence[]
  /** Max severity of the two underlying findings (no escalation). */
  baseSeverity: Severity
  /** The escalated severity, present only when the chain is fully verified
   *  AND the rule's severity exceeds the base severity. */
  escalatedSeverity?: ChainSeverity
  note: string
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

function severityRank(s: string): number {
  return SEVERITY_RANK[s] ?? 0
}

function higherSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b
}

export interface DetectChainsOptions {
  /** When provided, also verify each detected chain and persist a proven
   *  severity escalation onto the CHAINED_FROM edge. Backward-compatible:
   *  callers that omit this keep the original behavior. */
  evidenceGate?: EvidenceGate
}

export function detectChains(
  findings: FindingNode[],
  options?: DetectChainsOptions,
): Array<{ source: FindingNode; target: FindingNode; rule: ChainRule }> {
  const chains: Array<{ source: FindingNode; target: FindingNode; rule: ChainRule }> = []
  const registry = getTechniqueRegistry()
  const rules = registry.getChainRules()

  for (const source of findings) {
    const sourceTech = source.properties.technique.toLowerCase()

    for (const rule of rules) {
      if (techniqueMatches(rule.source, sourceTech)) {
        const targetsByType = findings.filter(f => {
          const t = f.properties.technique.toLowerCase()
          return techniqueMatches(rule.target, t)
        })

        for (const target of targetsByType) {
          if (source.id !== target.id) {
            chains.push({ source, target, rule })
          }
        }
      }
    }
  }

  for (const chain of chains) {
    const store = getGlobalGraphStore()
    store.chainFindings(chain.source.id, chain.target.id)
  }

  // Optional: prove the chains before reporting them. Verification is a pure
  // function of the chain + gate; persistence mutates the CHAINED_FROM edge.
  if (options?.evidenceGate) {
    for (const chain of chains) {
      const vc = verifyChain(chain, options.evidenceGate)
      if (vc.verified && vc.escalatedSeverity) {
        const store = getGlobalGraphStore()
        const edges = store.queryEdges({
          fromId: chain.source.id,
          toId: chain.target.id,
          type: EdgeType.CHAINED_FROM,
        })
        for (const edge of edges) {
          edge.properties = {
            ...edge.properties,
            severity: vc.escalatedSeverity,
            chainRule: chain.rule.name,
            verified: true,
          }
        }
        store.scheduleSave()
      }
    }
  }

  return chains
}

/**
 * Verify a detected chain by confirming EACH link is backed by real evidence
 * (its recorded findings AND, when available, the EvidenceGate) and that the
 * escalation to the rule's severity is justified.
 *
 * Returns a VerifiedChain. If any link lacks evidence, `verified` is false and
 * the severity is NOT escalated (escalatedSeverity undefined).
 */
export function verifyChain(chain: DetectedChain, evidenceGate?: EvidenceGate): VerifiedChain {
  const chainId = `chain:${chain.rule.name}:${chain.source.id}->${chain.target.id}`

  const perLinkEvidence: PerLinkEvidence[] = [chain.source, chain.target].map(f => {
    const evidence = Array.isArray(f.properties.evidence) ? f.properties.evidence : []
    const hasRecordedEvidence = evidence.some(e => typeof e === 'string' && e.trim().length > 0)

    let claimVerified = true
    let missing: string[] = []
    if (evidenceGate) {
      const claim = {
        type: f.properties.technique,
        endpoint: f.properties.endpoint,
      }
      const v = evidenceGate.verifyClaim(claim)
      claimVerified = v.verified
      missing = v.missing
    }

    let note: string
    if (!hasRecordedEvidence) {
      note = 'No recorded evidence backing this link — chain cannot be proven.'
    } else if (!claimVerified) {
      note = 'Link has recorded evidence but the claim is not supported by the recorded tool output.'
    } else {
      note = 'Link backed by recorded evidence and corroborated by the EvidenceGate.'
    }

    return {
      findingId: f.id,
      technique: f.properties.technique,
      endpoint: f.properties.endpoint,
      hasRecordedEvidence,
      claimVerified,
      missing,
      note,
    }
  })

  const allBacked = perLinkEvidence.every(l => l.hasRecordedEvidence && l.claimVerified)
  const baseSeverity = higherSeverity(chain.source.properties.severity, chain.target.properties.severity)
  const ruleSev = chain.rule.severity

  let escalatedSeverity: ChainSeverity | undefined
  let note: string
  if (!allBacked) {
    note = 'Chain NOT verified — one or more links lack supporting evidence; severity escalation denied.'
  } else if (severityRank(ruleSev) > severityRank(baseSeverity)) {
    escalatedSeverity = ruleSev
    note = `Chain verified; escalating severity ${baseSeverity} -> ${ruleSev} per rule "${chain.rule.name}".`
  } else {
    note = `Chain verified; rule severity (${ruleSev}) does not exceed base severity (${baseSeverity}); no escalation.`
  }

  return {
    chainId,
    sourceFindingId: chain.source.id,
    targetFindingId: chain.target.id,
    rule: chain.rule.name,
    verified: allBacked,
    perLinkEvidence,
    baseSeverity,
    ...(escalatedSeverity ? { escalatedSeverity } : {}),
    note,
  }
}

/**
 * Detect chains in the graph and verify each one. When a chain is fully proven
 * and the rule justifies a higher severity, the escalation is persisted onto
 * the CHAINED_FROM edge (severity/chainRule/verified properties).
 */
export function verifyDetectedChains(
  graphStore: GraphStore,
  evidenceGate?: EvidenceGate,
): VerifiedChain[] {
  const findings = graphStore.queryNodes(NodeType.FINDING) as FindingNode[]
  const chains = detectChains(findings)
  const verified: VerifiedChain[] = []

  for (const chain of chains) {
    const vc = verifyChain(chain, evidenceGate)
    verified.push(vc)

    if (vc.verified && vc.escalatedSeverity) {
      const edges = graphStore.queryEdges({
        fromId: chain.source.id,
        toId: chain.target.id,
        type: EdgeType.CHAINED_FROM,
      })
      for (const edge of edges) {
        edge.properties = {
          ...edge.properties,
          severity: vc.escalatedSeverity,
          chainRule: chain.rule.name,
          verified: true,
        }
      }
      graphStore.scheduleSave()
    }
  }

  return verified
}

export function suggestFollowUp(finding: FindingNode): string[] {
  const tech = finding.properties.technique.toLowerCase()
  const registry = getTechniqueRegistry()
  const out: string[] = []

  // Chain-rule driven follow-ups (typed token match, no substring of prose).
  for (const rule of registry.getChainRules()) {
    if (techniqueMatches(rule.source, tech)) {
      out.push(rule.description)
    }
  }

  // Primitive-driven follow-ups: a registered primitive whose own technique or
  // id matches the finding's classification is a concrete next step.
  for (const p of listPrimitives()) {
    if ((p.technique && techniqueMatches(p.technique, tech)) || techniqueMatches(p.id, tech)) {
      out.push(`Run ${p.name} (${p.id}) to deepen the chain`)
    }
  }

  return [...new Set(out)]
}