import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setTestFallback } from '../../src/runtime/engagement-context'
import { NodeType } from '../../src/graph/schema'
import { EvidenceLedger } from '../../src/intelligence/evidence-ledger'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { CapturedRequestStore } from '../../src/capture/captured-request-store'
import { SessionManager } from '../../src/http/session-manager'
import { coreEvidenceLedger } from '../../src/core/evidence'
import { getAllSkills, loadSkillBody, readSkillMarkdown } from '../../src/solver/skills/loader'
import { validateSkillMarkdown } from '../../src/solver/skills/validate'
import { resolvePrimitivesForSkills, resolveToolsForSkillsWorker } from '../../src/solver/skills/tool-filter'
import { listPrimitiveMetadata } from '../../src/primitives'
import { createPrimitiveRunner } from '../../src/campaign/runner'
import { planCampaign } from '../../src/campaign/planner'
import { runCampaign } from '../../src/campaign/executor'
import { httpRequest } from '../../src/tools/http-tools'
import { encodeDecode } from '../../src/tools/encode-decode'
import { loadSkillBodyTool, searchSkillTool } from '../../src/tools/skill-tools'
import { readReportTool } from '../../src/tools/report-tools'
import { ForensicLog } from '../../src/logging/forensic-log'
import { evaluateResearchExperiment } from '../../src/tools/research-tools'
import { writeFinding } from '../../src/tools/control-tools'

type RequestSpec = { method: string; url: string; headers?: Record<string, string>; body?: string }
type FixtureCase = {
  domain: string
  primitiveId: string
  path: string
  method: string
  input?: { name: string; location: string }
  authRequired?: boolean
  useCase?: string
  tags?: string[]
  authz?: boolean
  findingType: string
  attackRequest: RequestSpec
  makeUniqueProof: (origin: string, marker: string) => { baseline: RequestSpec; mutation: RequestSpec }
}

const allSkills = getAllSkills()
const allDomains = [...new Set(allSkills.map(skill => skill.domain))].sort()
const primitiveMetadata = listPrimitiveMetadata()

const config: any = {
  provider: 'domain-fixture',
  campaign: { auto: true, maxRequests: 100, maxDurationMs: 300_000, maxConcurrency: 1 },
  rateLimit: { requestsPerMinute: 1000, maxConcurrent: 1, retryOnLimit: false, maxRetries: 0 },
}

function createGraph(endpoint: any): any {
  const nodes = new Map<string, any>([[endpoint.id, endpoint]])
  const edges: any[] = []
  let findingSeq = 0
  let proofSeq = 0
  return {
    queryNodes: (type?: string) => [...nodes.values()].filter(node => !type || node.type === type),
    getNode: (id: string) => nodes.get(id),
    upsertNode: (node: any) => { nodes.set(node.id, node); return node },
    addFinding: (properties: any) => {
      const node = { id: `finding:fixture:${++findingSeq}`, type: NodeType.FINDING, label: properties.technique, properties, createdAt: Date.now(), updatedAt: Date.now() }
      nodes.set(node.id, node)
      return node
    },
    addExploitProof: (properties: any) => {
      const node = { id: `exploit-proof:fixture:${++proofSeq}`, type: NodeType.EXPLOIT_PROOF, label: properties.title, properties, createdAt: Date.now() }
      nodes.set(node.id, node)
      return node
    },
    addEdge: (edge: any) => { edges.push(edge); return edge },
    getAllEdges: () => edges,
    save: async () => {},
  }
}

function makeServices(graph: any) {
  const httpSessions = new SessionManager()
  const capturedRequests = new CapturedRequestStore()
  const services: any = {
    graph,
    httpSessions,
    capturedRequests,
    evidence: new EvidenceLedger(),
    providerLimiters: new Map(),
    scopeConfig: null,
    findingState: { evidenceBuffer: new Map(), evidenceGate: null },
    interactionBroker: { isActive: () => true, request: async () => 'yes' },
    campaignRequestBudget: undefined,
  }
  return services
}

async function listenLocal(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(value))
}

function readJson(body: string): Record<string, any> {
  try { return JSON.parse(body) as Record<string, any> } catch { return {} }
}

