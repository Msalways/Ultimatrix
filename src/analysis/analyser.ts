/**
 * Business-Logic Analyser — Phase 1
 *
 * Produces structured, evidence-backed graph artifacts from captured HAR traffic
 * (and optional human-observer / reaction-observer inputs):
 *
 *  - T1.1 Value-provenance graph  -> VALUE_ORIGIN edges
 *  - T1.2 Custom-header classifier -> HeaderSemanticNode
 *  - T1.3 Auth decode + reuse      -> AuthSchemeNode (masked credentials only)
 *  - T1.4 Use-case + invariant     -> EndpointNode.useCase/preconditions + FactNode invariants
 *
 * All secrets are masked before being written to the graph. No raw credentials
 * are ever persisted.
 */

import { createHash } from 'node:crypto'
import { NodeType, EdgeType } from '../graph/schema'
import type {
  HeaderSemanticNode,
  AuthSchemeNode,
  EndpointNode,
  AnyNodeData,
  AuthScheme,
} from '../graph/schema'
import type { GraphStore } from '../graph/store'
import { buildReingestEdges } from '../graph/relations'
import {
  getEndpointsWithHeaders,
  getDataFlows,
  parseHar,
  type EndpointWithHeaders,
  type DataFlow,
  type HarEntry,
  type HarArchive,
} from '../capture/har-parser'
import type { HumanAction } from '../capture/human-observer'
import type { Reaction } from '../browser/reaction-observer'
import { encodeDecode } from '../tools/encode-decode'
import { log } from '../utils/logger'

// ── Shared helpers ──────────────────────────────────────────────────

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function maskCredential(value: string): string {
  if (!value) return '***'
  if (value.length <= 8) return value[0] + '*'.repeat(value.length - 1)
  return value.slice(0, 4) + '…' + value.slice(-4)
}

// ── Public types ───────────────────────────────────────────────────

export type ValueOriginSourceKind =
  | 'response-field'
  | 'response-header'
  | 'response-body'
  | 'cookie'
  | 'ui-input'

export interface ValueOriginSource {
  kind: ValueOriginSourceKind
  name: string
  entryIndex: number
  endpointUrl?: string
  selector?: string
}

export interface ValueOriginSink {
  kind: 'request-param' | 'request-header' | 'request-cookie'
  name: string
  entryIndex: number
  method: string
  url: string
}

export interface ValueOriginEdge {
  source: ValueOriginSource
  sink: ValueOriginSink
  valueSample: string
}

export interface AnalysisOptions {
  humanActions?: HumanAction[]
  reactions?: Reaction[]
  targetUrl?: string
}

export interface UseCaseInvariant {
  description: string
  confidence: number
}

export interface UseCaseResult {
  url: string
  method: string
  useCase: string
  preconditions: string[]
  invariants: UseCaseInvariant[]
}

export interface UseCaseInput {
  endpoints: EndpointWithHeaders[]
  entries: HarEntry[]
  humanActions?: HumanAction[]
  reactions?: Reaction[]
}

// ── T1.2 — Custom-header classifier ───────────────────────────────

const IDENTITY_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-apikey',
  'x-auth-token',
  'x-auth',
  'x-access-token',
  'proxy-authorization',
]

const CORRELATION_HEADERS = [
  'x-request-id',
  'x-requestid',
  'x-trace-id',
  'x-traceid',
  'x-correlation-id',
  'x-correlationid',
  'x-amzn-trace-id',
]

function isAntiBot(name: string): boolean {
  const n = name.toLowerCase()
  if (n.startsWith('cf-')) return true
  if (n.startsWith('sec-')) return true
  if (n.startsWith('x-akama')) return true
  if (n.includes('bot') || n.includes('captcha') || n.includes('fingerprint')) return true
  if (n === 'x-request-id') return true
  return false
}

interface HeaderRoleCtx {
  required: boolean
  constantValue: boolean
}

