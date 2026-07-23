/**
 * Technique primitives — Phase 2 (T2.1 / T2.2 / T2.5)
 *
 * Registers all flagship primitives and exports:
 *   - listPrimitives()            (registry)
 *   - runPrimitiveTool            (Mastra tool: invoke a primitive by id)
 *   - runPrimitiveById()          (programmatic helper for solver/workers)
 *
 * T2.5: runPrimitive strictly routes through EvidenceGate.verifyClaim — a
 * primitive returns `confirmed: true` ONLY when its claim is backed by recorded
 * tool output. Confirmed primitives commit to the graph via writeFinding
 * (control-tools), which itself consults the same gate (maker/checker).
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  getPrimitive,
  listPrimitives,
  registerPrimitive,
  runPrimitive,
  type AttackStep,
  type EvidenceRef,
  type PrimitiveResult,
  type StepExecutionResult,
  type TechniqueContext,
} from './framework'
import { invariantProbe } from './invariantProbe'
import { workflowBypass } from './workflowBypass'
import { concurrencyHarness } from './concurrencyHarness'
import { authzMatrix } from './authzMatrix'
import { configTrust } from './configTrust'
import { idorSwapper } from './idorSwapper'
import { bolaFuzzer } from './bolaFuzzer'
import { ssrfOast } from './ssrfOast'
import { classicInjection } from './classicInjection'
import { headerInjection } from './headerInjection'
import { aiTrust } from './ai-trust'
import { authBypass } from './authBypass'
import { atoChain } from './atoChain'
import { ssrfMetadata } from './ssrfMetadata'
import { rceClass } from './rceClass'
import { graphqlBola } from './graphqlBola'
import { aiAgentAttack } from './aiAgentAttack'
import { nosqlInjection } from './nosqlInjection'
import { ssrfMultiCloud } from './ssrfMultiCloud'
import { sstiBlind } from './sstiBlind'
import { boplaOracle } from './boplaOracle'
import { artifactLifetime } from './artifactLifetime'
import { internalStateDisclosure } from './internalStateDisclosure'
import { tenantIsolation } from './tenantIsolation'
import { deserialization } from './deserialization'
import { secondOrderSqli } from './secondOrderSqli'
import { ldapXpathInjection } from './ldapXpathInjection'
import { smuggling } from './smuggling'
import { businessLogicAbuse } from './businessLogicAbuse'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { setEvidenceGateForFindings, recordEvidence, writeFinding } from '../tools/control-tools'
import { httpRequest } from '../tools/http-tools'
import { rawHttpClient } from '../tools/raw-http-client'
import { getGlobalWorkspace } from '../workspace'
import { summarizeTrace } from '../capture/render-tracer'
import { NodeType, type EndpointNode } from '../graph/schema'

// ─── Register all primitives (single source of truth) ───────────────────

for (const p of [
  invariantProbe,
  workflowBypass,
  concurrencyHarness,
  authzMatrix,
  configTrust,
  idorSwapper,
  bolaFuzzer,
  ssrfOast,
  classicInjection,
  headerInjection,
  aiTrust,
  authBypass,
  atoChain,
  ssrfMetadata,
  rceClass,
  graphqlBola,
  aiAgentAttack,
  nosqlInjection,
  ssrfMultiCloud,
  sstiBlind,
  boplaOracle,
  artifactLifetime,
  internalStateDisclosure,
  tenantIsolation,
  deserialization,
  secondOrderSqli,
  ldapXpathInjection,
  smuggling,
  businessLogicAbuse,
]) {
  registerPrimitive(p)
}

const PRIMITIVE_IDS = listPrimitives().map(p => p.id) as [string, ...string[]]

// ─── Context builder ────────────────────────────────────────────────────

function buildContext(input: Record<string, any> = {}): TechniqueContext {
  const ctx: TechniqueContext = {}
  if (input.target) ctx.target = input.target
  if (input.endpointUrl || input.target) {
    ctx.endpoint = {
      url: input.endpointUrl ?? input.target,
      method: (input.endpointMethod ?? 'GET') as string,
      params: Array.isArray(input.params) ? input.params : undefined,
      authRequired: input.authRequired,
      authType: input.authType,
      useCase: input.useCase,
      tags: input.tags,
    }
  }
  if (input.param) ctx.param = input.param
  if (input.role) ctx.role = input.role
  if (Array.isArray(input.roles)) ctx.roles = input.roles
  if (input.sessionHeaders) ctx.sessionHeaders = input.sessionHeaders
  if (input.altSessionHeaders) ctx.altSessionHeaders = input.altSessionHeaders
  if (input.objectId) ctx.objectId = input.objectId
  if (input.altObjectId) ctx.altObjectId = input.altObjectId
  if (Array.isArray(input.workflowSteps)) ctx.workflowSteps = input.workflowSteps
  if (Array.isArray(input.payloads)) ctx.payloads = input.payloads
  if (input.state) ctx.state = input.state
  if (input.variant) ctx.variant = input.variant
  if (input.dbms) ctx.dbms = input.dbms
  if (input.oastHost) ctx.oastHost = input.oastHost
  if (input.requestTemplate) ctx.requestTemplate = input.requestTemplate
  if (input.mutationStrategy) ctx.mutationStrategy = input.mutationStrategy
  if (input.payloadSet) ctx.payloadSet = input.payloadSet
  if (input.multiParam !== undefined) ctx.multiParam = input.multiParam
  if (input.concurrency !== undefined) ctx.concurrency = input.concurrency
  if (input.maxAttempts !== undefined) ctx.maxAttempts = input.maxAttempts
  if (input.relationSeed) ctx.relationSeed = input.relationSeed
  return ctx
}

// ─── Executor: run a step via the HTTP tool (real tool output) ───────────

async function executeOnce(step: AttackStep): Promise<StepExecutionResult> {
  // Smuggling/deserialization primitives may request a raw-socket transport
  // (manual framing that fetch cannot express) via step.metadata.useRaw.
  if (step.metadata?.useRaw) {
    try {
      const r: any = await (rawHttpClient as any).execute({ url: step.request.url, preamble: step.request.body ?? '', timeoutMs: 8000 })
      return { step, ok: r?.ok ?? false, status: undefined, body: r?.rawResponse, error: r?.error }
    } catch (e: any) {
      return { step, ok: false, error: e?.message ?? String(e) }
    }
  }
  try {
    const r: any = await (httpRequest as any).execute({
      method: step.request.method,
      url: step.request.url,
      headers: step.request.headers,
      body: step.request.body,
    })
    if (!r?.ok) {
      return { step, ok: false, error: r?.error ?? 'http request failed', status: undefined, body: undefined }
    }
    return {
      step,
      ok: true,
      status: r.value?.status,
      headers: r.value?.headers,
      body: r.value?.body,
      durationMs: r.value?.durationMs,
    }
  } catch (e: any) {
    return { step, ok: false, error: e?.message ?? String(e) }
  }
}

async function httpExecutor(step: AttackStep): Promise<StepExecutionResult> {
  const kind = String(step.metadata?.kind ?? '')
  const isTimeBased = kind.includes('-time')

  if (!isTimeBased) {
    return executeOnce(step)
  }

  const iterations = step.metadata?.timingIterations
    ? Number(step.metadata.timingIterations)
    : 3
  const samples: number[] = []
  let lastResult: StepExecutionResult | undefined

  for (let i = 0; i < iterations; i++) {
    const res = await executeOnce(step)
    lastResult = res
    if (res.durationMs !== undefined) {
      samples.push(res.durationMs)
    }
  }

  if (samples.length === 0 || !lastResult) {
    return { step, ok: false, error: 'no timing samples collected' }
  }

  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]

  return {
    ...lastResult,
    durationMs: median,
    extra: {
      ...(lastResult.extra ?? {}),
      timingSamples: samples,
      timingMedian: median,
    },
  }
}

// ─── Programmatic runner ─────────────────────────────────────────────────

export async function runPrimitiveById(
  primitiveId: string,
  context: Record<string, any>,
  options?: { commit?: boolean; gate?: EvidenceGate },
): Promise<{ ok: boolean; skipped?: boolean; reason?: string; result?: PrimitiveResult; available?: string[] }> {
  const primitive = getPrimitive(primitiveId)
  if (!primitive) {
    return { ok: false, available: listPrimitives().map(p => p.id), result: undefined }
  }
  const ctx = buildContext(context)
  if (!primitive.appliesTo(ctx)) {
    return { ok: true, skipped: true, reason: `primitive "${primitiveId}" not applicable to context`, result: { confirmed: false, confidence: 0, evidence: [] } }
  }

  const gate = options?.gate ?? new EvidenceGate()
  setEvidenceGateForFindings(gate)

  const result = await runPrimitive(primitive, ctx, httpExecutor, gate)

  // WS-E: persist render traces as RENDERED_ELEMENT graph nodes and surface a
  // compact render summary in the evidence the LLM (and report) consumes.
  if (result.renderTraces?.length) {
    const store = getGlobalWorkspace().getGraphStore()
    const endpointUrl = ctx.endpoint?.url ?? ctx.target
    const endpoint = endpointUrl
      ? ((store?.queryNodes(NodeType.ENDPOINT) as EndpointNode[] | undefined) ?? []).find(
          (e) => e.properties.url === endpointUrl,
        )
      : undefined
    for (const trace of result.renderTraces) {
      if (store) {
        for (const f of trace.formFields) {
          store.addRenderedElement(
            endpoint?.id,
            {
              url: endpointUrl,
              method: ctx.endpoint?.method,
              selector: f.selector,
              tag: f.tag,
              name: f.name,
              inputType: f.type,
              value: f.value,
              isFormField: true,
              attributes: f.attributes,
              text: f.text,
              payloadHit: trace.payloadHits.length > 0,
            },
          )
        }
      }
    }
    const summary = result.renderTraces.map(summarizeTrace).join('\n')
    result.evidence.push({ kind: 'render', label: `render trace ${endpointUrl ?? ''}`, data: summary })
  }

  if (result.confirmed && options?.commit !== false) {
    const store = getGlobalWorkspace().getGraphStore()
    const findingUrl = result.finding?.request?.url ?? ctx.target ?? ctx.endpoint?.url ?? ''

    for (const ev of result.evidence) {
      await (recordEvidence as any).execute({ type: evidenceType(ev.kind), data: ev.data, label: ev.label })
    }

    // W2 — persist a reusable session artifact as a first-class AUTH_FLOW node
    // so the exploitation loop can pivot (held-session reach) into other
    // in-scope endpoints. Single persistence seam — no per-primitive graph calls.
    if (result.sessionArtifact && store) {
      store.addAuthFlow({
        flowType: result.sessionArtifact.flowType,
        reusable: result.sessionArtifact.reusable,
        credentialHash: result.sessionArtifact.credentialHash,
        steps: [{ action: 'recovered-session', url: findingUrl }],
      })
    }

    // W2 — captured concrete impact data folds into the proof's impact so a
    // confirmed finding is demonstrated end-to-end (exfil/victim data), not
    // merely reported. No frozen vocabulary — `kind` is registry-typed.
    let proof = result.exploitProof
    if (result.dataArtifact && proof) {
      proof = {
        ...proof,
        impact: `${proof.impact}\n\n[${result.dataArtifact.kind}] ${result.dataArtifact.label}:\n${result.dataArtifact.data.slice(0, 1500)}`,
      }
    }

    await (writeFinding as any).execute({
      type: result.finding?.category ?? primitive.id,
      endpoint: findingUrl,
      method: result.finding?.request?.method,
      payload: result.finding?.request?.body,
      description: result.finding?.description ?? `${primitive.name} confirmed`,
      severity: result.severity ?? 'medium',
      confidence: result.confidence,
      cwe: result.finding?.cwe,
      remediation: result.finding?.remediation,
      // W1: when the oracle proved weaponizability, persist a first-class
      // EXPLOIT_PROOF node (real request/response/impact) via writeFinding.
      ...(proof ? { exploitProof: proof } : {}),
    })
  }

  return { ok: true, result }
}

function evidenceType(kind: EvidenceRef['kind']): 'text' | 'screenshot' | 'har_entry' | 'raw_request' | 'raw_response' {
  switch (kind) {
    case 'request': return 'raw_request'
    case 'response': return 'raw_response'
    case 'oast': return 'text'
    case 'state': return 'text'
    default: return 'text'
  }
}

// ─── Mastra tool: invoke a primitive by id ───────────────────────────────

export const runPrimitiveTool = createTool({
  id: 'runPrimitive',
  description: `Run a technique primitive against a target context. Primitives: ${PRIMITIVE_IDS.join(', ')}. Returns a PrimitiveResult with confirmed/unconfirmed + evidence, verified against the EvidenceGate (T2.5).`,
  inputSchema: z.object({
    primitiveId: z.enum(PRIMITIVE_IDS).describe('Primitive id to run'),
    context: z.object({
      target: z.string().optional().describe('Target base URL'),
      endpointUrl: z.string().optional().describe('Endpoint URL to test'),
      endpointMethod: z.string().optional().default('GET').describe('HTTP method of the endpoint'),
      params: z.array(z.object({ name: z.string(), type: z.string().optional(), in: z.string().optional(), required: z.boolean().optional() })).optional(),
      param: z.string().optional().describe('Specific parameter under test'),
      role: z.string().optional(),
      roles: z.array(z.string()).optional(),
      sessionHeaders: z.record(z.string(), z.string()).optional().describe('Captured session headers for the actor'),
      altSessionHeaders: z.record(z.string(), z.string()).optional().describe('Captured session headers for an alternate actor'),
      objectId: z.string().optional().describe('Object id owned by the actor (IDOR)'),
      altObjectId: z.string().optional().describe('Object id owned by another user (IDOR)'),
      workflowSteps: z.array(z.string()).optional(),
      payloads: z.array(z.string()).optional(),
      state: z.record(z.string(), z.any()).optional(),
      authRequired: z.boolean().optional(),
      authType: z.string().optional(),
      useCase: z.string().optional().describe('Analyser-assigned endpoint use-case (single source of endpoint semantics). Route on this, not URL names.'),
      tags: z.array(z.string()).optional().describe('Typed endpoint tags from the graph (single source of endpoint semantics).'),
      relationSeed: z.object({
        relationType: z.string().describe('Relation type from queryRelations (e.g. REINGESTS). Discover valid values via getGraphSchema.'),
        sourceValue: z.string().describe('The captured value flowing from source to sink.'),
        sinkParam: z.string().describe('The sink parameter/header name that receives it.'),
        sourceKind: z.string().describe('Where the value originates (response-field / cookie / header / ui-input).'),
      }).optional().describe('Optional relation-seeded mutation spec discovered via the relational query seam.'),
      variant: z.string().optional().describe('Technique variant (e.g. "union", "boolean-blind", "time-based", "oob"). Discover available variants via listPrimitiveCapabilities.'),
      dbms: z.string().optional().describe('Target DBMS hint (e.g. "mysql", "postgresql", "mssql", "oracle", "sqlite")'),
      oastHost: z.string().optional().describe('Override OAST callback host for out-of-band primitives'),
      requestTemplate: z.object({
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()),
        body: z.string().optional(),
      }).optional().describe('Captured request to replay with mutations (full headers/body)'),
      payloadSet: z.object({
        category: z.string(),
        variant: z.string().optional(),
        limit: z.number().optional(),
      }).optional().describe('Explicit payload selection from the PayloadStore'),
      multiParam: z.boolean().optional().describe('Test all params, not just ctx.param'),
      concurrency: z.number().optional().describe('Override default concurrency for race tests'),
      maxAttempts: z.number().optional().describe('Override default attempt count'),
    }).describe('Target context for the primitive'),
    commit: z.boolean().optional().default(true).describe('If confirmed, write the finding to the knowledge graph'),
  }),
  execute: async ({ primitiveId, context, commit }: any) => {
    const res = await runPrimitiveById(primitiveId, context ?? {}, { commit: commit !== false })
    return {
      ok: res.ok,
      skipped: res.skipped ?? false,
      reason: res.reason,
      available: res.available,
      result: res.result,
    }
  },
})

export const listPrimitiveCapabilitiesTool = createTool({
  id: 'listPrimitiveCapabilities',
  description: 'List all available technique primitives, their variants, and supported options. Use this to discover what attack variants are available before selecting one via runPrimitive.',
  inputSchema: z.object({
    primitiveId: z.string().optional().describe('If provided, return capabilities for this primitive only. Otherwise list all primitives.'),
  }),
  execute: async ({ primitiveId }: any) => {
    const { getPayloadStore } = await import('../payloads/store')
    const store = getPayloadStore()
    const primitives = primitiveId ? listPrimitives().filter(p => p.id === primitiveId) : listPrimitives()
    return {
      primitives: primitives.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        technique: p.technique,
        variants: store.listVariants(p.id),
      })),
      payloadCategories: store.listCategories(),
    }
  },
})

export { listPrimitives, getPrimitive, registerPrimitive, runPrimitive } from './framework'
export type { TechniquePrimitive, TechniqueContext, PrimitiveResult, AttackStep, StepExecutionResult, EvidenceRef } from './framework'
