/**
 * Technique planner tests (Phase 9 / T3 + T8).
 *
 * Routing must be signal-driven + metadata-driven:
 *  - URL/webhook/callback-like params → SSRF/OAST/cloud primitives ranked first
 *  - authenticated endpoints with object-id params → authz/IDOR/BOLA primitives
 *  - GraphQL surface → GraphQL primitives
 *  - empty signals → no ranking (generic fallback is the caller's concern)
 *  - high-priority missing context → worker delegation via the playbook builder
 */
import { describe, it, expect } from 'vitest'
import '../../src/primitives'
import { listPrimitiveMetadata } from '../../src/primitives'
import {
  rankTechniqueCandidates,
  buildAdvancedPlaybook,
  type PlanContextInput,
} from '../../src/orchestration/technique-planner'
import type { DiagnosisProfile, AttackSurfaceSignal } from '../../src/orchestration/types'

function signal(name: string, endpointIds: string[], paramNames?: string[]): AttackSurfaceSignal {
  return { name, kind: 'signal', endpointIds, paramNames, confidence: 0.8 }
}

function profileWith(
  signals: AttackSurfaceSignal[],
  missingContext: DiagnosisProfile['missingContext'],
  candidates?: DiagnosisProfile['rankedTechniques'],
): DiagnosisProfile {
  return {
    target: 'https://app.test',
    summary: {
      endpointCount: 1, authFlowCount: 0, rbacRoleCount: 0, findingCount: 0,
      candidateFindingCount: 0, workflowCount: 0, relationCount: 0,
      hasEndpoints: true, hasAuth: false,
    },
    knownContext: {
      endpoints: [], authTypes: [], roles: [], authFlows: [], workflows: [], relations: [],
      findings: [], objectIdParams: [], urlLikeParams: [], graphqlEndpoints: [],
      stateChangingEndpoints: [], hasOast: false, hasReachability: false,
    },
    missingContext,
    attackSurfaces: signals,
    rankedTechniques: candidates ?? [],
    recommendedSkills: [],
    recommendedPrimitives: [],
    recommendedWorkers: [],
  }
}

function ctx(partial: Partial<PlanContextInput> = {}): PlanContextInput {
  return {
    signals: [],
    objectIdParams: [],
    urlLikeParams: [],
    graphqlEndpoints: [],
    stateChangingEndpoints: [],
    authBound: false,
    hasSecondOrder: false,
    hasWorkflowOrder: false,
    hasOast: false,
    hasSerialized: false,
    hasCustomHeader: false,
    workflows: 0,
    ...partial,
  }
}

const allMeta = listPrimitiveMetadata()

