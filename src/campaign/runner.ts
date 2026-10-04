/** Binds technique primitives to captured, engagement-scoped HTTP requests. */

import {
  getPrimitive,
  runPrimitive,
  type AttackStep,
  type StepExecutionResult,
  type TechniqueContext,
} from '../primitives/framework'
import { httpRequest } from '../tools/http-tools'
import { getCapturedRequestStore, type CapturedRequest } from '../capture/captured-request-store'
import { getGlobalSessionManager } from '../http/session-manager'
import { isUrlInScope } from '../safety/scope-guard'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import type { GraphStore } from '../graph/store'
import type { UltimatrixConfig } from '../config'
import type { CampaignSlice, PrimitiveRunner, SliceExecContext } from './types'

function sameEndpoint(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch { return left === right }
}

function findCapturedRequest(slice: CampaignSlice): CapturedRequest | undefined {
  const store = getCapturedRequestStore()
  return store.list({ method: slice.endpoint.method, limit: 500 })
    .map(ref => store.get(ref.id))
    .filter((entry): entry is CapturedRequest => Boolean(entry))
    .reverse()
    .find(entry => sameEndpoint(entry.url, slice.endpoint.url))
}

function hasAuth(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(name => /^(authorization|proxy-authorization|cookie|x-auth-token|x-api-key)$/i.test(name))
}

function withoutAuthHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) =>
    !/^(authorization|proxy-authorization|cookie|x-auth-token|x-api-key|x-csrf-token)$/i.test(name),
  ))
}

function actorHeaders(url: string): Array<{ ref: string; headers: Record<string, string> }> {
  const manager = getGlobalSessionManager()
  return manager.listSessions().flatMap(ref => {
    try {
      const headers = manager.getAllHeaders(ref, url)
      return hasAuth(headers) ? [{ ref, headers }] : []
    } catch { return [] }
  })
}

