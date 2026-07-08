import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { FindingNode } from '../graph/schema'
import { getTechniqueRegistry } from '../skills/technique-registry'
import type { ChainRule } from '../types/shared'

export type { ChainRule }

export function detectChains(findings: FindingNode[]): Array<{ source: FindingNode; target: FindingNode; rule: ChainRule }> {
  const chains: Array<{ source: FindingNode; target: FindingNode; rule: ChainRule }> = []
  const registry = getTechniqueRegistry()
  const rules = registry.getChainRules()

  for (const source of findings) {
    const sourceTech = source.properties.technique.toLowerCase()

    for (const rule of rules) {
      if (sourceTech.includes(rule.source)) {
        const targetsByType = findings.filter(f => {
          const t = f.properties.technique.toLowerCase()
          return t.includes(rule.target)
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

  return chains
}

export function suggestFollowUp(finding: FindingNode): string[] {
  const tech = finding.properties.technique.toLowerCase()
  return getTechniqueRegistry().getFollowUps(tech)
}