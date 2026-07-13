/**
 * Cross-Engagement Pattern Memory — OPTIONAL privacy-preserving learner.
 *
 * This module aggregates ANONYMIZED, structural patterns across engagements so
 * the strategist/planner can prioritize where techniques have historically
 * fired. The privacy guarantee is enforced structurally:
 *
 *   • NEVER persists raw URLs, hostnames, secrets, or target identifiers.
 *   • Only stores path-token SHAPES (e.g. `/api/{resource}/:id`), parameter
 *     NAMES, technique ids, and aggregate COUNTS.
 *   • `targetOrigin` is accepted at record time ONLY as a scoping guard
 *     (mirrors reflexion-store.ts) and is NEVER written to the store.
 *
 * Persisted to a SEPARATE global JSON file (see WorkspaceManager.getCrossEngagementPath),
 * intentionally NOT the per-target GraphStore, so learning survives across
 * engagements instead of being wiped on `switchTarget`.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGlobalWorkspace } from '../workspace'
import type { GraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'

// ─── Privacy guards ──────────────────────────────────────────────────

// Absolute URLs must never enter the store.
const RAW_URL_RE = /https?:\/\/[^\s"'`)]+/i
// Bare hostnames (e.g. "example.com", "api.target.io") must never be stored.
// Restricted to a known TLD set so dotted technique ids like "sql.injection"
// are not false-positively rejected.
const KNOWN_TLDS = ['com', 'net', 'org', 'io', 'dev', 'app', 'co', 'us', 'eu', 'xyz', 'sh', 'ai', 'gov', 'edu', 'info', 'biz', 'me', 'cloud', 'local', 'internal', 'example', 'test']
const HOSTNAME_RE = new RegExp(
  `(^|[\\s"'\`(]|\\b)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${KNOWN_TLDS.join('|')})(?=[\\s"'\`)/?#]|$)`,
  'i',
)

function assertNoIdentity(value: unknown, path = 'root'): void {
  if (typeof value === 'string') {
    if (RAW_URL_RE.test(value)) {
      throw new Error(`[cross-engagement] privacy guard: raw URL rejected at ${path}: ${value.slice(0, 80)}`)
    }
    if (HOSTNAME_RE.test(value)) {
      throw new Error(`[cross-engagement] privacy guard: hostname/identity rejected at ${path}: ${value.slice(0, 80)}`)
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoIdentity(v, `${path}[${i}]`))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      assertNoIdentity(v, `${path}.${k}`)
    }
  }
}

// ─── Structural feature extraction (anonymization) ───────────────────

/**
 * Convert a raw URL into anonymized path tokens.
 * Strips origin, scheme, host, port, and query string. Replaces:
 *   • purely numeric segments        -> ':id'
 *   • uuid / long hex segments       -> ':token'
 *   • everything else                -> lowercased literal token
 */
export function anonymizePath(url: string): string[] {
  let path: string
  try {
    const withoutOrigin = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '')
    path = withoutOrigin.split('?')[0].split('#')[0]
  } catch {
    path = url.split('?')[0].split('#')[0]
  }
  const segments = path.split('/').filter(Boolean)
  return segments.map(seg => {
    const lower = seg.toLowerCase()
    if (/^\d+$/.test(seg)) return ':id'
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':token'
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':token'
    return lower
  })
}

export function shapeSignature(tokens: string[]): string {
  return '/' + tokens.join('/')
}

/** Extract parameter names from a URL query string. */
export function extractQueryParamNames(url: string): string[] {
  const qIndex = url.indexOf('?')
  if (qIndex < 0) return []
  const query = url.slice(qIndex + 1)
  const names = new Set<string>()
  for (const pair of query.split('&')) {
    if (!pair) continue
    const name = pair.split('=')[0]
    if (name) names.add(name)
  }
  return [...names]
}

// ─── Public types ────────────────────────────────────────────────────

export interface EndpointShape {
  /** Anonymized path tokens, e.g. ['api', 'users', ':id'] */
  pathTokens: string[]
  method: string
  /** Parameter names only (never values) */
  paramNames: string[]
}

export interface EngagementTechniqueObservation {
  techniqueId: string
  fired: boolean
  confidence?: number
  endpointShape?: EndpointShape
}

export interface EngagementFinding {
  vulnType: string
  techniqueId: string
  confidence: number
  endpointShape?: EndpointShape
}

