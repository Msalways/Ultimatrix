/**
 * HAR Bridge — Wires the dead HAR analysis pipeline into the graph + LLM context.
 *
 * After spider captures HAR data, this module:
 * 1. Parses HAR → extracts endpoints with headers/params/auth
 * 2. Extracts secrets (tokens, CSRF, JWT, API keys)
 * 3. Tracks data flows (token propagation across requests)
 * 4. Identifies patterns (JSON APIs, auth, error responses, etc.)
 * 5. Generates attack hypotheses (IDOR, missing auth, SQLi, info disclosure)
 * 6. Writes ALL of this to the graph as nodes
 * 7. Returns an LLM-ready context string for the next turn
 *
 * No hardcoded values. No band-aids. Pure wiring.
 */

import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import { log } from '../utils/logger'
import { parseHar, getEndpointsWithHeaders, getSecrets, getDataFlows } from '../capture/har-parser'
import { identifyPatterns, generateHypotheses, type Hypothesis } from '../analysis/har-analyzer'
import { detectChains } from '../intelligence/chaining'
import { getTechniqueRegistry } from '../skills/technique-registry'
import { runAnalysis } from './analyser'
import type { HarArchive } from '../capture/har-parser'

export interface BridgeResult {
  endpointsWritten: number
  secretsWritten: number
  factsWritten: number
  intentsWritten: number
  patternsFound: number
  hypothesesGenerated: number
  contextForLLM: string
}

/**
 * Bridge HAR data into the graph and produce LLM context.
 *
 * Call this after spider finishes and HAR is captured.
 * All data flows into the graph. The returned string is ready for LLM injection.
 */
