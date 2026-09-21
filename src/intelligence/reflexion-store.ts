import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { Severity } from '../types/shared'
import type { ReflexionEngine } from './reflexion'
import type { FindingOutcome } from './outcome-feedback'
import { getTechniqueRegistry, type TechniqueRuntimeOverride } from '../skills/technique-registry'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGlobalWorkspace } from '../workspace'

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

// ─── G4: Technique weight persistence across sessions ─────────────────

interface PersistedWeights {
  version: number
  overrides: Record<string, TechniqueRuntimeOverride>
}

function getWeightsPath(): string | null {
  try {
    const ws = getGlobalWorkspace()
    return resolve(ws.getTargetDir(''), 'technique-weights.json')
  } catch { return null }
}

/**
 * Save technique registry runtime overrides to disk so they survive process
 * restart. Called at engagement cleanup. Uses a simple JSON file in the
 * workspace target directory — separate from the graph to avoid polluting
 * the node store with registry metadata.
 */
export async function saveTechniqueWeights(): Promise<void> {
  const path = getWeightsPath()
  if (!path) return
  const reg = getTechniqueRegistry()
  const all = reg.getAllRuntimeOverrides()
  if (all.size === 0) return
  const data: PersistedWeights = {
    version: 1,
    overrides: Object.fromEntries(all),
  }
  const dir = resolve(path, '..')
  if (!existsSync(dir)) {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
  }
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Load persisted technique weights from disk into the registry. Called at
 * session start. No-ops gracefully if no persisted weights exist.
 */
export async function loadTechniqueWeights(): Promise<number> {
  const path = getWeightsPath()
  if (!path || !existsSync(path)) return 0
  try {
    const raw = await readFile(path, 'utf-8')
    const data = JSON.parse(raw) as PersistedWeights
    if (!data.overrides || typeof data.overrides !== 'object') return 0
    const reg = getTechniqueRegistry()
    let loaded = 0
    for (const [techniqueId, override] of Object.entries(data.overrides)) {
      reg.setTechniqueOutcomeStats(techniqueId, {
        acceptedCount: override.acceptedCount,
        fixHoldCount: override.fixHoldCount,
        regressionCount: override.regressionCount,
      })
      loaded++
    }
    return loaded
  } catch { return 0 }
}