export interface EngagementSummary {
  /**
   * Origin (scheme://host) used ONLY as a scoping guard — exactly like
   * reflexion-store.ts. It is consumed but NEVER persisted.
   */
  targetOrigin: string
  techniques: EngagementTechniqueObservation[]
  findings: EngagementFinding[]
  /** Free-form failure category strings (low cardinality, structural). */
  failedPatterns: string[]
  /** Effective primitive/technique id sequences that worked. */
  effectiveSequences: string[][]
}

// ─── Aggregated store shape (the only thing persisted) ───────────────

interface TechniqueStat {
  engagements: number
  fired: number
  firingRate: number
}

interface ShapeStat {
  occurrences: number
  /** techniqueId -> times it fired on this shape */
  techniqueFires: Record<string, number>
}

interface ParamStat {
  occurrences: number
  /** techniqueId -> times it was associated with this param */
  associatedTechniques: Record<string, number>
}

interface SequenceStat {
  sequence: string[]
  occurrences: number
  successRate: number
}

interface AggregatedMemory {
  version: number
  engagements: number
  techniques: Record<string, TechniqueStat>
  endpointShapes: Record<string, ShapeStat>
  paramNames: Record<string, ParamStat>
  effectiveSequences: SequenceStat[]
  failurePatterns: Record<string, number>
}

function emptyMemory(): AggregatedMemory {
  return {
    version: 1,
    engagements: 0,
    techniques: {},
    endpointShapes: {},
    paramNames: {},
    effectiveSequences: [],
    failurePatterns: {},
  }
}

// ─── CrossEngagementMemory ───────────────────────────────────────────

export class CrossEngagementMemory {
  private mem: AggregatedMemory
  private readonly path: string
  private loaded = false

  constructor(opts?: { path?: string }) {
    this.path = opts?.path || getGlobalWorkspace().getCrossEngagementPath()
    this.mem = emptyMemory()
  }

