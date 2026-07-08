import { NodeType, type ActionNode, type EndpointNode, type InputNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { ResearchWorkflow } from './types'
import { inferNameFromUrl, normalizeName, stableId, uniq } from './utils'
import { getTechniqueRegistry } from '../skills/technique-registry'

function classifyWorkflow(url: string, method?: string, tags?: string[]): { name: string; stateChanges: string[] } {
  return getTechniqueRegistry().classifyWorkflow(url, method, tags)
}

export function extractWorkflows(store: GraphStore): ResearchWorkflow[] {
  const endpoints = store.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const actions = store.queryNodes(NodeType.ACTION) as ActionNode[]
  const inputs = store.queryNodes(NodeType.INPUT) as InputNode[]
  const workflows = new Map<string, ResearchWorkflow>()

  for (const endpoint of endpoints) {
    const props = endpoint.properties
    const classified = classifyWorkflow(props.url, props.method, props.tags)
    const id = stableId('workflow', [classified.name, props.authRequired ? 'auth' : 'anon'])
    const existing = workflows.get(id)
    const inputFields = (props.params || []).map(p => p.name)
    const step = { action: `${props.method} ${props.url}`, url: props.url, endpointId: endpoint.id, method: props.method }

    workflows.set(id, {
      id,
      name: classified.name,
      entryUrl: existing?.entryUrl || props.url,
      steps: [...(existing?.steps || []), step],
      relatedEndpoints: uniq([...(existing?.relatedEndpoints || []), endpoint.id]),
      requiredAuth: Boolean(existing?.requiredAuth || props.authRequired),
      inputFields: uniq([...(existing?.inputFields || []), ...inputFields]),
      stateChanges: uniq([...(existing?.stateChanges || []), ...classified.stateChanges]),
      observedRoles: existing?.observedRoles || [],
      confidence: Math.min(0.95, (existing?.confidence || 0.45) + 0.1),
    })
  }

  for (const action of actions) {
    const url = action.properties.url || ''
    const selector = action.properties.selector || ''
    const classified = classifyWorkflow(`${url} ${selector} ${action.properties.actionType}`)
    const id = stableId('workflow', [classified.name, 'ui'])
    const relatedInputs = inputs
      .filter(input => input.id.startsWith(`input:${action.id}:`))
      .map(input => input.properties.name || input.properties.selector)
      .filter(Boolean)

    const existing = workflows.get(id)
    workflows.set(id, {
      id,
      name: classified.name,
      entryUrl: existing?.entryUrl || url || undefined,
      steps: [...(existing?.steps || []), { action: action.properties.actionType, url: url || undefined }],
      relatedEndpoints: existing?.relatedEndpoints || [],
      requiredAuth: existing?.requiredAuth,
      inputFields: uniq([...(existing?.inputFields || []), ...relatedInputs]),
      stateChanges: uniq([...(existing?.stateChanges || []), ...classified.stateChanges]),
      observedRoles: existing?.observedRoles || [],
      confidence: Math.min(0.85, (existing?.confidence || 0.35) + 0.1),
    })
  }

  return [...workflows.values()].sort((a, b) => b.confidence - a.confidence)
}
