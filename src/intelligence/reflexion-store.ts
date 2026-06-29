import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { ReflexionEngine } from './reflexion'

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