  /** Load aggregated memory from the global file (no-op if absent). */
  async load(): Promise<void> {
    if (this.loaded) return
    if (existsSync(this.path)) {
      try {
        const raw = await readFile(this.path, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AggregatedMemory>
        this.mem = { ...emptyMemory(), ...parsed }
      } catch {
        this.mem = emptyMemory()
      }
    }
    this.loaded = true
  }

  /** Persist aggregated memory to the separate global file. */
  async save(): Promise<void> {
    const dir = resolve(this.path, '..')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(this.path, JSON.stringify(this.mem, null, 2), 'utf-8')
  }

  getEngagementCount(): number {
    return this.mem.engagements
  }

  /**
   * Record an engagement's anonymized summary. The `targetOrigin` is
   * validated as a scoping token but never stored. All other fields are
   * privacy-checked before aggregation.
   */
  async recordEngagementSummary(summary: EngagementSummary): Promise<void> {
    await this.load()

    // Hard privacy guard: reject any raw URL / hostname anywhere in the summary.
    // NOTE: targetOrigin is a scoping token (like reflexion-store.ts) and is
    // intentionally EXCLUDED from the guard + never persisted.
    assertNoIdentity(summary.techniques)
    assertNoIdentity(summary.findings)
    assertNoIdentity(summary.failedPatterns)
    assertNoIdentity(summary.effectiveSequences)

    this.mem.engagements += 1

    // Techniques observed (fired or attempted)
    for (const obs of summary.techniques) {
      const stat = this.mem.techniques[obs.techniqueId] || { engagements: 0, fired: 0, firingRate: 0 }
      stat.engagements += 1
      if (obs.fired) {
        stat.fired += 1
        if (obs.endpointShape) {
          this.recordShapeFire(obs.endpointShape, obs.techniqueId)
          for (const p of obs.endpointShape.paramNames) {
            this.recordParam(p, obs.techniqueId)
          }
        }
      }
      stat.firingRate = stat.engagements > 0 ? stat.fired / stat.engagements : 0
      this.mem.techniques[obs.techniqueId] = stat
    }

    // Findings (technique definitely fired on a shape)
    for (const f of summary.findings) {
      const stat = this.mem.techniques[f.techniqueId] || { engagements: 0, fired: 0, firingRate: 0 }
      stat.engagements += 1
      stat.fired += 1
      stat.firingRate = stat.engagements > 0 ? stat.fired / stat.engagements : 0
      this.mem.techniques[f.techniqueId] = stat
      if (f.endpointShape) {
        this.recordShapeFire(f.endpointShape, f.techniqueId)
        for (const p of f.endpointShape.paramNames) {
          this.recordParam(p, f.techniqueId)
        }
      }
    }

    // Failure patterns (structural categories only)
    for (const fp of summary.failedPatterns) {
      this.mem.failurePatterns[fp] = (this.mem.failurePatterns[fp] || 0) + 1
    }

    // Effective sequences
    for (const seq of summary.effectiveSequences) {
      if (seq.length === 0) continue
      const key = seq.join('>')
      const existing = this.mem.effectiveSequences.find(s => s.sequence.join('>') === key)
      if (existing) {
        existing.occurrences += 1
      } else {
        this.mem.effectiveSequences.push({ sequence: seq, occurrences: 1, successRate: 1 })
      }
    }

    await this.save()
  }

  private recordShapeFire(shape: EndpointShape, techniqueId: string): void {
    const sig = shapeSignature(shape.pathTokens)
    const stat = this.mem.endpointShapes[sig] || { occurrences: 0, techniqueFires: {} }
    stat.occurrences += 1
    stat.techniqueFires[techniqueId] = (stat.techniqueFires[techniqueId] || 0) + 1
    this.mem.endpointShapes[sig] = stat
  }

  private recordParam(param: string, techniqueId: string): void {
    const stat = this.mem.paramNames[param] || { occurrences: 0, associatedTechniques: {} }
    stat.occurrences += 1
    stat.associatedTechniques[techniqueId] = (stat.associatedTechniques[techniqueId] || 0) + 1
    this.mem.paramNames[param] = stat
  }

  /**
   * Return anonymized priors the planner/selector can use to prioritize.
   * When `vulnType` is supplied, results are biased toward techniques/shapes
   * associated with that vulnerability class.
   */
  getPriorPatterns(vulnType?: string): PriorPatterns {
    const vt = vulnType?.toLowerCase().trim() || ''

    const allTechniques = Object.entries(this.mem.techniques)
      .map(([techniqueId, s]) => ({
        techniqueId,
        firedIn: s.fired,
        firingRate: s.firingRate,
      }))
      .sort((a, b) => b.firingRate - a.firingRate)

    const topTechniques = vt
      ? allTechniques.filter(t => t.techniqueId.toLowerCase().includes(vt))
      : allTechniques.slice(0, 12)

    const vulnerableShapes = Object.entries(this.mem.endpointShapes)
      .map(([shape, s]) => ({
        shape,
        occurrences: s.occurrences,
        techniques: Object.entries(s.techniqueFires)
          .sort((a, b) => b[1] - a[1])
          .filter(([t]) => !vt || t.toLowerCase().includes(vt))
          .map(([t]) => t),
      }))
      .filter(s => s.techniques.length > 0)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 12)

    const commonParams = Object.entries(this.mem.paramNames)
      .map(([param, s]) => ({
        param,
        occurrences: s.occurrences,
        associatedTechniques: Object.entries(s.associatedTechniques)
          .sort((a, b) => b[1] - a[1])
          .filter(([t]) => !vt || t.toLowerCase().includes(vt))
          .map(([t]) => t),
      }))
      .filter(p => p.associatedTechniques.length > 0)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 12)