function fixtureHandler(req: IncomingMessage, res: ServerResponse, body: string): void {
  const url = new URL(req.url ?? '/', 'http://fixture.local')
  const headers = req.headers
  if (url.pathname === '/api/records') {
    const id = url.searchParams.get('id') ?? ''
    if (id.startsWith('proof-')) {
      const marker = id.slice('proof-'.length)
      return json(res, { id, tenantRecord: marker })
    }
    if (headers.authorization === 'Bearer victim') return json(res, { id, privateRecord: 'victim-record-secret' })
    return json(res, { error: 'forbidden', observedActor: headers.authorization ?? null }, 403)
  }
  if (url.pathname === '/auth/session') {
    const input = readJson(body)
    const marker = String(input.proof ?? '')
    if ((input.user === 'admin' && input.password === 'admin') || (typeof input.user === 'string' && /'\s*OR/i.test(input.user))) {
      res.setHeader('set-cookie', 'session=fixture-authenticated; HttpOnly')
      return json(res, { welcome: true, marker })
    }
    return json(res, { error: 'invalid credentials' }, 401)
  }
  if (url.pathname === '/cloud/fetch') {
    const target = url.searchParams.get('url') ?? ''
    if (target.includes('169.254.169.254')) {
      const marker = target.split('/').filter(Boolean).at(-1) ?? 'metadata'
      return json(res, { metadata: 'security-credentials', marker })
    }
    return json(res, { fetched: 'public resource' })
  }
  if (url.pathname === '/render') {
    const expression = url.searchParams.get('template') ?? ''
    const marker = expression.match(/}}-([a-z0-9-]+)/i)?.[1]
    return res.end(expression.includes('7*7') ? `49${marker ? `-${marker}` : ''}` : expression)
  }
  if (url.pathname === '/ai/agent') {
    const prompt = String(readJson(body).prompt ?? '')
    if (prompt.includes('safe-baseline')) return json(res, { answer: 'ordinary response' })
    return json(res, { tool_calls: [{ name: 'http_fetch', arguments: { url: 'http://fixture.local/canary' } }], prompt })
  }
  if (url.pathname === '/debug/item') {
    const id = url.searchParams.get('id') ?? ''
    if (id === '1') return json(res, { id, item: 'known' })
    res.statusCode = 500
    return res.end(`TypeError: undefined index ${id}; internal debug state`)
  }
  if (url.pathname === '/redirect') {
    const next = url.searchParams.get('next') ?? ''
    const injected = next.split('Set-Cookie:')[1]?.trim()
    if (injected) res.setHeader('set-cookie', injected)
    res.statusCode = 302
    res.setHeader('location', '/home')
    return res.end('redirect')
  }
  res.statusCode = 404
  res.end('not found')
}