describe('rankTechniqueCandidates', () => {
  it('ranks SSRF/cloud primitives for URL-shaped params', () => {
    const c = ctx({
      signals: [signal('url-like-param', ['ep1'], ['callback'])],
      urlLikeParams: ['callback'],
    })
    const ranked = rankTechniqueCandidates(c, allMeta, { maxCandidates: 5 })
    expect(ranked.length).toBeGreaterThan(0)
    const top = ranked.slice(0, 3)
    const ssrf = top.filter((r) => ['ssrf', 'oast', 'cloud'].some((t) => (r.primitiveId ?? '').toLowerCase().includes(t)))
    expect(ssrf.length).toBeGreaterThan(0)
    expect(ranked[0].endpointId).toBe('ep1')
  })

  it('ranks authz/IDOR/BOLA primitives for authenticated endpoints with object-id params', () => {
    const c = ctx({
      signals: [
        signal('auth-bound', ['ep1']),
        signal('object-id-param', ['ep1'], ['userId']),
      ],
      objectIdParams: ['userId'],
      authBound: true,
    })
    const ranked = rankTechniqueCandidates(c, allMeta, { maxCandidates: 8 })
    expect(ranked.length).toBeGreaterThan(0)
    const top = ranked.slice(0, 4)
    // Every top candidate must be idor/bola/authz-family (checked via derived tags)
    for (const cand of top) {
      const meta = allMeta.find((m) => m.id === cand.primitiveId)
      const idorFamily = ['idor', 'bola', 'authz', 'authorization', 'bypass', 'privilege', 'swapper']
      expect(meta!.tags.some((t) => idorFamily.includes(t))).toBe(true)
    }
    // The dedicated authz/IDOR primitives must all be present and ranked
    const ids = ranked.map((r) => r.primitiveId)
    expect(ids).toEqual(expect.arrayContaining(['authzMatrix', 'bolaFuzzer', 'idorSwapper']))
    expect(ranked[0].endpointId).toBe('ep1')
  })

  it('ranks GraphQL primitives for a graphql surface', () => {
    const c = ctx({
      signals: [signal('graphql', ['ep2'])],
      graphqlEndpoints: ['https://app.test/graphql'],
    })
    const ranked = rankTechniqueCandidates(c, allMeta, { maxCandidates: 3 })
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.some((r) => (r.primitiveId ?? '').toLowerCase().includes('graphql'))).toBe(true)
  })

  it('ranks workflow/business primitives for ordered actions', () => {
    const c = ctx({
      signals: [signal('workflow-order', [])],
      hasWorkflowOrder: true,
      workflows: 2,
    })
    const ranked = rankTechniqueCandidates(c, allMeta, { maxCandidates: 4 })
    const ids = ranked.map((r) => r.primitiveId)
    expect(ids).toContain('businessLogicAbuse')
    const top = ranked.find((r) => r.primitiveId === 'businessLogicAbuse')!
    expect(top.reason).toContain('workflow-order')
  })

  it('returns no candidates when no signals match (generic fallback unchanged)', () => {
    const ranked = rankTechniqueCandidates(ctx(), allMeta)
    expect(ranked).toEqual([])
  })

  it('attaches the first matching endpoint and param', () => {
    const c = ctx({
      signals: [
        signal('object-id-param', ['ep9'], ['accountId', 'orderId']),
        signal('auth-bound', ['ep9']),
      ],
      objectIdParams: ['accountId'],
      authBound: true,
    })
    const ranked = rankTechniqueCandidates(c, allMeta, { maxCandidates: 1 })
    expect(ranked[0].endpointId).toBe('ep9')
    expect(['accountId', 'orderId']).toContain(ranked[0].param)
  })

  it('produces stable candidate ids', () => {
    const c = ctx({ signals: [signal('url-like-param', ['ep1'], ['url'])], urlLikeParams: ['url'] })
    const a = rankTechniqueCandidates(c, allMeta)
    const b = rankTechniqueCandidates(c, allMeta)
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
    expect(a[0].id.length).toBeGreaterThan(0)
  })
})

describe('buildAdvancedPlaybook', () => {
  it('delegates to a worker when high-priority missing context blocks a candidate', () => {
    const missing = [{
      context: 'second-user',
      reason: 'need a second actor',
      priority: 'high' as const,
      techniqueIds: ['idor', 'bola'],
    }]
    const base = rankTechniqueCandidates(
      ctx({
        signals: [signal('object-id-param', ['ep1'], ['userId']), signal('auth-bound', ['ep1'])],
        objectIdParams: ['userId'],
        authBound: true,
      }),
      allMeta,
      { maxCandidates: 8 },
    )
    const profile = profileWith(
      [signal('object-id-param', ['ep1'], ['userId']), signal('auth-bound', ['ep1'])],
      missing,
      base,
    )
    const playbook = buildAdvancedPlaybook(profile)
    const idor = playbook.candidates.find((c) => c.primitiveId === 'idorSwapper')
    expect(idor).toBeDefined()
    expect(idor!.execution).toBe('worker')
    expect(idor!.workerId).toBe(idor!.skillId)
    expect(idor!.missingContext.some((m) => m.context === 'second-user')).toBe(true)
  })

  it('keeps direct primitive execution when context is sufficient', () => {
    const base = rankTechniqueCandidates(
      ctx({ signals: [signal('url-like-param', ['ep1'], ['callback'])], urlLikeParams: ['callback'] }),
      allMeta,
      { maxCandidates: 3 },
    )
    const playbook = buildAdvancedPlaybook(profileWith([signal('url-like-param', ['ep1'], ['callback'])], [], base))
    for (const c of playbook.candidates) {
      expect(c.execution).toBe('primitive')
    }
  })

  it('honors selectedCandidateIds and maxCandidates', () => {
    const base = rankTechniqueCandidates(
      ctx({ signals: [signal('url-like-param', ['ep1'], ['url'])], urlLikeParams: ['url'] }),
      allMeta,
      { maxCandidates: 5 },
    )
    const selected = [base[0].id]
    const playbook = buildAdvancedPlaybook(profileWith([signal('url-like-param', ['ep1'], ['url'])], [], base), {
      selectedCandidateIds: selected,
      maxCandidates: 1,
    })
    expect(playbook.candidates).toHaveLength(1)
    expect(playbook.candidates[0].id).toBe(selected[0])
  })
})
