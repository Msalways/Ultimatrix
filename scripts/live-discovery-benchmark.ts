#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { scoreDiscoveryBenchmark, scoreDiscoveryRun, type DiscoveryExperiment, type DiscoveryFinding, type DiscoveryVariant } from '../src/evals/live-discovery'
import { getTargetWorkspaceDir } from '../src/workspace'
import { loadConfig, loadProvidersConfig } from '../src/config'

const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b'
const DEFAULT_RUNS = 3
const MAX_HTTP_REQUESTS = 100
const RUN_WALL_MS = 300_000
const SOLVER_WALL_MS = 270_000
const EXPECTED_HYPOTHESIS_BY_CASE: Record<CaseKind, string[]> = {
  'case-1': ['workflow_bypass', 'action_limit'],
  'case-2': ['workflow_bypass'],
  'case-3': ['broken_access_control'],
}
const GOAL = [
  'Explore this local application using only the resources and synthetic account details shown by the application.',
  'Map the available user workflows and test their security behavior with bounded actions inside the sample workflows.',
  'Report only reproducible impact supported by request and response evidence. If a required actor is unavailable, mark that coverage unknown.',
  'Keep every request within this one local origin. Do not perform actions outside the application workflows.',
].join(' ')

let activeChild: { kill: () => boolean } | undefined
let activeConfigDir: string | undefined

type CaseKind = 'case-1' | 'case-2' | 'case-3'

interface RequestRecord {
  method: string
  path: string
  status: number
  trace: 'benchmark-start-url' | 'target-provided' | 'observed-traffic' | 'untraced' | 'standard-robots-resource'
  actor?: 'owner' | 'peer'
  crossActor?: boolean
}

export interface Fixture {
  kind: CaseKind
  title: string
  route: string
  email: string
  voucher: string
  credit: number
  ownerUser: string
  ownerPassword: string
  peerUser: string
  peerPassword: string
  ownerDocument: string
  peerDocument: string
  ownerNote: string
  peerNote: string
  peerAvailable: boolean
}

interface LocalTarget {
  target: string
  requests: RequestRecord[]
  close: () => Promise<void>
}

interface GraphNode {
  id: string
  type: string
  properties: Record<string, any>
}

function randomToken(bytes = 5): string {
  return randomBytes(bytes).toString('hex')
}