export async function bridgeHARToGraph(harJson: string, targetUrl: string): Promise<BridgeResult> {
  const store = getGlobalGraphStore()
  const archive = parseHar(harJson)
  const entries = archive.log.entries

  if (entries.length === 0) {
    log.dim('HAR bridge: no entries to process')
    return {
      endpointsWritten: 0,
      secretsWritten: 0,
      factsWritten: 0,
      intentsWritten: 0,
      patternsFound: 0,
      hypothesesGenerated: 0,
      contextForLLM: '',
    }
  }

  let endpointsWritten = 0
  let secretsWritten = 0
  let factsWritten = 0
  let intentsWritten = 0

  // ── 1. Endpoints with headers/params/auth ──────────────────────
  const endpoints = getEndpointsWithHeaders(entries)
  for (const ep of endpoints) {
    store.addEndpoint({
      url: ep.url,
      method: ep.method,
      params: ep.params,
      headers: ep.headers,
      authRequired: ep.authType !== null,
      authType: ep.authType,
      tags: ['har-capture'],
      source: 'har-bridge',
    })
    endpointsWritten++
  }

  // ── 2. Secrets → Finding nodes ────────────────────────────────
  const secrets = getSecrets(entries)
  for (const secret of secrets) {
    store.addFinding({
      endpoint: `${secret.location}:${secret.name}`,
      technique: `Secret Exposure: ${secret.type}`,
      severity: secret.type === 'jwt' || secret.type === 'password' ? 'high' : 'medium',
      confidence: 0.7,
      description: `${secret.description}. Found in ${secret.location} (entry ${secret.entryIndex}): ${secret.name} = ${secret.value}`,
      evidence: [`HAR entry ${secret.entryIndex}`, `${secret.location}: ${secret.name}`],
      tags: ['har-bridge', 'secret', secret.type],
      source: 'har-bridge',
    })
    secretsWritten++
  }

  // ── 3. Data flows → Fact nodes ────────────────────────────────
  const dataFlows = getDataFlows(entries)
  for (const flow of dataFlows) {
    store.addFact({
      description: `Data flow: ${flow.source.location}(${flow.source.name}) → ${flow.sink.location}(${flow.sink.name}) via ${flow.type}: ${flow.value}`,
      source: 'har-bridge',
      confidence: 0.8,
    })
    factsWritten++
  }

  // ── 4. Patterns → Fact nodes ──────────────────────────────────
  const patterns = identifyPatterns(entries)
  for (const pattern of patterns) {
    store.addFact({
      description: `Pattern [${pattern.type}]: ${pattern.description} (confidence: ${pattern.confidence}). Evidence: ${pattern.evidence.slice(0, 3).join('; ')}`,
      source: 'har-bridge',
      confidence: pattern.confidence,
    })
    factsWritten++
  }

  // ── 5. Hypotheses → Intent nodes ──────────────────────────────
  const harEndpoints = endpoints.map(ep => ({
    method: ep.method,
    url: ep.url,
    host: ep.host,
    path: ep.path,
    queryParams: Object.fromEntries(Object.entries(ep.params || {}).map(p => [p.name, ''])),
    requestCount: 1,
    avgResponseTime: 0,
  }))
  const hypotheses = generateHypotheses(patterns, harEndpoints)
  for (const hyp of hypotheses) {
    const intent = store.addFact({
      description: `Hypothesis [${hyp.id}]: ${hyp.title} — ${hyp.attackVector}. Targets: ${hyp.targetEndpoints.slice(0, 3).join(', ')}${hyp.targetEndpoints.length > 3 ? ` (+${hyp.targetEndpoints.length - 3} more)` : ''}`,
      source: 'har-bridge',
      confidence: hyp.confidence,
    })
    intentsWritten++
  }

  // ── 6. XHR response body analysis (business logic) ────────────
  const xhrBodies = extractXHRBodies(entries)
  for (const xhr of xhrBodies) {
    if (xhr.hiddenFields.length > 0) {
      store.addFact({
        description: `XHR hidden fields [${xhr.method} ${xhr.path}]: ${xhr.hiddenFields.join(', ')} — data returned by API but not needed for display. Test for privilege escalation or mass assignment.`,
        source: 'har-bridge',
        confidence: 0.6,
      })
      factsWritten++
    }
    if (xhr.validationGaps.length > 0) {
      store.addFact({
        description: `Validation gap [${xhr.method} ${xhr.path}]: ${xhr.validationGaps.join(', ')} — client-side trusts server response structure.`,
        source: 'har-bridge',
        confidence: 0.5,
      })
      factsWritten++
    }
  }

  // ── 6.5 Business-logic analysis (use-case, invariants, header semantics, auth reuse, value origins) ──
  try {
    await runAnalysis(store, harJson)
  } catch (analysisErr) {
    log.warn(`HAR bridge: business-logic analysis skipped: ${(analysisErr as Error).message}`)
  }

  // ── 7. Persist ────────────────────────────────────────────────
  await store.save()

  // ── 8. Build LLM context ──────────────────────────────────────
  const contextForLLM = buildHARContextForLLM({
    targetUrl,
    entryCount: entries.length,
    endpoints,
    secrets,
    dataFlows,
    patterns,
    hypotheses,
    xhrBodies,
  })

  log.info(`HAR bridge: ${endpointsWritten} endpoints, ${secretsWritten} secrets, ${factsWritten} facts, ${intentsWritten} hypotheses → graph`)

  return {
    endpointsWritten,
    secretsWritten,
    factsWritten,
    intentsWritten,
    patternsFound: patterns.length,
    hypothesesGenerated: hypotheses.length,
    contextForLLM,
  }
}

// ── XHR Response Body Analysis ──────────────────────────────────

interface XHRAnalysis {
  method: string
  path: string
  hiddenFields: string[]
  validationGaps: string[]
}

function extractXHRBodies(entries: ReturnType<typeof parseHar>['log']['entries']): XHRAnalysis[] {
  const results: XHRAnalysis[] = []

  for (const entry of entries) {
    const url = new URL(entry.request.url)
    const mimeType = entry.response.content.mimeType || ''

    // Only analyze JSON responses (API calls / XHR)
    if (!mimeType.includes('application/json')) continue

    const bodyText = entry.response.content.text
    if (!bodyText) continue

    let parsed: Record<string, unknown> | null = null // eslint-disable-line no-useless-assignment
    try {
      parsed = JSON.parse(bodyText) as Record<string, unknown> | null
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue

    const hiddenFields: string[] = []
    const validationGaps: string[] = []

    // Detect fields that exist in response but are unlikely displayed in UI
    const registry = getTechniqueRegistry()
    const suspiciousFields = registry.getSuspiciousFields()

    for (const key of Object.keys(parsed)) {
      const lower = key.toLowerCase()
      if (suspiciousFields.some(s => lower.includes(s.toLowerCase()))) {
        hiddenFields.push(key)
      }
    }

    // Detect validation gaps: response contains data types that could be manipulated
    const boolFields = registry.getValidationGapBooleans()
    const numFields = registry.getValidationGapNumerics()
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean' && boolFields.some(s => key.toLowerCase().includes(s))) {
        validationGaps.push(`${key}=${value} (boolean, could be toggled)`)
      }
      if (typeof value === 'number' && numFields.some(s => key.toLowerCase().includes(s))) {
        validationGaps.push(`${key}=${value} (numeric, could be manipulated)`)
      }
    }

    if (hiddenFields.length > 0 || validationGaps.length > 0) {
      results.push({
        method: entry.request.method,
        path: url.pathname,
        hiddenFields,
        validationGaps,
      })
    }
  }

  return results
}

