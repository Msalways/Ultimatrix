import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { Severity } from '../types/shared'
import type { ReflexionEngine } from './reflexion'
import type { FindingOutcome } from './outcome-feedback'

export function saveReflexionState(engine: ReflexionEngine, workerId: string, targetOrigin?: string): void {
  const store = getGlobalGraphStore()
  const experience = engine.extractExperience()

  store.addReflexion({
    workerId,
    vulnType: experience.lastVulnType,
    failureCategory: experience.constraints.join(','),
    escalationLevel: experience.escalationLevel,
    failedPaths: experience.failedPaths,
    hints: experience.constraints,
    targetOrigin,
  })
  store.save().catch(() => {})
}

export function loadRelevantHints(vulnType: string, targetOrigin?: string): string[] {
  const store = getGlobalGraphStore()
  const nodes = store.queryNodes(NodeType.REFLEXION)
  const hints: string[] = []
  for (const node of nodes) {
    const props = node.properties as Record<string, unknown>
    // Target scoping: skip hints from different origins
    if (targetOrigin && props.targetOrigin && props.targetOrigin !== targetOrigin) {
      continue
    }
    if (props.vulnType === vulnType || !props.vulnType) {
      if (props.hints && Array.isArray(props.hints)) {
        hints.push(...(props.hints as string[]))
      }
    }
  }
  return [...new Set(hints)]
}

export function saveOutcomeFeedback(outcomes: FindingOutcome[], targetOrigin?: string): void {
  const store = getGlobalGraphStore()
  for (const o of outcomes) {
    store.addOutcome({
      findingId: o.findingId,
      techniqueId: o.techniqueId,
      accepted: o.accepted,
      fixed: o.fixed,
      retestHeld: o.retestHeld,
      severityAdjusted: o.severityAdjusted,
      note: o.note,
      targetOrigin: o.targetOrigin ?? targetOrigin,
      timestamp: o.timestamp,
    })
  }
  store.save().catch(() => {})
}

export function loadOutcomeFeedback(targetOrigin?: string): FindingOutcome[] {
  const store = getGlobalGraphStore()
  const nodes = store.queryNodes(NodeType.OUTCOME_FEEDBACK)
  const results: FindingOutcome[] = []
  for (const node of nodes) {
    const props = node.properties as Record<string, unknown>
    // Target scoping: skip feedback from different origins
    if (targetOrigin && props.targetOrigin && props.targetOrigin !== targetOrigin) {
      continue
    }
    results.push({
      findingId: props.findingId as string,
      techniqueId: props.techniqueId as string,
      accepted: props.accepted as boolean | undefined,
      fixed: props.fixed as boolean | undefined,
      retestHeld: props.retestHeld as boolean | undefined,
      severityAdjusted: props.severityAdjusted as Severity | undefined,
      note: props.note as string | undefined,
      targetOrigin: props.targetOrigin as string | undefined,
      timestamp: props.timestamp as string,
    })
  }
  return results
}