function makeFixtureCase(domain: string, origin: string): FixtureCase | undefined {
  switch (domain) {
    case 'api-security':
      return {
        domain, primitiveId: 'authzMatrix', path: '/api/records', method: 'GET', authRequired: true, authz: true,
        findingType: 'broken_access_control', attackRequest: { method: 'GET', url: `${origin}/api/records?id=77` },
        makeUniqueProof: (base, marker) => ({
          baseline: { method: 'GET', url: `${base}/api/records?id=proof-${marker}`, headers: { authorization: 'Bearer victim' } },
          mutation: { method: 'GET', url: `${base}/api/records?id=proof-${marker}`, headers: { authorization: 'Bearer guest' } },
        }),
      }
    case 'auth-security':
      return {
        domain, primitiveId: 'authBypass', path: '/auth/session', method: 'POST', input: { name: 'user', location: 'body' }, useCase: 'login', tags: ['auth'],
        findingType: 'auth_bypass', attackRequest: { method: 'POST', url: `${origin}/auth/session`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'guest', password: 'wrong' }) },
        makeUniqueProof: (base, marker) => ({
          baseline: { method: 'POST', url: `${base}/auth/session`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'invalid', password: 'invalid' }) },
          mutation: { method: 'POST', url: `${base}/auth/session`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: 'admin', proof: marker }) },
        }),
      }
    case 'cloud-security':
      return {
        domain, primitiveId: 'ssrfMetadata', path: '/cloud/fetch', method: 'GET', input: { name: 'url', location: 'query' },
        findingType: 'ssrf', attackRequest: { method: 'GET', url: `${origin}/cloud/fetch?url=https%3A%2F%2Fsafe.example%2F` },
        makeUniqueProof: (base, marker) => ({
          baseline: { method: 'GET', url: `${base}/cloud/fetch?url=${encodeURIComponent('https://safe.example/safe-baseline')}` },
          mutation: { method: 'GET', url: `${base}/cloud/fetch?url=${encodeURIComponent(`http://169.254.169.254/${marker}`)}` },
        }),
      }
    case 'injection':
      return {
        domain, primitiveId: 'sstiBlind', path: '/render', method: 'GET', input: { name: 'template', location: 'query' },
        findingType: 'ssti', attackRequest: { method: 'GET', url: `${origin}/render?template=hello` },
        makeUniqueProof: (base, marker) => ({
          baseline: { method: 'GET', url: `${base}/render?template=safe-baseline` },
          mutation: { method: 'GET', url: `${base}/render?template=${encodeURIComponent(`{{7*7}}-${marker}`)}` },
        }),
      }
    case 'llm-security':
      return {
        domain, primitiveId: 'aiAgentAttack', path: '/ai/agent', method: 'POST', input: { name: 'prompt', location: 'body' }, useCase: 'ai agent request', tags: ['ai'],
        findingType: 'ai_agent_abuse', attackRequest: { method: 'POST', url: `${origin}/ai/agent` },
        makeUniqueProof: (base, marker) => ({
          baseline: { method: 'POST', url: `${base}/ai/agent`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'safe-baseline' }) },
          mutation: { method: 'POST', url: `${base}/ai/agent`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: marker }) },
        }),
      }
    case 'recon':
      return {
        domain, primitiveId: 'internalStateDisclosure', path: '/debug/item', method: 'GET', input: { name: 'id', location: 'query' },
        findingType: 'information_disclosure', attackRequest: { method: 'GET', url: `${origin}/debug/item?id=1` },
        makeUniqueProof: (base, marker) => ({
          baseline: { method: 'GET', url: `${base}/debug/item?id=1` },
          mutation: { method: 'GET', url: `${base}/debug/item?id=${encodeURIComponent(marker)}` },
        }),
      }
    case 'web-attacks':
      return {
        domain, primitiveId: 'headerInjection', path: '/redirect', method: 'GET', input: { name: 'next', location: 'query' },
        findingType: 'header_injection', attackRequest: { method: 'GET', url: `${origin}/redirect?next=%2Fhome` },
        makeUniqueProof: (base, marker) => ({
          baseline: { method: 'GET', url: `${base}/redirect?next=%2Fhome` },
          mutation: { method: 'GET', url: `${base}/redirect?next=${encodeURIComponent(`%0d%0aSet-Cookie: proof=${marker}`)}` },
        }),
      }
    default:
      return undefined
  }
}

function responseEvidenceForUrl(url: string) {
  return coreEvidenceLedger.all().filter(item => item.observed?.url && new URL(item.observed.url).pathname === new URL(url).pathname)
}

async function executeHttp(spec: RequestSpec) {
  const prior = new Set(coreEvidenceLedger.all().map(item => item.id))
  const output: any = await (httpRequest as any).execute({ ...spec, timeoutMs: 5000, approvalTimeoutMs: 5000, retryOnLimit: false }, {})
  expect(output.ok, output.error).toBe(true)
  const evidence = coreEvidenceLedger.all().find(item => !prior.has(item.id) && item.type === 'raw_response' && item.observed?.url === spec.url)
  expect(evidence, `httpRequest did not record typed response evidence for ${spec.url}`).toBeDefined()
  return { response: output.value as { status: number; headers: Record<string, string>; body: string }, evidence: evidence! }
}

async function recordActorResponse(spec: RequestSpec, actor: string) {
  const { response, evidence } = await executeHttp(spec)
  const tagged = coreEvidenceLedger.record({
    type: 'raw_response',
    data: response.body,
    label: `${actor} ${spec.method} ${spec.url}`,
    session: actor,
    observed: { ...evidence.observed, responseHeaders: response.headers, responseBody: response.body },
  })
  return { response, evidence: tagged }
}

