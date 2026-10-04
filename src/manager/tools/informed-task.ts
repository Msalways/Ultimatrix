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
import { redactUrl } from '../../security/secret-vault'

export interface InformedTaskInput {
  task: string
  endpointId?: string
  store: GraphStore
}

function routeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(redactUrl(value)); return `${url.origin}${url.pathname}` } catch { return undefined }
}

function names(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean)
  if (value && typeof value === 'object') return Object.keys(value)
  return []
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
    const url = routeUrl(p.url) ?? '(invalid observed URL)'
    const headerNames = names(p.headers)
    const cookieNames = names(p.cookies)

    let block = `${task}\n\n## Observed Target Endpoint\n- URL: ${url}\n- Method: ${p.method}\n- Inputs: ${JSON.stringify(p.params || [])}${p.authRequired ? '\n- Auth Required: Yes (' + (p.authType || 'unknown') + ')' : ''}${p.tags ? '\n- Tags: ' + p.tags.join(', ') : ''}`
    if (headerNames.length > 0) block += `\n- Observed request header names: ${headerNames.join(', ')}`
    if (cookieNames.length > 0) block += `\n- Observed cookie names: ${cookieNames.join(', ')}`
    if (p.authType) block += `\n- Auth Type: ${p.authType}; use a registered session reference to retrieve credentials.`

    return `${block}${brainStateBlock()}`
  } catch {
    return `${task}${brainStateBlock()}`
  }
}