function sameHeaders(left: Record<string, string>, right: Record<string, string>): boolean {
  const normalize = (headers: Record<string, string>) => Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function changedPayload(step: AttackStep, template: CapturedRequest, input: NonNullable<CampaignSlice['input']>): string | undefined {
  const metadata = step.metadata ?? {}
  for (const key of ['payload', 'oast', 'value', 'marker']) {
    if (typeof metadata[key] === 'string') return metadata[key] as string
  }
  const location = input.location.toLowerCase()
  if (['query', 'url', 'querystring'].includes(location)) {
    try {
      const before = new URL(template.url)
      const after = new URL(step.request.url)
      if (!after.searchParams.has(input.name)) return undefined
      const value = after.searchParams.get(input.name) ?? undefined
      return value !== before.searchParams.get(input.name) ? value : undefined
    } catch { return undefined }
  }
  if (['body', 'post', 'form', 'json'].includes(location) && step.request.body) {
    try {
      const current = JSON.parse(step.request.body) as Record<string, unknown>
      const baseline = template.body ? JSON.parse(template.body) as Record<string, unknown> : {}
      const value = current[input.name]
      return typeof value === 'string' && JSON.stringify(value) !== JSON.stringify(baseline[input.name]) ? value : undefined
    } catch { return undefined }
  }
  if (location === 'header') {
    const baseline = new Map(Object.entries(template.headers).map(([key, value]) => [key.toLowerCase(), value]))
    const current = Object.entries(step.request.headers ?? {}).find(([name]) => name.toLowerCase() === input.name.toLowerCase())
    return current && baseline.get(input.name.toLowerCase()) !== current[1] ? current[1] : undefined
  }
  if (location === 'cookie') {
    const baselineName = Object.keys(template.headers).find(key => key.toLowerCase() === 'cookie')
    const currentName = Object.keys(step.request.headers ?? {}).find(key => key.toLowerCase() === 'cookie')
    const before = baselineName ? template.headers[baselineName] : ''
    const after = currentName ? step.request.headers?.[currentName] ?? '' : ''
    const valueFor = (cookie: string): string | undefined => cookie.split(/;\s*/)
      .map(part => part.trim().split(/=(.*)/s, 2))
      .find(([name]) => name === input.name)?.[1]
    const value = valueFor(after)
    return value !== valueFor(before) ? value : undefined
  }
  if (location === 'path') {
    try {
      const before = new URL(template.url)
      const after = new URL(step.request.url)
      const priorSegments = before.pathname.split('/')
      const nextSegments = after.pathname.split('/')
      if (before.origin !== after.origin || priorSegments.length !== nextSegments.length) return undefined
      const changed = nextSegments.flatMap((value, index) => value !== priorSegments[index] ? [value] : [])
      return changed.length === 1 ? decodeURIComponent(changed[0]) : undefined
    } catch { return undefined }
  }
  return undefined
}

function setCookie(cookie: string, name: string, value: string): string {
  const parts = cookie.split(/;\s*/)
  const index = parts.findIndex(part => part.split('=', 1)[0].trim() === name)
  if (index < 0) parts.push(`${name}=${value}`)
  else parts[index] = `${name}=${value}`
  return parts.join('; ')
}

function mergeHeaders(base: Record<string, string>, override: Record<string, string> = {}): Record<string, string> {
  const merged = { ...base }
  for (const [name, value] of Object.entries(override)) {
    const existing = Object.keys(merged).find(key => key.toLowerCase() === name.toLowerCase())
    if (existing) delete merged[existing]
    merged[name] = value
  }
  return merged
}

function mutateCapturedRequest(
  step: AttackStep,
  template: CapturedRequest,
  slice: CampaignSlice,
): { method: string; url: string; headers: Record<string, string>; body?: string } | undefined {
  const input = slice.input
  const headers = mergeHeaders(template.headers, step.request.headers)
  if (!input?.name || input.location === 'endpoint') {
    if (!sameEndpoint(step.request.url, template.url)) return undefined
    return { method: step.request.method, url: step.request.url, headers, ...(step.request.body !== undefined ? { body: step.request.body } : {}) }
  }
  const payload = changedPayload(step, template, input)
  const method = template.method.toUpperCase()
  let url = template.url
  let body = template.body
  const location = input.location.toLowerCase()
  if (payload === undefined) {
    // Primitives often emit a baseline request for the captured value before
    // mutating that same input. Allow that exact baseline through; a different
    // or missing value remains blocked so the unit cannot drift to a neighbor.
    if (!['query', 'url', 'querystring'].includes(location)) return undefined
    try {
      const generated = new URL(step.request.url)
      const captured = new URL(template.url)
      if (!generated.searchParams.has(input.name) || generated.searchParams.get(input.name) !== captured.searchParams.get(input.name)) return undefined
      return { method, url: generated.toString(), headers, ...(template.body !== undefined ? { body: template.body } : {}) }
    } catch { return undefined }
  }
  if (['query', 'url', 'querystring'].includes(location)) {
    const parsed = new URL(url)
    parsed.searchParams.set(input.name, payload)
    url = parsed.toString()
  } else if (location === 'header') {
    headers[input.name] = payload
  } else if (location === 'cookie') {
    const cookieName = Object.keys(template.headers).find(key => key.toLowerCase() === 'cookie')
    if (!cookieName) return undefined
    headers[cookieName] = setCookie(template.headers[cookieName], input.name, payload)
  } else if (['body', 'post', 'form', 'json'].includes(location)) {
    if (!body) body = '{}'
    const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(body)
      params.set(input.name, payload)
      body = params.toString()
    } else {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>
        parsed[input.name] = payload
        body = JSON.stringify(parsed)
      } catch { return undefined }
    }
  } else if (location === 'path') {
    const parsed = new URL(url)
    const encoded = encodeURIComponent(input.name)
    const patterns = [`:${input.name}`, `{${input.name}}`, `%7B${encoded}%7D`]
    const pattern = patterns.find(candidate => parsed.pathname.includes(candidate))
    if (!pattern) return undefined
    parsed.pathname = parsed.pathname.replace(pattern, encodeURIComponent(payload))
    url = parsed.toString()
  } else {
    return undefined
  }
  return { method, url, headers, ...(body !== undefined ? { body } : {}) }
}