    const failurePatterns = Object.entries(this.mem.failurePatterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p]) => p)

    const effectiveSequences = this.mem.effectiveSequences
      .slice()
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 8)

    return {
      engagementCount: this.mem.engagements,
      vulnType: vt || undefined,
      topTechniques,
      vulnerableShapes,
      commonParams,
      failurePatterns,
      effectiveSequences,
      promptBlock: this.toPromptBlock(vt, topTechniques, vulnerableShapes, commonParams, failurePatterns, effectiveSequences),
    }
  }

  private toPromptBlock(
    vt: string,
    techniques: PriorPatterns['topTechniques'],
    shapes: PriorPatterns['vulnerableShapes'],
    params: PriorPatterns['commonParams'],
    failures: string[],
    sequences: PriorPatterns['effectiveSequences'],
  ): string {
    if (this.mem.engagements === 0) {
      return '[cross-engagement] No prior engagements recorded yet. Patterns will accumulate across runs (anonymized).'
    }
    const lines: string[] = [
      `[cross-engagement] Aggregated over ${this.mem.engagements} engagements (anonymized, no target identity stored).`,
    ]
    if (vt) lines.push(`Prioritized for vulnType="${vt}".`)
    if (techniques.length > 0) {
      lines.push('- Techniques by historical firing rate (techniqueId: firedIn/rate):')
      for (const t of techniques.slice(0, 8)) {
        lines.push(`    • ${t.techniqueId}: fired ${t.firedIn}x (${(t.firingRate * 100).toFixed(0)}%)`)
      }
    }
    if (shapes.length > 0) {
      lines.push('- Endpoint shapes where techniques historically fired:')
      for (const s of shapes.slice(0, 6)) {
        lines.push(`    • ${s.shape} <- ${s.techniques.join(', ')}`)
      }
    }
    if (params.length > 0) {
      lines.push('- Parameter names commonly associated with findings:')
      for (const p of params.slice(0, 6)) {
        lines.push(`    • ${p.param} <- ${p.associatedTechniques.join(', ')}`)
      }
    }
    if (sequences.length > 0) {
      lines.push('- Effective primitive sequences observed:')
      for (const seq of sequences.slice(0, 4)) {
        lines.push(`    • ${seq.sequence.join(' → ')} (${seq.occurrences}x)`)
      }
    }
    if (failures.length > 0) {
      lines.push('- Common failure patterns to avoid: ' + failures.join(', '))
    }
    return lines.join('\n')
  }
}

export interface PriorPatterns {
  engagementCount: number
  vulnType?: string
  topTechniques: Array<{ techniqueId: string; firedIn: number; firingRate: number }>
  vulnerableShapes: Array<{ shape: string; occurrences: number; techniques: string[] }>
  commonParams: Array<{ param: string; occurrences: number; associatedTechniques: string[] }>
  failurePatterns: string[]
  effectiveSequences: Array<{ sequence: string[]; occurrences: number; successRate: number }>
  promptBlock: string
}

/**
 * Lightweight hook: build an anonymized EngagementSummary from a per-target
 * GraphStore and record it. ONLY structural features are extracted — raw URLs
 * never leave this function. The `targetOrigin` is used as a scoping token and
 * is never persisted.
 *
 * Intended to be called at engagement end (e.g. from lifecycle cleanup), but
 * lifecycle.ts is intentionally NOT modified here; callers opt in.
 */
export async function finalizeEngagementMemory(
  store: GraphStore,
  targetOrigin: string,
): Promise<void> {
  const endpoints = store.queryNodes(NodeType.ENDPOINT) as unknown as Array<{
    properties: { url: string; method: string; params: Array<{ name: string }> }
  }>

  const endpointShapeByUrl = new Map<string, EndpointShape>()
  for (const e of endpoints) {
    const url = e.properties.url
    const paramNames = [
      ...(e.properties.params || []).map(p => p.name).filter(Boolean),
      ...extractQueryParamNames(url),
    ]
    endpointShapeByUrl.set(url, {
      pathTokens: anonymizePath(url),
      method: (e.properties.method || 'GET').toUpperCase(),
      paramNames,
    })
  }

  const findings = store.queryNodes(NodeType.FINDING) as unknown as Array<{
    properties: { technique: string; endpoint: string; confidence: number; vulnType?: string }
  }>

  const techniqueIds = new Set<string>()
  const observations: EngagementTechniqueObservation[] = []
  const summaryFindings: EngagementFinding[] = []

  for (const f of findings) {
    const techniqueId = f.properties.technique || 'unknown'
    techniqueIds.add(techniqueId)
    const shape = endpointShapeByUrl.get(f.properties.endpoint)
    summaryFindings.push({
      vulnType: f.properties.vulnType || techniqueId,
      techniqueId,
      confidence: f.properties.confidence ?? 0,
      endpointShape: shape,
    })
  }

  for (const id of techniqueIds) {
    observations.push({ techniqueId: id, fired: true })
  }

  const summary: EngagementSummary = {
    targetOrigin,
    techniques: observations,
    findings: summaryFindings,
    failedPatterns: [],
    effectiveSequences: [],
  }

  const mem = new CrossEngagementMemory()
  await mem.recordEngagementSummary(summary)
}