function headerRole(
  name: string,
  _value: string,
  ctx: HeaderRoleCtx,
): { role: HeaderSemanticNode['properties']['role']; confidence: number } {
  const n = name.toLowerCase()

  if (IDENTITY_HEADERS.includes(n)) return { role: 'identity', confidence: 0.9 }
  if (CORRELATION_HEADERS.some(c => n === c || n.startsWith(c.replace('*', '')))) {
    return { role: 'correlation', confidence: 0.85 }
  }
  if (isAntiBot(n)) return { role: 'anti-bot', confidence: 0.8 }
  if (ctx.required) return { role: 'required', confidence: 0.7 }
  if (ctx.constantValue) return { role: 'static', confidence: 0.6 }
  return { role: 'static', confidence: 0.4 }
}

export function classifyHeaders(endpoints: EndpointWithHeaders[]): HeaderSemanticNode[] {
  const nodes: HeaderSemanticNode[] = []
  if (endpoints.length === 0) return nodes

  const authCount = endpoints.filter(e => e.authType).length
  const present = new Map<string, Set<number>>()
  const values = new Map<string, Set<string>>()

  endpoints.forEach((ep, idx) => {
    for (const h of Object.keys(ep.headers)) {
      if (!present.has(h)) present.set(h, new Set())
      present.get(h)!.add(idx)
      if (!values.has(h)) values.set(h, new Set())
      values.get(h)!.add(ep.headers[h])
    }
  })

  const isRequired = (name: string) =>
    authCount > 0 && (present.get(name)?.size ?? 0) >= authCount
  const isConstant = (name: string) => {
    const v = values.get(name)
    return !!v && v.size === 1 && !v.has('')
  }

  for (const ep of endpoints) {
    for (const [name, value] of Object.entries(ep.headers)) {
      const { role, confidence } = headerRole(name, value, {
        required: isRequired(name),
        constantValue: isConstant(name),
      })
      const node: HeaderSemanticNode = {
        id: `headersemantic:${hash(ep.url + ep.method + name)}`,
        type: NodeType.HEADER_SEMANTIC,
        label: `Header ${role}: ${name}`,
        properties: {
          header: name,
          role,
          endpoint: ep.url,
          confidence,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      nodes.push(node)
    }
  }

  return nodes
}

// ── T1.3 — Auth decode + reuse ─────────────────────────────────────

async function tryDecode(
  value: string,
): Promise<{ scheme: AuthScheme | null; decoded: boolean }> {
  if (value.split('.').length >= 2) {
    try {
      const r: any = await encodeDecode.execute({ operation: 'jwt_decode', data: value })
      if (r?.ok) return { scheme: 'jwt', decoded: true }
    } catch {
      /* not a jwt */
    }
  }
  try {
    const r: any = await encodeDecode.execute({ operation: 'base64_decode', data: value })
    if (
      r?.ok &&
      typeof r.result === 'string' &&
      r.result.length > 0 &&
      r.result !== value &&
      /^[\x20-\x7e]+$/.test(r.result)
    ) {
      return { scheme: 'base64', decoded: true }
    }
  } catch {
    /* not base64 */
  }
  return { scheme: null, decoded: false }
}

async function resolveScheme(ah: {
  name: string
  value: string
  isCookie: boolean
}): Promise<{ scheme: AuthScheme; decoded: boolean }> {
  const n = ah.name.toLowerCase()
  const v = ah.value

  if (ah.isCookie) return { scheme: 'cookie', decoded: false }
  if (n.includes('api-key') || n.includes('apikey')) return { scheme: 'api-key', decoded: false }

  const lower = v.toLowerCase()
  if (lower.startsWith('bearer ')) {
    const decoded = await tryDecode(v.slice(7))
    return { scheme: decoded.scheme === 'jwt' ? 'jwt' : 'bearer', decoded: decoded.decoded }
  }
  if (lower.startsWith('basic ')) return { scheme: 'basic', decoded: false }
  if (n.includes('auth')) {
    const decoded = await tryDecode(v)
    return { scheme: decoded.scheme ?? 'custom', decoded: decoded.decoded }
  }

  const decoded = await tryDecode(v)
  return { scheme: decoded.scheme ?? 'api-key', decoded: decoded.decoded }
}

export async function analyzeAuth(
  endpoints: EndpointWithHeaders[],
): Promise<AuthSchemeNode[]> {
  interface Cred {
    scheme: AuthScheme
    endpointUrl: string
    masked: string
    decoded: boolean
  }
  const creds: Cred[] = []

  for (const ep of endpoints) {
    const authHeaders: Array<{ name: string; value: string; isCookie: boolean }> = []

    if (ep.authType === 'cookie') {
      for (const [k, v] of Object.entries(ep.cookies)) {
        authHeaders.push({ name: k, value: v, isCookie: true })
      }
    } else {
      for (const [k, v] of Object.entries(ep.headers)) {
        const n = k.toLowerCase()
        if (
          n === 'authorization' ||
          n === 'proxy-authorization' ||
          n.includes('api-key') ||
          n.includes('apikey') ||
          n.includes('auth')
        ) {
          authHeaders.push({ name: k, value: v, isCookie: false })
        }
      }
    }

    for (const ah of authHeaders) {
      const { scheme, decoded } = await resolveScheme(ah)
      creds.push({
        scheme,
        endpointUrl: ep.url,
        masked: maskCredential(ah.value),
        decoded,
      })
    }
  }

  const groups = new Map<string, Cred[]>()
  for (const c of creds) {
    const key = `${c.scheme}::${c.masked}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  const nodes: AuthSchemeNode[] = []
  for (const [key, list] of groups) {
    const [scheme] = key.split('::')
    const endpointUrls = [...new Set(list.map(c => c.endpointUrl))]
    const node: AuthSchemeNode = {
      id: `authscheme:${hash(key)}`,
      type: NodeType.AUTH_SCHEME,
      label: `Auth scheme: ${scheme}`,
      properties: {
        scheme: scheme as AuthScheme,
        decoded: list.some(c => c.decoded),
        maskedCredential: list[0].masked,
        reusedAcross: endpointUrls.length > 1 ? endpointUrls : undefined,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    nodes.push(node)
  }

  return nodes
}

// ── T1.1 — Value-provenance graph ─────────────────────────────────

function mapSourceKind(loc: string): ValueOriginSourceKind {
  switch (loc) {
    case 'cookie':
      return 'cookie'
    case 'header':
    case 'response-header':
      return 'response-header'
    case 'response-body':
      return 'response-body'
    case 'ui-input':
      return 'ui-input'
    default:
      return 'response-field'
  }
}

function responseBodyKeys(text?: string): string[] {
  if (!text) return []
  try {
    const o = JSON.parse(text)
    if (o && typeof o === 'object' && !Array.isArray(o)) return Object.keys(o)
    if (Array.isArray(o) && o.length && typeof o[0] === 'object') return Object.keys(o[0])
  } catch {
    /* not json */
  }
  return []
}

/**
 * Enrich provenance flows from raw HAR entries: cookie/header reuse (via
 * getDataFlows) plus response-body key/value reuse and human-observer input
 * correlation.
 */
function buildProvenanceFlows(
  entries: HarEntry[],
  humanActions?: HumanAction[],
): DataFlow[] {
  const flows: DataFlow[] = []
  flows.push(...getDataFlows(entries))

  // Prior response values available for reuse.
  const priorSources: Array<{ entryIndex: number; location: string; name: string; value: string }> = []
  for (let i = 0; i < entries.length; i++) {
    const resp = entries[i].response
    for (const k of responseBodyKeys(resp.content?.text)) {
      priorSources.push({ entryIndex: i, location: 'response-body', name: k, value: k })
    }
    for (const h of resp.headers) {
      priorSources.push({ entryIndex: i, location: 'response-header', name: h.name, value: h.value })
    }
    for (const c of resp.cookies) {
      priorSources.push({ entryIndex: i, location: 'cookie', name: c.name, value: c.value })
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const req = entries[i].request
    const sinks: Array<{ location: string; name: string; value: string }> = []
    for (const q of req.queryString) sinks.push({ location: 'param', name: q.name, value: q.value })
    if (req.postData?.params) {
      for (const p of req.postData.params) sinks.push({ location: 'param', name: p.name, value: p.value ?? '' })
    }
    for (const h of req.headers) sinks.push({ location: 'header', name: h.name, value: h.value })

    for (const s of sinks) {
      if (!s.value) continue
      for (const src of priorSources) {
        if (src.entryIndex >= i) continue
        if (src.value && src.value.length > 3 && s.value.includes(src.value)) {
          flows.push({
            source: { entryIndex: src.entryIndex, location: src.location, name: src.name },
            sink: { entryIndex: i, location: s.location, name: s.name },
            value: s.value,
            type: src.location === 'cookie' ? 'cookie' : 'header',
          })
          break
        }
      }
    }
  }

  // Human-observer inputs -> later request reuse.
  if (humanActions) {
    for (const a of humanActions) {
      if (a.type !== 'fill' || !a.value || a.value === '***') continue
      for (let i = 0; i < entries.length; i++) {
        const req = entries[i].request
        const pool = [
          ...req.queryString.map(q => q.value),
          ...(req.postData?.params ?? []).map(p => p.value ?? ''),
          ...req.headers.map(h => h.value),
        ]
        if (pool.some(v => v && v.includes(a.value!))) {
          flows.push({
            source: { entryIndex: 0, location: 'ui-input', name: a.selector ?? a.type },
            sink: { entryIndex: i, location: 'param', name: a.selector ?? 'value' },
            value: a.value,
            type: 'param',
          })
          break
        }
      }
    }
  }

  return flows
}

export function deriveValueOrigins(
  flows: DataFlow[],
  entries?: HarEntry[],
): ValueOriginEdge[] {
  const out: ValueOriginEdge[] = []
  const seen = new Set<string>()

  for (const f of flows) {
    const srcKind = mapSourceKind(f.source.location)
    const sinkKind: ValueOriginSink['kind'] =
      f.sink.location === 'cookie'
        ? 'request-cookie'
        : f.sink.location === 'param'
          ? 'request-param'
          : 'request-header'

    let method = ''
    let url = ''
    if (entries && entries[f.sink.entryIndex]) {
      const req = entries[f.sink.entryIndex].request
      try {
        const u = new URL(req.url)
        url = `${u.origin}${u.pathname}`
        method = req.method
      } catch {
        /* skip */
      }
    }

    let srcUrl: string | undefined
    if (entries && entries[f.source.entryIndex]) {
      try {
        const u = new URL(entries[f.source.entryIndex].request.url)
        srcUrl = `${u.origin}${u.pathname}`
      } catch {
        /* skip */
      }
    }

    const key = `${srcKind}:${f.source.name}:${sinkKind}:${f.sink.name}:${url}`
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      source: {
        kind: srcKind,
        name: f.source.name,
        entryIndex: f.source.entryIndex,
        endpointUrl: srcUrl,
        selector: srcKind === 'ui-input' ? f.source.name : undefined,
      },
      sink: {
        kind: sinkKind,
        name: f.sink.name,
        entryIndex: f.sink.entryIndex,
        method,
        url,
      },
      valueSample: f.value,
    })
  }

  return out
}

// ── T1.4 — Use-case + invariant derivation ────────────────────────

const USECASE_MAP: Record<string, string> = {
  login: 'login',
  logout: 'logout',
  signin: 'login',
  signup: 'registration',
  register: 'registration',
  user: 'user-account operation',
  users: 'user management',
  account: 'account operation',
  admin: 'administrative operation',
  profile: 'profile management',
  settings: 'settings management',
  search: 'search',
  create: 'resource creation',
  add: 'resource creation',
  new: 'resource creation',
  update: 'resource update',
  edit: 'resource update',
  modify: 'resource update',
  delete: 'resource deletion',
  remove: 'resource deletion',
  list: 'resource listing',
  get: 'resource retrieval',
  fetch: 'resource retrieval',
  upload: 'file upload',
  download: 'file download',
  export: 'data export',
  import: 'data import',
  order: 'order operation',
  payment: 'payment operation',
  cart: 'cart operation',
  checkout: 'checkout operation',
  api: 'API call',
  token: 'token operation',
  auth: 'authentication operation',
  password: 'password operation',
  reset: 'credential reset',
  verify: 'verification',
  send: 'submission',
  submit: 'form submission',
}

function inferUseCase(ep: EndpointWithHeaders, humanActions: HumanAction[] = []): string {
  const path = ep.path.toLowerCase()
  const method = ep.method.toUpperCase()
  const tokens = path.split('/').filter(Boolean)
  const clues = new Set<string>()
  for (const t of tokens) {
    for (const [k, v] of Object.entries(USECASE_MAP)) {
      if (t.includes(k)) clues.add(v)
    }
  }
  let base = clues.size ? [...clues].join(' / ') : 'resource operation'

  const epHost = safeHost(ep.url)
  const hasForm = humanActions.some(
    a =>
      a.url &&
      safeHost(a.url) === epHost &&
      (a.type === 'fill' || a.type === 'submit' || a.type === 'click'),
  )
  if (hasForm) base = `user-driven ${base}`

  return `${method} ${base}`.trim()
}

function intersect(sets: string[][]): string[] {
  if (!sets.length) return []
  let acc = new Set(sets[0])
  for (let i = 1; i < sets.length; i++) {
    const s = new Set(sets[i])
    acc = new Set([...acc].filter(x => s.has(x)))
  }
  return [...acc]
}

export function deriveUseCasesAndInvariants(input: UseCaseInput): UseCaseResult[] {
  const { endpoints, entries, humanActions = [], reactions = [] } = input

  const groups = new Map<string, HarEntry[]>()
  for (const e of entries) {
    try {
      const u = new URL(e.request.url)
      const k = `${e.request.method.toUpperCase()}:${u.origin}${u.pathname}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(e)
    } catch {
      /* skip */
    }
  }

  const results: UseCaseResult[] = []

  for (const ep of endpoints) {
    const key = `${ep.method.toUpperCase()}:${ep.url}`
    const grp = groups.get(key) ?? []
    const useCase = inferUseCase(ep, humanActions)

    const preconditions: string[] = []
    if (ep.authType) preconditions.push(`Requires authentication (${ep.authType})`)
    const reqParams = ep.params.filter(p => p.required)
    if (reqParams.length) {
      preconditions.push(`Requires parameters: ${reqParams.map(p => p.name).join(', ')}`)
    }

    const invariants: UseCaseInvariant[] = []
    if (ep.authType) {
      invariants.push({
        description: `Authentication required to access ${ep.method} ${ep.path}`,
        confidence: 0.8,
      })
    }

    if (grp.length) {
      const statuses = grp.map(g => g.response.status)
      if (statuses.every(s => s >= 200 && s < 300)) {
        invariants.push({
          description: `Endpoint ${ep.method} ${ep.path} consistently returns HTTP 2xx`,
          confidence: 0.7,
        })
      } else if (statuses.some(s => s >= 400)) {
        invariants.push({
          description: `Endpoint ${ep.method} ${ep.path} sometimes returns errors (${[...new Set(statuses)].join(', ')})`,
          confidence: 0.6,
        })
      }

      const fieldSets = grp.map(g => responseBodyKeys(g.response.content?.text))
      const common = intersect(fieldSets)
      for (const f of common.slice(0, 10)) {
        invariants.push({
          description: `Response of ${ep.method} ${ep.path} always includes field "${f}"`,
          confidence: fieldSets.length > 1 ? 0.7 : 0.5,
        })
      }
    }

    if (reactions.length && humanActions.length) {
      const epHost = safeHost(ep.url)
      const related = humanActions.some(a => a.url && safeHost(a.url) === epHost)
      if (related) {
        const r = reactions[0]
        invariants.push({
          description: `Observed DOM reaction after user interaction with ${ep.path}: [${r.type}] ${r.content}`,
          confidence: 0.5,
        })
      }
    }

    results.push({ url: ep.url, method: ep.method, useCase, preconditions, invariants })
  }

  return results
}

// ── Orchestration ─────────────────────────────────────────────────

function endpointKey(method: string, url: string): string {
  return `${method.toUpperCase()}:${url}`
}

async function getOrCreateSourceNode(
  store: GraphStore,
  source: ValueOriginSource,
): Promise<string> {
  if (source.kind === 'ui-input') {
    const id = `input:human:${hash(source.selector ?? source.name)}`
    const node: AnyNodeData = {
      id,
      type: NodeType.INPUT,
      label: `UI input: ${source.selector ?? source.name}`,
      properties: {
        selector: source.selector ?? source.name,
        inputType: 'text',
        name: source.name,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return store.upsertNode(node).id
  }

  const fact = store.addFact({
    description: `Value origin: ${source.name} (${source.kind}) from ${source.endpointUrl ?? 'prior response'}`,
    source: 'business-logic-analyser',
    confidence: 0.7,
  })
  return fact.id
}

/**
 * Run the full business-logic analysis pipeline and write all artifacts into
 * the provided graph store.
 *
 * Defensive by design: every sub-stage is isolated so a failure in one stage
 * cannot abort the others.
 */
export async function runAnalysis(
  graphStore: GraphStore,
  harData: HarArchive | string,
  options?: AnalysisOptions,
): Promise<void> {
  const archive: HarArchive = typeof harData === 'string' ? parseHar(harData) : harData
  const entries = archive.log.entries
  if (entries.length === 0) return

  const endpoints = getEndpointsWithHeaders(entries)

  const endpointNodes = graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
  const epIdMap = new Map<string, string>()
  for (const n of endpointNodes) {
    epIdMap.set(endpointKey(n.properties.method, n.properties.url), n.id)
  }

  // ── T1.2 Header semantics ───────────────────────────────────────
  try {
    for (const hn of classifyHeaders(endpoints)) {
      graphStore.upsertNode(hn)
    }
  } catch (err) {
    log.warn(`[analyser] header classification failed: ${(err as Error).message}`)
  }

  // ── T1.3 Auth schemes ───────────────────────────────────────────
  try {
    for (const an of await analyzeAuth(endpoints)) {
      graphStore.upsertNode(an)
    }
  } catch (err) {
    log.warn(`[analyser] auth analysis failed: ${(err as Error).message}`)
  }

  // ── T1.1 Value origins ──────────────────────────────────────────
  try {
    const flows = buildProvenanceFlows(entries, options?.humanActions)
    const origins = deriveValueOrigins(flows, entries)
    const reingestInputs: Array<{
      sourceEndpointUrl?: string
      sourceKind: string
      sinkMethod: string
      sinkUrl: string
      valueSample: string
    }> = []
    for (const o of origins) {
      const toId = epIdMap.get(endpointKey(o.sink.method, o.sink.url))
      if (!toId) continue
      const fromId = await getOrCreateSourceNode(graphStore, o.source)
      graphStore.addEdge({
        fromId,
        toId,
        type: EdgeType.VALUE_ORIGIN,
        properties: { kind: o.source.kind, valueSample: o.valueSample },
      })
      reingestInputs.push({
        sourceEndpointUrl: o.source.endpointUrl,
        sourceKind: o.source.kind,
        sinkMethod: o.sink.method,
        sinkUrl: o.sink.url,
        valueSample: o.valueSample,
      })
    }
    buildReingestEdges(graphStore, reingestInputs)
  } catch (err) {
    log.warn(`[analyser] value-origin analysis failed: ${(err as Error).message}`)
  }

  // ── T1.4 Use-case + invariants ──────────────────────────────────
  try {
    const results = deriveUseCasesAndInvariants({
      endpoints,
      entries,
      humanActions: options?.humanActions,
      reactions: options?.reactions,
    })
    for (const r of results) {
      const id = epIdMap.get(endpointKey(r.method, r.url))
      if (id) {
        const node = graphStore.getNode(id) as EndpointNode | undefined
        if (node) {
          const updated: EndpointNode = {
            ...node,
            properties: {
              ...node.properties,
              useCase: r.useCase,
              preconditions: r.preconditions,
            },
            updatedAt: Date.now(),
          }
          graphStore.upsertNode(updated)
        }
      }
      for (const inv of r.invariants) {
        graphStore.addFact({
          description: inv.description,
          source: 'business-logic-analyser',
          confidence: inv.confidence,
        })
      }
    }
  } catch (err) {
    log.warn(`[analyser] use-case analysis failed: ${(err as Error).message}`)
  }
}