/** Step executor with a per-request budget; rejected attempts never reach httpRequest. */
async function httpExecutor(step: AttackStep, ctx: SliceExecContext, template?: CapturedRequest): Promise<StepExecutionResult> {
  const slice = ctx.slice
  const request = template ? mutateCapturedRequest(step, template, slice) : undefined
  if (template && !request) return { step, ok: false, error: `cannot safely apply generated payload to ${slice.input?.location ?? 'endpoint'} input ${slice.input?.name || '(none)'}` }
  if (ctx.hasRequestBudget && !ctx.hasRequestBudget()) return { step, ok: false, error: 'campaign request/time budget reached' }
  const remainingMs = ctx.remainingMs?.() ?? 10_000
  try {
    const r: any = await (httpRequest as any).execute({
      method: request?.method ?? step.request.method,
      url: request?.url ?? step.request.url,
      headers: request?.headers ?? step.request.headers,
      body: request?.body ?? step.request.body,
      timeoutMs: Math.min(10_000, remainingMs),
      approvalTimeoutMs: remainingMs,
      retryOnLimit: false,
    })
    if (!r?.ok) return { step, ok: false, error: r?.error ?? 'http request failed' }
    return { step, ok: true, status: r.value?.status, headers: r.value?.headers, body: r.value?.body, durationMs: r.value?.durationMs }
  } catch (error) {
    return { step, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function createPrimitiveRunner(
  graphStore: GraphStore,
  _config: UltimatrixConfig,
  gate: EvidenceGate,
): PrimitiveRunner {
  return async (primitiveId, slice, ctx) => {
    const primitive = getPrimitive(primitiveId)
    if (!primitive) return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: `unavailable primitive: ${primitiveId}` }
    if (primitiveId === 'workflowBypass' && (slice.workflowSteps?.length ?? 0) < 2) {
      return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: 'requires an observed multi-step workflow ending at this endpoint' }
    }
    const scope = isUrlInScope(slice.endpoint.url)
    if (!scope.allowed) return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: `scope denied: ${scope.reason}` }

    const captured = findCapturedRequest(slice)
    if (!captured) return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: 'missing captured request for this endpoint and method' }
    const isAnonymous = slice.role === 'anonymous'
    const sessions = actorHeaders(slice.endpoint.url)
    const requestedActor = slice.sessionRef ? sessions.find(session => session.ref === slice.sessionRef) : undefined
    if (slice.sessionRef && !requestedActor) {
      return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: `missing credentials for actor session ${slice.sessionRef}` }
    }
    const capturedActor = hasAuth(captured.headers) ? { ref: `capture:${captured.id}`, headers: captured.headers } : undefined
    const authenticated = isAnonymous ? undefined : requestedActor ?? capturedActor ?? sessions[0]
    const requestTemplate = isAnonymous
      ? { ...captured, headers: withoutAuthHeaders(captured.headers) }
      : requestedActor
        ? { ...captured, headers: mergeHeaders(withoutAuthHeaders(captured.headers), requestedActor.headers) }
        : captured
    const isAuthEndpoint = slice.role !== 'anonymous' || Boolean((graphStore.getNode(slice.endpoint.id) as any)?.properties?.authRequired)
    if (isAuthEndpoint && !authenticated) {
      return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: 'missing credentials for the authenticated actor' }
    }
    const needsSecondActor = ['idorSwapper', 'bolaFuzzer', 'graphqlBola', 'tenantIsolation'].includes(primitiveId)
    if (needsSecondActor && sessions.length < 2) {
      return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: 'missing second authenticated actor; configure two independent sessions' }
    }
    const primarySessionRef = requestedActor?.ref ??
      (authenticated ? sessions.find(session => sameHeaders(session.headers, authenticated.headers))?.ref ?? authenticated.ref : undefined)
    const alternateActor = sessions.find(session => session.ref !== primarySessionRef)
    if (slice.input?.location === 'path' && !new RegExp(`[:{]${slice.input.name}[}]?`).test(new URL(captured.url).pathname)) {
      return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'blocked', description: `path input ${slice.input.name} has no unambiguous placeholder in the captured request` }
    }

    const epNode = graphStore.getNode(slice.endpoint.id)
    const epProps = epNode && 'properties' in epNode ? (epNode as any).properties : undefined
    const inputs = slice.input?.name
      ? [{ name: slice.input.name, in: slice.input.location, type: slice.input.type, required: slice.input.required }]
      : []
    const sessionHeaders = authenticated?.headers ?? {}
    const techniqueCtx: TechniqueContext = {
      target: slice.endpoint.url,
      endpoint: {
        url: slice.endpoint.url,
        method: slice.endpoint.method,
        params: inputs,
        authRequired: epProps?.authRequired,
        authType: epProps?.authType,
        useCase: epProps?.useCase,
        tags: epProps?.tags,
      },
      param: slice.input?.name || undefined,
      inputLocation: slice.input?.location,
      role: slice.role,
      sessionHeaders,
      ...(alternateActor ? { altSessionHeaders: alternateActor.headers, altSessionRef: alternateActor.ref } : {}),
      ...(authenticated?.ref ? { sessionRef: authenticated.ref } : {}),
      ...(slice.workflowSteps ? { workflowSteps: [...slice.workflowSteps] } : {}),
      requestTemplate: { method: requestTemplate.method, url: requestTemplate.url, headers: { ...requestTemplate.headers }, ...(requestTemplate.body !== undefined ? { body: requestTemplate.body } : {}) },
      state: slice.state ? { name: slice.state, ...(slice.workflowId ? { workflowId: slice.workflowId } : {}) } : undefined,
    }
    if (!primitive.appliesTo(techniqueCtx)) {
      return { primitiveId, confirmed: false, confidence: 0, coverageStatus: 'not_applicable', description: `${primitiveId} is not applicable to this endpoint/input` }
    }

    let blockedReason: string | undefined
    const result = await runPrimitive(primitive, techniqueCtx, async step => {
      if (!step.actor || step.actor === slice.role) step.actor = authenticated?.ref ?? slice.actor ?? slice.role
      const output = await httpExecutor(step, ctx, requestTemplate)
      const outputError = typeof output.error === 'string'
        ? output.error
        : output.error == null ? undefined : String(output.error)
      if (outputError?.startsWith('cannot safely apply generated payload')) blockedReason = outputError
      if (outputError?.startsWith('campaign request/time budget')) blockedReason = outputError
      if (/Target request budget reached/i.test(outputError ?? '')) {
        blockedReason = outputError
        ctx.onTargetBudgetReached?.()
      }
      if (outputError?.startsWith('Scope violation:') || outputError?.includes('was not approved')) blockedReason = outputError
      if (!output.ok && output.status === undefined && outputError && !blockedReason) blockedReason = `request did not complete: ${outputError}`
      return output
    }, gate)

    const coverageStatus = blockedReason ? 'blocked' : result.confirmed ? undefined : result.candidate ? 'candidate' : 'tested'
    return {
      primitiveId,
      confirmed: result.confirmed,
      confidence: result.confidence,
      severity: result.severity,
      title: result.finding?.category ?? primitive.name,
      description: blockedReason ?? result.finding?.description ?? result.note ?? `${primitive.name} completed`,
      cwe: result.finding?.cwe,
      payload: result.finding?.request?.body,
      ...(coverageStatus ? { coverageStatus } : {}),
      evidence: (result.evidence ?? []).map(e => ({
        type: e.kind === 'request' ? 'raw_request' : e.kind === 'response' ? 'raw_response' : 'text',
        data: e.data,
        label: e.label,
        timestamp: Date.now(),
      })),
    }
  }
}