// ── LLM Context Builder ─────────────────────────────────────────

interface HARMeta {
  targetUrl: string
  entryCount: number
  endpoints: ReturnType<typeof getEndpointsWithHeaders>
  secrets: ReturnType<typeof getSecrets>
  dataFlows: ReturnType<typeof getDataFlows>
  patterns: ReturnType<typeof identifyPatterns>
  hypotheses: Hypothesis[]
  xhrBodies: XHRAnalysis[]
}

function buildHARContextForLLM(meta: HARMeta): string {
  const lines: string[] = []

  lines.push('## Captured Traffic Analysis (from HAR)')
  lines.push(`- ${meta.entryCount} HTTP requests captured`)
  lines.push(`- ${meta.endpoints.length} unique endpoints discovered`)
  lines.push(`- ${meta.secrets.length} potential secrets/tokens found`)
  lines.push(`- ${meta.dataFlows.length} data flow relationships tracked`)
  lines.push(`- ${meta.patterns.length} patterns detected`)

  // Endpoints with auth
  const authEndpoints = meta.endpoints.filter(e => e.authType)
  if (authEndpoints.length > 0) {
    lines.push('')
    lines.push('### Authenticated Endpoints')
    for (const ep of authEndpoints.slice(0, 10)) {
      lines.push(`- ${ep.method} ${ep.path} — auth: ${ep.authType}, params: ${ep.params.length}`)
    }
  }

  // Secrets
  if (meta.secrets.length > 0) {
    lines.push('')
    lines.push('### Discovered Secrets')
    for (const s of meta.secrets.slice(0, 10)) {
      lines.push(`- ${s.type} in ${s.location}: ${s.name} = ${s.value}`)
    }
  }

  // Data flows
  if (meta.dataFlows.length > 0) {
    lines.push('')
    lines.push('### Data Flow Patterns')
    for (const f of meta.dataFlows.slice(0, 10)) {
      lines.push(`- ${f.source.location}(${f.source.name}) → ${f.sink.location}(${f.sink.name}) [${f.type}]`)
    }
  }

  // Hypotheses
  if (meta.hypotheses.length > 0) {
    lines.push('')
    lines.push('### Attack Hypotheses (from traffic analysis)')
    for (const h of meta.hypotheses) {
      lines.push(`- [${h.confidence.toFixed(1)}] ${h.title}: ${h.attackVector} (targets ${h.targetEndpoints.length} endpoints)`)
    }
  }

  // XHR business logic
  const withHidden = meta.xhrBodies.filter(x => x.hiddenFields.length > 0)
  const withGaps = meta.xhrBodies.filter(x => x.validationGaps.length > 0)
  if (withHidden.length > 0 || withGaps.length > 0) {
    lines.push('')
    lines.push('### XHR Business Logic Observations')
    for (const xhr of withHidden) {
      lines.push(`- ${xhr.method} ${xhr.path}: hidden fields — ${xhr.hiddenFields.join(', ')}`)
    }
    for (const xhr of withGaps) {
      lines.push(`- ${xhr.method} ${xhr.path}: validation gaps — ${xhr.validationGaps.join(', ')}`)
    }
  }

  lines.push('')
  lines.push('Use this data to guide your next attack. Focus on endpoints with auth gaps, hidden fields, and the highest-confidence hypotheses.')

  return lines.join('\n')
}
