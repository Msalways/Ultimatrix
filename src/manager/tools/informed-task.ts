/**
 * F3 (Base Architecture Contracts) — shared informed-task builder.
 *
 * ONE implementation for spawn-worker and spawn-swarm: endpoint context,
 * captured headers/cookies, and a compact brain-state block (evolution
 * summary, captured-traffic awareness). Previously two near-duplicate
 * builders with diverging fields.
 */

import type { GraphStore } from '../../graph/store'
import { getEvolutionSummary } from '../../intelligence/evolution'
import { getCapturedRequestStore } from '../../capture/captured-request-store'

export interface InformedTaskInput {
  task: string
  endpointId?: string
  store: GraphStore
}

/** Compact brain-state so workers inherit the operator's situational awareness. */
function brainStateBlock(): string {
  const lines: string[] = []
  try {
    const evo = getEvolutionSummary()
    if (evo.techniques.length > 0) {
      const top = evo.techniques.slice(0, 3).map(t => `${t.techniqueId}(+${t.confirmed}/-${t.failed})`).join(', ')
      lines.push(`- Technique outcomes this session: ${top}`)
      if (evo.demoted.length > 0) lines.push(`- Deprioritize (repeatedly failing): ${evo.demoted.join(', ')}`)
    }
    const captured = getCapturedRequestStore().size
    if (captured > 0) lines.push(`- ${captured} captured requests exist; prior traffic is replayable — prefer differential reuse over blind re-firing`)
  } catch {
    /* brain-state is advisory */
  }
  return lines.length > 0 ? `\n\n## Session Intelligence\n${lines.join('\n')}` : ''
}

export function buildInformedTask(input: InformedTaskInput): string {
  const { task, endpointId, store } = input
  if (!endpointId) return `${task}${brainStateBlock()}`

  try {
    const endpoint = store.queryNodes(undefined, { id: endpointId } as any)[0]
      || Array.from((store as any).nodes?.values() ?? []).find((n: any) => n.id === endpointId)
    if (!endpoint) return `${task}${brainStateBlock()}`

    const p = endpoint.properties as any
    const headerLines = (p.headers || []).map((h: any) => `  ${h.name}: ${h.value}`)
    const cookieStr = (p.cookies || []).map((c: any) => `  ${c.name}=${c.value}`).join('; ')

    let block = `${task}\n\n## Target Endpoint\n- URL: ${p.url}\n- Method: ${p.method}\n- Params: ${JSON.stringify(p.params || [])}${p.authRequired ? '\n- Auth Required: Yes (' + (p.authType || 'unknown') + ')' : ''}${p.tags ? '\n- Tags: ' + p.tags.join(', ') : ''}`
    if (headerLines.length > 0) block += `\n\n## Captured Headers (use these in your HTTP request headers)\n${headerLines.join('\n')}`
    if (cookieStr) block += `\n\n## Captured Cookies (use these in your HTTP request cookie header)\n  ${cookieStr}`
    if (p.authType) block += `\n\n## Auth Type: ${p.authType} — retrieve the captured auth headers for ${p.url} to get full auth context`

    return `${block}${brainStateBlock()}`
  } catch {
    return `${task}${brainStateBlock()}`
  }
}