async function evaluateAndPromote(fixture: FixtureCase, origin: string, graph: any, services: any) {
  const id = `experiment:domain:${fixture.domain}`
  const method = fixture.domain === 'auth-security' || fixture.domain === 'llm-security' ? 'POST' : 'GET'
  graph.upsertNode({
    id,
    type: NodeType.EXPERIMENT,
    label: `${fixture.domain} proof`,
    properties: { status: 'running', baselineRequest: { method, url: `${origin}${fixture.path}` } },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  const nextBudget = () => {
    let used = 0
    services.campaignRequestBudget = () => {
      if (used >= 100) return false
      used++
      return true
    }
  }
  const evaluateUniqueMarker = async (marker: string, phase: 'initial' | 'retest') => {
    nextBudget()
    const exchange = fixture.makeUniqueProof(origin, marker)
    const baseline = fixture.authz
      ? await recordActorResponse(exchange.baseline, 'victim')
      : await executeHttp(exchange.baseline)
    const mutation = fixture.authz
      ? await recordActorResponse(exchange.mutation, 'attacker')
      : await executeHttp(exchange.mutation)
    const oracle = fixture.authz
      ? {
          type: 'cross-identity', victimEvidenceId: baseline.evidence.id, attackerEvidenceId: mutation.evidence.id,
          victimActorRef: 'victim', attackerActorRef: 'attacker', marker,
        }
      : {
          type: 'unique-marker', baselineEvidenceId: baseline.evidence.id, mutationEvidenceId: mutation.evidence.id, marker,
        }
    const evaluated: any = await (evaluateResearchExperiment as any).execute({ experimentId: id, oracle, phase }, {})
    expect(evaluated.ok, evaluated.error).toBe(true)
    expect(evaluated.value.outcome.status).toBe('proven')
    return { exchange, outcome: evaluated.value.outcome }
  }

  const initial = await evaluateUniqueMarker(`proof-${fixture.domain}-a`, 'initial')
  const retest = await evaluateUniqueMarker(`proof-${fixture.domain}-b`, 'retest')
  expect(initial.outcome.proof.evidenceRefs).not.toEqual(expect.arrayContaining(retest.outcome.proof.evidenceRefs))
  expect((graph.getNode(id) as any).properties.retest.outcome.proof.phase).toBe('retest')

  const endpointUrl = `${origin}${fixture.path}`
  const evidence = responseEvidenceForUrl(endpointUrl)
    .filter(item => item.type === 'raw_request' || item.type === 'raw_response')
    .map(item => ({ id: item.id, type: item.type, data: item.data, label: item.label, timestamp: item.timestamp, ...(item.session ? { session: item.session } : {}), observed: item.observed }))
  const marker = `proof-${fixture.domain}-b`
  const replayExchange = fixture.makeUniqueProof(origin, marker).mutation
  const finding: any = await (writeFinding as any).execute({
    type: fixture.findingType,
    endpoint: endpointUrl,
    method,
    severity: 'medium',
    confidence: 0.9,
    description: `${fixture.domain} vulnerable fixture finding with independently retested proof`,
    experimentIds: [id],
    evidence,
    exploitProof: {
      scenario: `${fixture.domain} isolated vulnerable fixture replay`,
      request: `${replayExchange.method} ${replayExchange.url}${replayExchange.body ? `\n\n${replayExchange.body}` : ''}`,
      response: `HTTP ${retest.outcome.proof.evidenceRefs.join(',')}: ${marker}`,
      impact: `The fresh replay returned the fixture's unique ${fixture.domain} marker.`,
      method: replayExchange.method,
      headers: replayExchange.headers,
      ...(replayExchange.body !== undefined ? { body: replayExchange.body } : {}),
      expectedVulnerableResponse: marker,
      ...(fixture.authz ? { actor: 'attacker', altActor: 'victim' } : {}),
    },
  }, {})
  expect(finding.ok, finding.error).toBe(true)
  expect(finding.value.lifecycleStatus).toBe('verified')
  expect(finding.value.confirmed).toBe(true)
  expect(finding.value.experimentIds).toContain(id)
  expect(finding.value.proofCheck.passed).toBe(true)
  expect(finding.value.exploitProofNodeId).toBeTruthy()
  const proof = graph.getNode(finding.value.exploitProofNodeId)
  expect(proof?.properties.replayable).toBe(true)
  expect(proof?.properties.expectedVulnerableResponse).toBe(marker)
}

async function runAttackDomain(domain: string): Promise<void> {
  const fixtureServer = await listenLocal(fixtureHandler)
  try {
    const fixture = makeFixtureCase(domain, fixtureServer.origin)!
    const params = fixture.input ? [{ name: fixture.input.name, in: fixture.input.location, type: 'string' }] : []
    const endpoint = {
      id: `endpoint:${domain}`,
      type: NodeType.ENDPOINT,
      label: `${domain} isolated fixture`,
      properties: {
        url: fixture.attackRequest.url,
        method: fixture.attackRequest.method,
        params,
        headers: fixture.attackRequest.headers ?? {},
        authRequired: fixture.authRequired ?? false,
        useCase: fixture.useCase,
        tags: fixture.tags,
      },
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    const graph = createGraph(endpoint)
    const services = makeServices(graph)
    __setTestFallback(services)
    coreEvidenceLedger.clear()

    const runner = createPrimitiveRunner(graph, config, new EvidenceGate())
    const sessionManager = services.httpSessions as SessionManager
    if (fixture.authz) {
      sessionManager.createSession('guest', fixtureServer.origin)
      sessionManager.setToken('guest', 'guest')
      sessionManager.createSession('victim', fixtureServer.origin)
      sessionManager.setToken('victim', 'victim')
    }
    services.capturedRequests.record({
      method: fixture.attackRequest.method,
      url: fixture.attackRequest.url,
      headers: fixture.authz ? { authorization: 'Bearer guest' } : (fixture.attackRequest.headers ?? {}),
      ...(fixture.attackRequest.body !== undefined ? { body: fixture.attackRequest.body } : {}),
    })

    const primitive = primitiveMetadata.find(item => item.id === fixture.primitiveId)
    expect(primitive, `live primitive registry does not contain ${fixture.primitiveId}`).toBeDefined()
    const declared = allSkills.filter(skill => skill.domain === domain).flatMap(skill => skill.primitives)
    expect(declared).toContain(fixture.primitiveId)
    const plan = planCampaign(graph, {
      primitives: [{ id: fixture.primitiveId, tags: primitive!.tags, domains: [domain] }],
      domainNames: [domain],
      ...(fixture.authz ? { actorSessions: { authenticated: ['guest'] } } : {}),
      domainPrimitiveIds: { [domain]: [fixture.primitiveId] },
    })
    expect(plan.slices).toHaveLength(1)
    if (fixture.authz) expect(plan.slices[0].sessionRef).toBe('guest')
    const campaign = await runCampaign(plan, {
      graphStore: graph,
      config,
      maxConcurrency: 1,
      maxRequests: 100,
      maxDurationMs: 20_000,
      executor: runner,
    })
    expect(campaign.units[0]?.status, JSON.stringify(services.capturedRequests.list({ method: fixture.method, limit: 500 }).map((ref: any) => services.capturedRequests.get(ref.id))))
      .toBe('candidate')
    if (fixture.authz) expect(campaign.units[0]?.sessionRef).toBe('guest')
    expect(campaign.domains[0]?.status).toBe('candidate')
    expect(campaign.findings).toHaveLength(0)
    expect(campaign.requestsUsed).toBeLessThanOrEqual(100)
    expect(campaign.domains[0]?.reason).toMatch(/proven experiment and independent retest/i)

    const ledger = coreEvidenceLedger.all()
    expect(ledger.some(item => item.type === 'raw_request' && item.observed?.url && new URL(item.observed.url).pathname === fixture.path)).toBe(true)
    expect(ledger.some(item => item.type === 'raw_response' && item.observed?.url && new URL(item.observed.url).pathname === fixture.path)).toBe(true)
    const captured = services.capturedRequests.list({ method: fixture.method, limit: 500 })
      .map((entry: any) => services.capturedRequests.get(entry.id))
      .filter(Boolean)
    expect(captured.some((entry: any) => new URL(entry.url).pathname === fixture.path && entry.responseBody)).toBe(true)

    await evaluateAndPromote(fixture, fixtureServer.origin, graph, services)
  } finally {
    coreEvidenceLedger.clear()
    __setTestFallback(null)
    await fixtureServer.close()
  }
}

async function runSupportWorkflow(domain: string): Promise<void> {
  const skills = allSkills.filter(skill => skill.domain === domain)
  expect(skills.length).toBeGreaterThan(0)
  const skillIds = skills.map(skill => skill.id)
  for (const skill of skills) {
    const markdown = readSkillMarkdown(skill.id)
    expect(markdown, `live skill markdown missing for ${skill.id}`).toBeTruthy()
    const validation = validateSkillMarkdown(markdown!, skill.id)
    expect(validation.valid, `${skill.id}: ${validation.errors.join('; ')}`).toBe(true)
    const loaded = loadSkillBody(skill.id)
    expect(loaded?.instructions.trim().length, `skill body failed to load for ${skill.id}`).toBeGreaterThan(0)
  }

  const tools = new Set(resolveToolsForSkillsWorker(skillIds))
  const declaredTools = [...new Set(skills.flatMap(skill => skill.toolRefs))]
  expect(declaredTools.length).toBeGreaterThan(0)
  expect(declaredTools.filter(toolId => !tools.has(toolId))).toEqual([])
  const primitives = new Set(resolvePrimitivesForSkills(skillIds))
  expect([...primitives]).toEqual([...new Set(skills.flatMap(skill => skill.primitives))])

  if (domain === 'crypto') {
    const source = 'fixture:crypto:round-trip'
    const encoded: any = await (encodeDecode as any).execute({ operation: 'base64_encode', data: source }, {})
    const decoded: any = await (encodeDecode as any).execute({ operation: 'base64_decode', data: encoded.result }, {})
    expect(decoded).toMatchObject({ ok: true, result: source })
  } else if (domain === 'methodology') {
    const selected = skills[0]
    const search: any = await (searchSkillTool as any).execute({ query: selected.name }, {})
    expect(search.value.skills.some((item: any) => item.id === selected.id)).toBe(true)
    const loaded: any = await (loadSkillBodyTool as any).execute({ skillId: selected.id }, {})
    expect(loaded.value.instructions.trim().length).toBeGreaterThan(0)
    expect(loaded.value.toolRefs).toEqual(expect.arrayContaining(selected.toolRefs))
  } else if (domain === 'reports') {
    const directory = mkdtempSync(join(tmpdir(), 'ultimatrix-domain-report-'))
    try {
      const graph = createGraph({ id: 'report-fixture', type: NodeType.ENDPOINT, label: 'report fixture', properties: { url: 'http://fixture.local', method: 'GET' }, createdAt: Date.now(), updatedAt: Date.now() })
      const services = makeServices(graph)
      const log = new ForensicLog(join(directory, 'forensic.ndjson'))
      services.forensicLog = log
      __setTestFallback(services)
      log.log({ type: 'agent-turn', agent: 'fixture', result: { domain, status: 'validated' } })
      const report: any = await (readReportTool as any).execute({ section: 'summary', limit: 10 }, {})
      expect(report.ok).toBe(true)
      expect(report.value.index.totalEvents).toBe(1)
    } finally {
      __setTestFallback(null)
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

describe('live skill-domain end-to-end acceptance', () => {
  beforeEach(() => {
    __setTestFallback(null)
    coreEvidenceLedger.clear()
  })
  afterEach(() => {
    coreEvidenceLedger.clear()
    __setTestFallback(null)
  })

  it('uses every domain currently present in the live skill registry', () => {
    expect(allDomains).toHaveLength(19)
    expect(new Set(allDomains).size).toBe(19)
  })

  it.each(allDomains)('%s executes a real primitive fixture or validated support workflow', async domain => {
    if (makeFixtureCase(domain, 'http://127.0.0.1:1')) {
      await runAttackDomain(domain)
    } else {
      await runSupportWorkflow(domain)
    }
  })
})
