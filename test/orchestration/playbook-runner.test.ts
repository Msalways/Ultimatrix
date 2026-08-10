/**
 * Playbook runner tests (Phase 9 / T5 + T8).
 *
 * Execution selection is structural:
 *  - primitive candidates run via the primitive seam (evidence-gated by caller)
 *  - worker candidates run only when a delegate is configured, else skipped
 *  - confirmed count reflects the primitive results, never assumptions
 */
import { describe, it, expect } from 'vitest'
import { runAdvancedPlaybook } from '../../src/orchestration/playbook-runner'
import type {
  AdvancedPlaybook,
  DiagnosisProfile,
  TechniqueCandidate,
} from '../../src/orchestration/types'

function candidate(partial: Partial<TechniqueCandidate>): TechniqueCandidate {
  return {
    id: 'c1',
    primitiveId: 'ssrfOast',
    skillId: 'blind-ssrf',
    name: 'SSRF OAST',
    reason: 'url-like-param matches ssrfOast',
    confidence: 0.8,
    priority: 0,
    requiredContext: [],
    missingContext: [],
    evidenceNeeded: ['raw_request', 'raw_response', 'oast'],
    execution: 'primitive',
    ...partial,
  }
}

function profile(ranked: TechniqueCandidate[], missing: DiagnosisProfile['missingContext'] = []): DiagnosisProfile {
  return {
    target: 'https://app.test',
    summary: {
      endpointCount: 1, authFlowCount: 0, rbacRoleCount: 0, findingCount: 0,
      candidateFindingCount: 0, workflowCount: 0, relationCount: 0,
      hasEndpoints: true, hasAuth: false,
    },
    knownContext: {
      endpoints: [
        { id: 'ep1', url: 'https://app.test/fetch', method: 'GET', params: ['callback'], paramTypes: { callback: 'string' } },
      ],
      authTypes: [], roles: [], authFlows: [], workflows: [], relations: [], findings: [],
      objectIdParams: [], urlLikeParams: ['callback'], graphqlEndpoints: [],
      stateChangingEndpoints: [], hasOast: false, hasReachability: false,
    },
    missingContext: missing,
    attackSurfaces: [],
    rankedTechniques: ranked,
    recommendedSkills: [],
    recommendedPrimitives: [],
    recommendedWorkers: [],
  }
}

function buildPlaybook(profile: DiagnosisProfile, opts?: { selectedCandidateIds?: string[]; maxCandidates?: number }): AdvancedPlaybook {
  let candidates = profile.rankedTechniques
  if (opts?.selectedCandidateIds?.length) {
    candidates = candidates.filter((c) => opts.selectedCandidateIds!.includes(c.id))
  }
  if (opts?.maxCandidates && opts.maxCandidates > 0) {
    candidates = candidates.slice(0, opts.maxCandidates)
  }
  return { candidates, generatedAt: Date.now(), missingContext: profile.missingContext }
}

describe('runAdvancedPlaybook', () => {
  it('executes primitive candidates through the runPrimitive seam', async () => {
    const c = candidate({ id: 'ssrf:ep1', primitiveId: 'ssrfOast', endpointId: 'ep1', param: 'callback' })
    const ran: string[] = []
    const result = await runAdvancedPlaybook(
      { commit: false },
      {
        diagnosis: () => profile([c]),
        buildPlaybook,
        runPrimitive: async (id, ctx, opts) => {
          ran.push(id)
          expect(opts.commit).toBe(false)
          expect(ctx.endpointUrl).toBe('https://app.test/fetch')
          expect(ctx.param).toBe('callback')
          expect(ctx.params).toEqual([{ name: 'callback', type: 'string' }])
          return { ok: true, result: { confirmed: true } }
        },
      },
    )
    expect(ran).toEqual(['ssrfOast'])
    expect(result.executed).toHaveLength(1)
    expect(result.executed[0].confirmed).toBe(true)
    expect(result.confirmed).toBe(1)
    expect(result.unconfirmed).toBe(0)
  })

  it('skips worker candidates when no delegate is configured', async () => {
    const c = candidate({
      id: 'idor:ep1',
      primitiveId: 'idorSwapper',
      execution: 'worker',
      workerId: 'authorization',
      skillId: 'authorization',
      missingContext: [{ context: 'second-user', reason: 'need a second actor', priority: 'high' }],
    })
    const result = await runAdvancedPlaybook(
      {},
      { diagnosis: () => profile([c]), buildPlaybook, runPrimitive: async () => ({ ok: true }) },
    )
    expect(result.executed).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].candidateId).toBe('idor:ep1')
    expect(result.skipped[0].reason).toMatch(/worker delegation required/)
    expect(result.confirmed).toBe(0)
  })

  it('delegates worker candidates when a delegate seam is provided', async () => {
    const c = candidate({
      id: 'idor:ep1',
      primitiveId: 'idorSwapper',
      execution: 'worker',
      workerId: 'authorization',
      skillId: 'authorization',
    })
    const delegated: string[] = []
    const result = await runAdvancedPlaybook(
      {},
      {
        diagnosis: () => profile([c]),
        buildPlaybook,
        delegateWorker: async (cand) => {
          delegated.push(cand.workerId ?? '')
          return { ok: true, note: 'ran exploration' }
        },
      },
    )
    expect(delegated).toEqual(['authorization'])
    expect(result.executed).toHaveLength(1)
    expect(result.executed[0].workerId).toBe('authorization')
    expect(result.loadedSkills).toContain('authorization')
  })

  it('honors selectedCandidateIds', async () => {
    const a = candidate({ id: 'a', primitiveId: 'classicInjection' })
    const b = candidate({ id: 'b', primitiveId: 'ssrfOast' })
    const ran: string[] = []
    const result = await runAdvancedPlaybook(
      { candidateIds: ['b'] },
      {
        diagnosis: () => profile([a, b]),
        buildPlaybook,
        runPrimitive: async (id) => { ran.push(id); return { ok: true, result: { confirmed: false } } },
      },
    )
    expect(ran).toEqual(['ssrfOast'])
    expect(result.unconfirmed).toBe(1)
  })

  it('returns remaining missing context', async () => {
    const missing = [{ context: 'graphql-schema', reason: 'introspect first', priority: 'low' as const }]
    const c = candidate({ id: 'gql', primitiveId: 'graphqlBola' })
    const result = await runAdvancedPlaybook(
      {},
      {
        diagnosis: () => profile([c], missing),
        buildPlaybook,
        runPrimitive: async () => ({ ok: true, result: { confirmed: false } }),
      },
    )
    expect(result.missingContext).toEqual(missing)
  })
})