export function makeFixture(kind: CaseKind, peerAvailable = true): Fixture {
  const route = `/${randomToken()}`
  const suffix = randomToken(3)
  return {
    kind,
    title: kind === 'case-1' ? 'Member benefits' : kind === 'case-2' ? 'Account support' : 'Team workspace',
    route,
    email: `member-${suffix}@example.test`,
    voucher: `WELCOME-${randomToken(3).toUpperCase()}`,
    credit: 17 + randomBytes(1)[0] % 43,
    ownerUser: `analyst-${suffix}`,
    ownerPassword: `A-${randomToken(6)}`,
    peerUser: `partner-${suffix}`,
    peerPassword: `P-${randomToken(6)}`,
    ownerDocument: randomToken(8),
    peerDocument: randomToken(8),
    ownerNote: `Quarterly planning note ${randomToken(8)}`,
    peerNote: `Private review note ${randomToken(8)}`,
    peerAvailable,
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

function page(title: string, content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><title>${esc(title)}</title></head><body><main><h1>${esc(title)}</h1>${content}</main></body></html>`
}

function send(res: ServerResponse, status: number, body: string, contentType = 'text/html; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 32_768) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function fields(req: IncomingMessage, raw: string): Record<string, string> {
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)])) : {}
    } catch { return {} }
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

function observeResources(body: string, baseUrl: string, targetResources: Set<string>): void {
  for (const match of body.matchAll(/<(?:a|form)\b([^>]*)>/gi)) {
    const attrs = match[1]
    const href = attrs.match(/\b(?:href|action)\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    try {
      const url = new URL(href, baseUrl)
      if (url.origin !== new URL(baseUrl).origin) continue
      targetResources.add(url.pathname)
    } catch { /* malformed links are not benchmark resources */ }
  }
}

function renderTarget(fixture: Fixture, variant: DiscoveryVariant, req: IncomingMessage & { bodyText?: string }, url: URL, state: {
  usedVoucher: boolean
  balance: number
  resetTickets: Set<string>
  consumedTickets: Set<string>
  sessions: Map<string, 'owner' | 'peer'>
}): { status: number; body: string; contentType?: string } {
  const route = fixture.route
  const href = (path: string, text: string) => `<p><a href="${esc(path)}">${esc(text)}</a></p>`

  if (url.pathname === '/robots.txt') return { status: 200, body: 'User-agent: *\nAllow: /\n', contentType: 'text/plain; charset=utf-8' }
  if (url.pathname === '/') {
    const details = fixture.kind === 'case-3'
      ? `<section><h2>Temporary users for this local check</h2><p>${esc(fixture.ownerUser)} / ${esc(fixture.ownerPassword)}</p>${fixture.peerAvailable ? `<p>${esc(fixture.peerUser)} / ${esc(fixture.peerPassword)}</p>` : '<p>Only one test user was supplied for this run.</p>'}</section>`
      : ''
    return { status: 200, body: page(fixture.title, `<p>Sample application for a local security check. All accounts and records are disposable.</p>${href(route, fixture.kind === 'case-1' ? 'View member benefits' : fixture.kind === 'case-2' ? 'Open account support' : 'Open team workspace')}${details}`) }
  }

  if (fixture.kind === 'case-1' && url.pathname === route) {
    if (req.method === 'POST') {
      const entered = fields(req, req.bodyText ?? '').offer ?? ''
      if (entered !== fixture.voucher) return { status: 400, body: page(fixture.title, '<p>The offer code was not recognized.</p>') }
      if (variant === 'control' && state.usedVoucher) {
        return { status: 409, body: page(fixture.title, `<p>This offer has already been used. Current balance: ${state.balance} credits.</p>`) }
      }
      state.balance += fixture.credit
      state.usedVoucher = true
      return { status: 200, body: page(fixture.title, `<p>${fixture.credit} credits were added. Current balance: ${state.balance} credits.</p><p>The offer is described as one-time.</p><form method="post" action="${route}"><label>Offer code <input name="offer" value="${esc(fixture.voucher)}"></label><button>Apply offer</button></form>`) }
    }
    return { status: 200, body: page(fixture.title, `<p>Member balance: ${state.balance} credits.</p><p>Each welcome offer is intended for one use.</p><form method="post" action="${route}"><label>Offer code <input name="offer" value="${esc(fixture.voucher)}"></label><button>Apply offer</button></form>`) }
  }

  if (fixture.kind === 'case-2' && url.pathname === route) {
    if (req.method === 'POST') {
      if (url.searchParams.has('ticket')) {
        const ticket = url.searchParams.get('ticket') ?? ''
        if (!state.resetTickets.has(ticket) || (variant === 'control' && state.consumedTickets.has(ticket))) {
          return { status: 410, body: page(fixture.title, '<p>This recovery link is no longer available.</p>') }
        }
        const body = req.bodyText ?? ''
        const password = fields(req, body).password ?? ''
        if (!password) return { status: 400, body: page(fixture.title, '<p>A new password is required.</p>') }
        state.currentPassword = password
        state.consumedTickets.add(ticket)
        return { status: 200, body: page(fixture.title, `<p>Password updated for ${esc(fixture.email)}.</p><p>Recovery updates completed: ${state.consumedTickets.size}.</p>`) }
      }
      const email = fields(req, req.bodyText ?? '').email ?? ''
      if (email.toLowerCase() !== fixture.email) return { status: 404, body: page(fixture.title, '<p>No sample account matched that address.</p>') }
      const ticket = randomToken(16)
      state.resetTickets.add(ticket)
      return { status: 200, body: page(fixture.title, `<p>A message was queued for ${esc(fixture.email)}. Its local delivery preview is available below.</p>${href(`${route}?ticket=${encodeURIComponent(ticket)}`, 'Open the recovery message')}`) }
    }
    if (url.searchParams.has('ticket')) {
      const ticket = url.searchParams.get('ticket') ?? ''
      if (!state.resetTickets.has(ticket)) return { status: 404, body: page(fixture.title, '<p>Recovery message not found.</p>') }
      return { status: 200, body: page(fixture.title, `<p>Set a new password for ${esc(fixture.email)}.</p><form method="post" action="${route}?ticket=${encodeURIComponent(ticket)}"><label>New password <input name="password" type="password"></label><button>Save password</button></form>`) }
    }
    return { status: 200, body: page(fixture.title, `<p>Recover access to the disposable account ${esc(fixture.email)}.</p><form method="post" action="${route}"><label>Email <input name="email" value="${esc(fixture.email)}"></label><button>Send recovery message</button></form>`) }
  }

  if (fixture.kind === 'case-3') {
    const session = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    const actor = state.sessions.get(session)
    if (url.pathname === route && req.method === 'POST') {
      const input = fields(req, req.bodyText ?? '')
      const role = input.username === fixture.ownerUser && input.password === fixture.ownerPassword
        ? 'owner'
        : fixture.peerAvailable && input.username === fixture.peerUser && input.password === fixture.peerPassword ? 'peer' : undefined
      if (!role) return { status: 401, body: JSON.stringify({ error: 'test login failed' }), contentType: 'application/json; charset=utf-8' }
      const token = randomToken(18)
      state.sessions.set(token, role)
      return { status: 200, body: JSON.stringify({ session: token, profile: role === 'owner' ? fixture.ownerUser : fixture.peerUser }), contentType: 'application/json; charset=utf-8' }
    }
    if (url.pathname === route && req.method === 'GET') {
      return { status: 200, body: page(fixture.title, `<p>Sign in with one of the temporary users shown on the welcome page.</p><form method="post" action="${route}"><label>User <input name="username"></label><label>Password <input name="password" type="password"></label><button>Sign in</button></form>${href(`${route}/records`, 'Open the records directory')}`) }
    }
    if (url.pathname === `${route}/records`) {
      if (!actor) return { status: 401, body: page(fixture.title, '<p>Sign in to view the directory.</p>') }
      const records = [
        `<p><a href="${route}/record/${fixture.ownerDocument}">Record for ${esc(fixture.ownerUser)}</a></p>`,
        ...(fixture.peerAvailable ? [`<p><a href="${route}/record/${fixture.peerDocument}">Record for ${esc(fixture.peerUser)}</a></p>`] : []),
      ].join('')
      return { status: 200, body: page(fixture.title, `<p>Record references are listed for team navigation; only the assigned profile should see record contents.</p>${records}`) }
    }
    const recordMatch = url.pathname.match(new RegExp(`^${route}/record/([a-f0-9]+)$`))
    if (recordMatch) {
      if (!actor) return { status: 401, body: page(fixture.title, '<p>Sign in to view this record.</p>') }
      const recordId = recordMatch[1]
      const owner = recordId === fixture.ownerDocument ? 'owner' : recordId === fixture.peerDocument && fixture.peerAvailable ? 'peer' : undefined
      if (!owner) return { status: 404, body: page(fixture.title, '<p>Record not found.</p>') }
      if (variant === 'control' && actor !== owner) return { status: 403, body: page(fixture.title, '<p>This record belongs to another profile.</p>') }
      const label = owner === 'owner' ? fixture.ownerUser : fixture.peerUser
      const note = owner === 'owner' ? fixture.ownerNote : fixture.peerNote
      return { status: 200, body: page(fixture.title, `<p>Private record for ${esc(label)}.</p><p>Reference ${esc(recordId)} contains a confidential planning note: ${esc(note)}.</p>`) }
    }
  }

  return { status: 404, body: page(fixture.title, '<p>Page not found.</p>') }
}

export async function startTarget(fixture: Fixture, variant: DiscoveryVariant): Promise<LocalTarget> {
  const requests: RequestRecord[] = []
  const targetResources = new Set(['/robots.txt'])
  const observedPaths = new Set<string>()
  const state: any = {
    usedVoucher: false,
    balance: 0,
    resetTickets: new Set<string>(),
    consumedTickets: new Set<string>(),
    sessions: new Map<string, 'owner' | 'peer'>(),
  }
  const server = createServer(async (req, res) => {
    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/', `http://${host}`)
    const method = (req.method ?? 'GET').toUpperCase()
    const isTargetResource = targetResources.has(url.pathname)
    const trace: RequestRecord['trace'] = url.pathname === '/'
      ? 'benchmark-start-url'
      : url.pathname === '/robots.txt' ? 'standard-robots-resource'
        : observedPaths.has(url.pathname) ? 'observed-traffic'
          : isTargetResource ? 'target-provided' : 'untraced'
    if (requests.length >= MAX_HTTP_REQUESTS) {
      requests.push({ method, path: `${url.pathname}${url.search}`, status: 429, trace })
      send(res, 429, 'Benchmark HTTP request budget reached.', 'text/plain; charset=utf-8')
      return
    }
    let bodyText = ''
    try { bodyText = await readBody(req) } catch {
      requests.push({ method, path: `${url.pathname}${url.search}`, status: 413, trace })
      send(res, 413, 'Request body too large.', 'text/plain; charset=utf-8')
      return
    }
    ;(req as IncomingMessage & { bodyText: string }).bodyText = bodyText
    let response: { status: number; body: string; contentType?: string }
    try { response = renderTarget(fixture, variant, req as IncomingMessage & { bodyText?: string }, url, state) }
    catch { response = { status: 500, body: page(fixture.title, '<p>Local fixture error.</p>') } }
    let actor = state.sessions.get((req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')) as 'owner' | 'peer' | undefined
    if (!actor && fixture.kind === 'case-3' && method === 'POST' && url.pathname === fixture.route && response.status === 200) {
      try { actor = state.sessions.get(String(JSON.parse(response.body).session)) }
      catch { /* unsuccessful or malformed logins do not contribute actor coverage */ }
    }
    const recordMatch = fixture.kind === 'case-3'
      ? url.pathname.match(new RegExp(`^${fixture.route}/record/([a-f0-9]+)$`))
      : null
    const recordOwner = recordMatch?.[1] === fixture.ownerDocument
      ? 'owner'
      : recordMatch?.[1] === fixture.peerDocument && fixture.peerAvailable ? 'peer' : undefined
    requests.push({
      method,
      path: `${url.pathname}${url.search}`,
      status: response.status,
      trace,
      ...(actor ? { actor } : {}),
      ...(actor && recordOwner ? { crossActor: actor !== recordOwner } : {}),
    })
    observedPaths.add(url.pathname)
    if (response.contentType?.startsWith('text/html') || (!response.contentType && response.body.startsWith('<!doctype html>'))) {
      observeResources(response.body, url.toString(), targetResources)
    }
    send(res, response.status, response.body, response.contentType)
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind local benchmark target')
  const target = `http://127.0.0.1:${address.port}/`
  return {
    target,
    requests,
    close: () => new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())),
  }
}

function countPrompt(output: string): number {
  return (output.match(/(?:^|\r?\n)> /g) ?? []).length
}

function countMatches(output: string, pattern: RegExp): number {
  return (output.match(pattern) ?? []).length
}

async function runInteract(target: string, configPath: string): Promise<{ exitCode: number | null; durationMs: number; timedOut: boolean; stdout: string }> {
  const startedAt = Date.now()
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/index.ts', 'interact', '-t', target], {
    cwd: process.cwd(),
    env: { ...process.env, ULTIMATRIX_CONFIG: configPath, HEADLESS: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  activeChild = child
  let stdout = ''
  let goalsSent = 0
  let promptsSent = 0
  let approvalAnswers = 0
  let humanAnswers = 0
  let timedOut = false
  let childError: Error | undefined
  const maxCapture = 2_000_000
  const onData = (chunk: Buffer) => {
    stdout = (stdout + chunk.toString('utf8')).slice(-maxCapture)
    const currentPrompts = countPrompt(stdout)
    while (promptsSent < currentPrompts) {
      promptsSent++
      if (goalsSent === 0) {
        child.stdin.write(`${GOAL}\n`)
        goalsSent++
      } else {
        child.stdin.end()
      }
    }
    const approvals = countMatches(stdout, /Approve this state-changing [A-Z]+ request to /gi)
    while (approvalAnswers < approvals) {
      approvalAnswers++
      child.stdin.write('y\n')
    }
    const questions = countMatches(stdout, /(?:→|->)\s*askUser\b/g)
    while (humanAnswers < questions) {
      humanAnswers++
      child.stdin.write('Use only the synthetic accounts and information provided by the application; leave unavailable actor coverage unknown.\n')
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.once('error', error => { childError = error })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, RUN_WALL_MS)
  const exitCode = await new Promise<number | null>(resolveExit => child.once('close', code => {
    if (activeChild === child) activeChild = undefined
    resolveExit(code)
  }))
    .finally(() => clearTimeout(timer))
  if (childError) throw childError
  return { exitCode, durationMs: Date.now() - startedAt, timedOut, stdout }
}

async function readJson(path: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}

function readNodes(graph: any): GraphNode[] {
  return Array.isArray(graph?.nodes) ? graph.nodes.filter((node: any) => node && typeof node.id === 'string' && typeof node.type === 'string') : []
}

function mapFinding(node: GraphNode): DiscoveryFinding {
  const p = node.properties ?? {}
  return {
    id: node.id,
    type: String(p.technique ?? 'unknown'),
    endpoint: redactUrlQuery(String(p.endpoint ?? '')),
    method: typeof p.method === 'string' ? p.method : undefined,
    param: typeof p.param === 'string' ? p.param : undefined,
    description: typeof p.description === 'string' ? p.description : undefined,
    severity: String(p.severity ?? 'unknown'),
    confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
    confirmed: p.confirmed === true,
    lifecycleStatus: p.lifecycleStatus,
    experimentIds: Array.isArray(p.experimentIds) ? p.experimentIds : [],
    proofCheck: p.proofCheck,
  }
}

function endpointReference(target: string, endpointById: Map<string, GraphNode>, endpoints: GraphNode[]): { method?: string; path: string }[] {
  const endpoint = endpointById.get(target) ?? endpoints.find(candidate => candidate.properties.url === target)
  if (endpoint) {
    try {
      return [{
        ...(typeof endpoint.properties.method === 'string' ? { method: endpoint.properties.method } : {}),
        path: new URL(String(endpoint.properties.url)).pathname,
      }]
    } catch { /* fall back to interpreting the target as a URL or path */ }
  }
  try { return [{ path: new URL(target, 'http://benchmark.invalid').pathname }] }
  catch { return [] }
}

export function mapExperiment(
  node: GraphNode,
  hypothesesById: Map<string, GraphNode>,
  endpointById: Map<string, GraphNode>,
  endpoints: GraphNode[],
): DiscoveryExperiment {
  const p = node.properties ?? {}
  const hypothesisId = typeof p.hypothesisId === 'string' ? p.hypothesisId : undefined
  const hypothesis = hypothesisId ? hypothesesById.get(hypothesisId) : undefined
  const targetEndpointIds = Array.isArray(hypothesis?.properties.targetEndpoints)
    ? hypothesis.properties.targetEndpoints.filter((target: unknown): target is string => typeof target === 'string')
    : []
  const targetEndpoints = targetEndpointIds.flatMap((target: string) => endpointReference(target, endpointById, endpoints))
  return {
    id: node.id,
    ...(hypothesisId ? { hypothesisId } : {}),
    ...(typeof hypothesis?.properties.kind === 'string' ? { hypothesisKind: hypothesis.properties.kind } : {}),
    ...(typeof p.status === 'string' ? { status: p.status } : {}),
    ...(targetEndpoints.length ? { targetEndpoints } : {}),
    ...(Array.isArray(p.executionEvidenceRefs) ? { executionEvidenceRefs: p.executionEvidenceRefs } : {}),
    outcome: p.outcome,
    retest: p.retest,
  }
}

function safeEvents(raw: string): any[] {
  return raw.split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

function endpointSummaries(nodes: GraphNode[]): Array<{ method?: string; url: string; origin?: string }> {
  return nodes.filter(node => node.type === 'Endpoint').map(node => ({
    method: typeof node.properties.method === 'string' ? node.properties.method : undefined,
    url: redactUrlQuery(String(node.properties.url ?? '')),
    origin: typeof node.properties.origin === 'string' ? node.properties.origin : undefined,
  }))
}

function expectedSurfaceEndpoints(fixture: Fixture): Array<{ method: string; path: string }> {
  const endpoints = [
    { method: 'GET', path: fixture.route },
    { method: 'POST', path: fixture.route },
  ]
  if (fixture.kind === 'case-3') {
    endpoints.push({ method: 'GET', path: `${fixture.route}/records` })
    endpoints.push({ method: 'GET', path: `${fixture.route}/record/${fixture.ownerDocument}` })
    if (fixture.peerAvailable) endpoints.push({ method: 'GET', path: `${fixture.route}/record/${fixture.peerDocument}` })
  }
  return endpoints
}

function expectedWorkflowSequences(fixture: Fixture): Array<Array<{ method: string; path: string }>> {
  const step = (method: string, path = fixture.route) => ({ method, path })
  if (fixture.kind === 'case-1') return [[step('GET'), step('POST')]]
  if (fixture.kind === 'case-2') return [[step('GET'), step('POST'), step('GET'), step('POST')]]
  // One actor's recorded trace cannot represent both sides of an authorization check.
  return []
}

function observedWorkflowSequences(nodes: GraphNode[]): Array<Array<{ method: string; path: string }>> {
  return nodes.filter(node => node.type === 'Workflow'
    && node.properties.source === 'operator-demonstration'
    && node.properties.sequenceObserved === true)
    .map(node => (Array.isArray(node.properties.steps) ? node.properties.steps : [])
      .filter((step: any) => step?.requestId && typeof step.method === 'string' && typeof step.url === 'string')
      .flatMap((step: any) => {
        try { return [{ method: step.method, path: new URL(step.url).pathname }] }
        catch { return [] }
      }))
    .filter(sequence => sequence.length >= 2)
}

function redactUrlQuery(value: string): string {
  try {
    const url = new URL(value)
    for (const key of url.searchParams.keys()) url.searchParams.set(key, '[redacted]')
    return url.toString()
  } catch { return value }
}

async function executeRun(input: {
  fixture: Fixture
  variant: DiscoveryVariant
  model: string
  configPath: string
  iteration: number
  noSecondActor?: boolean
}): Promise<any> {
  const targetApp = await startTarget(input.fixture, input.variant)
  const startedAt = new Date().toISOString()
  const runId = randomUUID()
  let cli: Awaited<ReturnType<typeof runInteract>> | undefined
  try {
    await writeFile(input.configPath, makeConfig(input.model, targetApp.target), 'utf8')
    cli = await runInteract(targetApp.target, input.configPath)
  }
  finally { await targetApp.close() }

  const targetDir = getTargetWorkspaceDir(targetApp.target)
  const graph = await readJson(join(targetDir, 'graph.json'))
  const graphNodes = readNodes(graph)
  const endpointNodes = graphNodes.filter(node => node.type === 'Endpoint')
  const endpointById = new Map(endpointNodes.map(node => [node.id, node]))
  const hypothesisNodes = graphNodes.filter(node => node.type === 'Hypothesis')
  const hypothesesById = new Map(hypothesisNodes.map(node => [node.id, node]))
  const findings = graphNodes.filter(node => node.type === 'Finding').map(mapFinding)
  const experiments = graphNodes.filter(node => node.type === 'Experiment')
    .map(node => mapExperiment(node, hypothesesById, endpointById, endpointNodes))
  const actorEvidence = {
    actorsObserved: [...new Set(targetApp.requests.flatMap(request => request.actor ? [request.actor] : []))],
    crossActorRequestCount: targetApp.requests.filter(request => request.crossActor === true).length,
  }
  const learning = {
    workflowCount: graphNodes.filter(node => node.type === 'Workflow').length,
    entityCount: graphNodes.filter(node => node.type === 'Entity').length,
    hypothesisKinds: hypothesisNodes.map(node => String(node.properties.kind ?? 'unknown')),
    experimentStatuses: graphNodes.filter(node => node.type === 'Experiment').map(node => String(node.properties.status ?? 'unknown')),
    expectedEndpoints: expectedSurfaceEndpoints(input.fixture),
    expectedWorkflowSequences: expectedWorkflowSequences(input.fixture),
    observedWorkflowSequences: observedWorkflowSequences(graphNodes),
    observedEndpoints: graphNodes.filter(node => node.type === 'Endpoint').flatMap(node => {
      if (typeof node.properties.method !== 'string' || typeof node.properties.url !== 'string') return []
      try { return [{ method: node.properties.method, path: new URL(node.properties.url).pathname }] }
      catch { return [] }
    }),
  }
  const candidates = graphNodes.filter(node => node.type === 'CandidateFinding').map(node => {
    const evidenceText = Array.isArray(node.properties.evidence) ? node.properties.evidence.join('\n') : ''
    return {
      id: node.id,
      signalType: String(node.properties.signalType ?? 'unknown'),
      endpoint: redactUrlQuery(String(node.properties.endpoint ?? '')),
      status: typeof node.properties.status === 'string' ? node.properties.status : undefined,
      confidence: typeof node.properties.confidence === 'number' ? node.properties.confidence : undefined,
      evidenceRefs: [...new Set(evidenceText.match(/\bev_\d+_\d+\b/g) ?? [])],
      blockers: Array.isArray(node.properties.blockers) ? node.properties.blockers : [],
    }
  })
  const eventsRaw = await readFile(join(targetDir, 'logs', 'forensic.ndjson'), 'utf8').catch(() => '')
  const events = safeEvents(eventsRaw)
  const observedEvidenceRefs = [...new Set(events.filter(event => event.type === 'http-request').flatMap(event => {
    const url = event.args?.url
    const evidenceId = event.result?.evidenceId
    if (typeof url !== 'string' || typeof evidenceId !== 'string' || !evidenceId.startsWith('ev_')) return []
    try { return new URL(url).origin === new URL(targetApp.target).origin ? [evidenceId] : [] }
    catch { return [] }
  }))]
  const externalRequests = events.filter(event => event.type === 'http-request').flatMap(event => {
    const url = event.args?.url
    if (typeof url !== 'string') return []
    try { return new URL(url).origin === new URL(targetApp.target).origin ? [] : [`${event.args?.method ?? 'GET'} ${redactUrlQuery(url)}`] }
    catch { return [`${event.args?.method ?? 'GET'} ${url}`] }
  })
  const untracedRequests = [
    ...targetApp.requests.filter(request => request.trace === 'untraced').map(request => `${request.method} ${redactUrlQuery(new URL(request.path, targetApp.target).toString())}`),
    ...externalRequests,
  ]
  const score = scoreDiscoveryRun({
    variant: input.variant,
    findings,
    experiments,
    candidates,
    requiresSecondActor: input.fixture.kind === 'case-3',
    secondActorAvailable: input.fixture.kind !== 'case-3' || input.fixture.peerAvailable,
    actorEvidence,
    observedEvidenceRefs,
    untracedRequests,
    targetLearning: learning,
    expectedHypothesisKinds: EXPECTED_HYPOTHESIS_BY_CASE[input.fixture.kind],
    requestCount: targetApp.requests.length,
    requestLimit: MAX_HTTP_REQUESTS,
    durationMs: cli?.durationMs ?? 0,
    durationLimitMs: RUN_WALL_MS,
  })
  const modelEvents = events.filter(event => event.type === 'model-call')
  const modelUsage = modelEvents.reduce((sum, event) => ({
    modelCalls: sum.modelCalls + 1,
    inputTokens: sum.inputTokens + Number(event.metadata?.inputTokens ?? 0),
    outputTokens: sum.outputTokens + Number(event.metadata?.outputTokens ?? 0),
    totalTokens: sum.totalTokens + Number(event.metadata?.totalTokens ?? 0),
  }), { modelCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const blockers = [
    ...(cli?.timedOut ? ['interact exceeded the five-minute run limit'] : []),
    ...(cli?.exitCode !== 0 ? [`interact exited with code ${String(cli?.exitCode)}`] : []),
    ...(modelUsage.modelCalls === 0 ? ['no model calls were recorded; provider startup or CLI setup may have failed'] : []),
    ...(!graph ? ['no graph artifact was written'] : []),
    ...(events.filter(event => event.type === 'error' || event.type === 'tool-error').length
      ? [`${events.filter(event => event.type === 'error' || event.type === 'tool-error').length} runtime error event(s) recorded`] : []),
    ...experiments.flatMap(experiment => [
      ...(experiment.outcome?.status && experiment.outcome.status !== 'proven' ? [`experiment ${experiment.id} initial outcome: ${experiment.outcome.status}`] : []),
      ...(experiment.retest?.outcome?.status && experiment.retest.outcome.status !== 'proven' ? [`experiment ${experiment.id} retest outcome: ${experiment.retest.outcome.status}`] : []),
    ]),
    ...candidates.flatMap(candidate => candidate.blockers ?? []),
    ...(untracedRequests.length ? [`${untracedRequests.length} request(s) lacked observed or target-provided provenance`] : []),
    ...(targetApp.requests.length > MAX_HTTP_REQUESTS ? ['run exceeded its 100-request target budget'] : []),
    ...(cli?.durationMs > RUN_WALL_MS ? ['run exceeded its five-minute wall-clock budget'] : []),
  ]
  return {
    runId,
    caseId: input.fixture.kind,
    iteration: input.iteration,
    variant: input.variant,
    target: targetApp.target,
    provider: 'nvidia',
    model: input.model,
    startedAt,
    durationMs: cli?.durationMs ?? 0,
    exitCode: cli?.exitCode ?? null,
    requestCount: targetApp.requests.length,
    requestBudget: MAX_HTTP_REQUESTS,
    requestProvenance: {
      traced: targetApp.requests.length - targetApp.requests.filter(request => request.trace === 'untraced').length,
      untraced: untracedRequests,
      records: targetApp.requests.map(request => ({
        ...request,
        path: redactUrlQuery(`http://127.0.0.1${request.path}`).replace('http://127.0.0.1', ''),
      })),
    },
    discoveredCoverage: {
      endpointCount: endpointSummaries(graphNodes).length,
      endpoints: endpointSummaries(graphNodes),
      actor: score.actorCoverage,
      actorsObserved: score.actorEvidence.actorsObserved,
      crossActorRequests: score.actorEvidence.crossActorRequestCount,
    },
    targetLearning: {
      ...learning,
      expectedEndpointCount: score.targetLearning.expectedEndpointCount,
      observedExpectedEndpointCount: score.targetLearning.observedExpectedEndpointCount,
      endpointRecall: score.targetLearning.endpointRecall,
      expectedHypothesisKinds: score.targetLearning.expectedHypothesisKinds,
      matchedHypothesisKinds: score.targetLearning.matchedHypothesisKinds,
      hypothesisRecall: score.targetLearning.hypothesisRecall,
      attackedHypothesisKinds: score.targetLearning.attackedHypothesisKinds,
      attackedHypothesisRecall: score.targetLearning.attackedHypothesisRecall,
      plannedExperiments: score.targetLearning.plannedExperiments,
      attemptedExperiments: score.targetLearning.attemptedExperiments,
      completedExperiments: score.targetLearning.completedExperiments,
      blockedExperiments: score.targetLearning.blockedExperiments,
    },
    findings,
    candidates,
    evidenceReferences: findings.map(finding => ({
      findingId: finding.id,
      proofCheck: finding.proofCheck,
      experiments: (finding.experimentIds ?? []).map(id => {
        const experiment = experiments.find(item => item.id === id)
        return {
          experimentId: id,
          initial: experiment?.outcome,
          independentRetest: experiment?.retest?.outcome,
        }
      }),
    })),
    initialProofStatus: experiments.map(experiment => ({ id: experiment.id, status: experiment.outcome?.status ?? 'missing' })),
    independentRetestStatus: experiments.map(experiment => ({ id: experiment.id, status: experiment.retest?.outcome?.status ?? 'missing' })),
    modelUsage,
    blockers: [...new Set(blockers)],
    noSecondActorRun: input.noSecondActor === true,
    score,
    artifacts: {
      graph: join(targetDir, 'graph.json'),
      forensicLog: join(targetDir, 'logs', 'forensic.ndjson'),
    },
  }
}

export function makeConfig(model: string, target: string): string {
  const quote = (value: string) => JSON.stringify(value)
  const tiers = ['fast', 'balanced', 'powerful'].map(tier => `  ${tier}: { provider: nvidia, model: ${quote(model)} }`).join('\n')
  const roles = ['brain', 'spider', 'crawlSummarizer', 'verifier', 'reporter', 'council'].map(role => `  ${role}: balanced`).join('\n')
  return [
    'provider: nvidia',
    `model: ${quote(model)}`,
    `target: ${quote(target)}`,
    'engine: solver',
    'modelTiers:', tiers,
    'modelRoleTiers:', roles,
    'solver:',
    '  maxToolCalls: 50',
    `  maxDurationMs: ${SOLVER_WALL_MS}`,
    '  maxParallel: 1',
    'campaign:',
    `  maxRequests: ${MAX_HTTP_REQUESTS}`,
    `  maxDurationMs: ${SOLVER_WALL_MS}`,
    'rateLimit:',
    `  requestsPerMinute: ${MAX_HTTP_REQUESTS}`,
    '  maxConcurrent: 1',
    'scope:',
    '  allowedDomains: [127.0.0.1]',
    `  allowedOrigins: [${quote(new URL(target).origin)}]`,
    '  allowPrivateAddresses: true',
    '  allowedProtocols: [http]',
    '  enforcement: hard',
    'browser:',
    '  headless: true',
  ].join('\n') + '\n'
}

function readArgs(args: string[]): { live: boolean; runs: number; model: string; output?: string; help: boolean } {
  const parsed = { live: false, runs: DEFAULT_RUNS, model: process.env.ULTIMATRIX_BENCHMARK_MODEL || DEFAULT_MODEL, output: undefined as string | undefined, help: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--live') parsed.live = true
    else if (args[i] === '--runs') parsed.runs = Number(args[++i])
    else if (args[i] === '--model') parsed.model = args[++i]
    else if (args[i] === '--out') parsed.output = args[++i]
    else if (args[i] === '--help' || args[i] === '-h') parsed.help = true
  }
  if (!Number.isInteger(parsed.runs) || parsed.runs < 1 || parsed.runs > 3) throw new Error('--runs must be an integer from 1 to 3')
  if (!parsed.model) throw new Error('A pinned NVIDIA model is required')
  return parsed
}

function resolveNvidiaApiKey(): string | undefined {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY
  try {
    const credentials = loadProvidersConfig().nvidia
    if (credentials && 'apiKey' in credentials && credentials.apiKey) return credentials.apiKey
  } catch { /* use the canonical config fallback below */ }
  try {
    const credentials = loadConfig({ requireCredentials: false }).creds.nvidia
    if (credentials && 'apiKey' in credentials && credentials.apiKey) return credentials.apiKey
  } catch { /* no configured NVIDIA credential */ }
  return undefined
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2))
  if (args.help || !args.live) {
    process.stdout.write('Usage: npm run benchmark:discovery -- [--live] [--runs 1..3] [--model <nvidia-model>] [--out <report.json>]\n')
    process.stdout.write('The live benchmark runs real interact sessions against disposable loopback targets.\n')
    return
  }
  const outPath = resolve(args.output ?? join(process.cwd(), 'evals', `live-discovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`))
  await mkdir(resolve(outPath, '..'), { recursive: true })
  const baseline: any = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'untested',
    provider: 'nvidia',
    model: args.model,
    bounds: { maxHttpRequestsPerRun: MAX_HTTP_REQUESTS, maxDurationMsPerRun: RUN_WALL_MS },
    requiredRuns: { vulnerable: 9, control: 9, noSecondActor: 1 },
    runs: [],
    benchmarkScore: null,
  }
  const apiKey = resolveNvidiaApiKey()
  if (!apiKey) {
    baseline.reason = 'No NVIDIA API credential is available in the environment or project configuration; live discovery is untested.'
    await writeFile(outPath, JSON.stringify(baseline, null, 2), 'utf8')
    process.stdout.write(`Live discovery untested: no NVIDIA API credential is available. Report: ${outPath}\n`)
    return
  }

  const configDir = await mkdtemp(join(tmpdir(), 'ultimatrix-discovery-'))
  activeConfigDir = configDir
  const configPath = join(configDir, 'ultimatrix.yaml')
  const secretConfigPath = join(configDir, 'providers.yaml')
  const cleanupSecret = () => {
    if (!activeConfigDir) return
    try { rmSync(activeConfigDir, { recursive: true, force: true }) } catch { /* best effort during process shutdown */ }
    activeConfigDir = undefined
  }
  const stopForSignal = (code: number) => () => {
    activeChild?.kill()
    cleanupSecret()
    process.exit(code)
  }
  const onSigint = stopForSignal(130)
  const onSigterm = stopForSignal(143)
  process.once('exit', cleanupSecret)
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  try {
    await writeFile(secretConfigPath, `nvidia:\n  apiKey: ${JSON.stringify(apiKey)}\n`, { encoding: 'utf8', mode: 0o600 })
    const runs: any[] = []
    for (let iteration = 1; iteration <= args.runs; iteration++) {
      for (const kind of ['case-1', 'case-2', 'case-3'] as CaseKind[]) {
        const matchedFixture = makeFixture(kind)
        const variants: DiscoveryVariant[] = randomBytes(1)[0] % 2 ? ['vulnerable', 'control'] : ['control', 'vulnerable']
        for (const variant of variants) {
          const report = await executeRun({ fixture: matchedFixture, variant, model: args.model, configPath, iteration })
          runs.push(report)
          process.stdout.write(`${report.variant} ${report.caseId} ${report.iteration}: ${report.score.verifiedFindingIds.length} verified; ${report.score.targetLearning.workflowCount} workflows, ${report.score.targetLearning.observedExpectedEndpointCount}/${report.score.targetLearning.expectedEndpointCount} expected endpoints mapped, ${report.score.targetLearning.matchedWorkflowSequenceCount}/${report.score.targetLearning.expectedWorkflowSequenceCount} expected ordered workflows mapped, ${report.score.targetLearning.matchedHypothesisKinds.length}/${report.score.targetLearning.expectedHypothesisKinds.length} expected hypothesis classes mapped, experiments ${report.score.targetLearning.plannedExperiments} planned/${report.score.targetLearning.attemptedExperiments} attempted/${report.score.targetLearning.blockedExperiments} blocked; ${report.requestCount} requests, ${(report.durationMs / 1000).toFixed(1)}s\n`)
        }
      }
    }
    const noPeerFixture = makeFixture('case-3', false)
    const noPeer = await executeRun({ fixture: noPeerFixture, variant: 'vulnerable', model: args.model, configPath, iteration: args.runs, noSecondActor: true })
    runs.push(noPeer)
    baseline.status = runs.some(run => run.exitCode !== 0 || run.durationMs === 0 || run.modelUsage.modelCalls === 0)
      ? 'partial' : 'complete'
    baseline.runs = runs
    baseline.benchmarkScore = scoreDiscoveryBenchmark(runs.filter(run => !run.noSecondActorRun).map(run => ({ variant: run.variant, score: run.score })))
    baseline.noSecondActor = {
      runId: noPeer.runId,
      coverage: noPeer.score.actorCoverage,
      unsupportedCrossActorFinding: noPeer.score.unsupportedCrossActorFinding,
      expectedCoverage: 'blocked or unknown; never clean or disproven',
    }
    baseline.overallPass = args.runs === 3 && baseline.status === 'complete' && baseline.benchmarkScore.pass &&
      noPeer.score.actorCoverage === 'unknown' && !noPeer.score.unsupportedCrossActorFinding
    await writeFile(outPath, JSON.stringify(baseline, null, 2), 'utf8')
    process.stdout.write(`Benchmark ${baseline.overallPass ? 'PASS' : 'did not meet all criteria'}: ${outPath}\n`)
  } catch (error) {
    baseline.status = 'failed'
    baseline.reason = error instanceof Error ? error.message : String(error)
    await writeFile(outPath, JSON.stringify(baseline, null, 2), 'utf8')
    throw error
  } finally {
    await rm(configDir, { recursive: true, force: true })
    activeConfigDir = undefined
    process.removeListener('exit', cleanupSecret)
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`Live discovery benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
