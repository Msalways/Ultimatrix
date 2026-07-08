import { describe, expect, it } from 'vitest'
import { GraphStore } from '../../src/graph/store'
import { extractWorkflows } from '../../src/research/workflow-extractor'
import { extractEntities } from '../../src/research/entity-extractor'
import { generateHypotheses } from '../../src/research/hypothesis-engine'
import { planExperiments } from '../../src/research/experiment-planner'
import { compareResearchResponses } from '../../src/research/differential'
import { candidateFromExperiment } from '../../src/research/candidate-store'

function seededStore(): GraphStore {
  const store = new GraphStore('test-output/research-graph.json')
  store.addEndpoint({
    method: 'GET',
    url: 'https://app.test/api/projects/123',
    params: [{ name: 'id', type: 'string', in: 'path' }],
    authRequired: true,
    headers: { authorization: 'Bearer token-a' },
    source: 'test',
  })
  store.addEndpoint({
    method: 'PATCH',
    url: 'https://app.test/api/orgs/777/members/123',
    params: [
      { name: 'role', type: 'string', in: 'body' },
      { name: 'userId', type: 'string', in: 'body' },
    ],
    authRequired: true,
    source: 'test',
  })
  return store
}

describe('research engine', () => {
  it('extracts workflows and entities from graph endpoints', () => {
    const store = seededStore()
    const workflows = extractWorkflows(store)
    const entities = extractEntities(store)

    expect(workflows.length).toBeGreaterThan(0)
    expect(entities.map(e => e.name)).toContain('Projects')
    expect(entities.some(e => e.roleFields.includes('role'))).toBe(true)
  })

  it('generates hypotheses and plans experiments', () => {
    const store = seededStore()
    const workflows = extractWorkflows(store)
    const entities = extractEntities(store)
    const hypotheses = generateHypotheses(store, workflows, entities)
    const experiments = planExperiments(store, hypotheses)

    expect(hypotheses.some(h => h.kind === 'idor')).toBe(true)
    expect(hypotheses.some(h => h.kind === 'mass_assignment')).toBe(true)
    expect(experiments.some(e => e.requiredActors.includes('actor-b'))).toBe(true)
  })

  it('compares responses and creates a candidate from interesting differentials', () => {
    const store = seededStore()
    const hypothesis = generateHypotheses(store, extractWorkflows(store), extractEntities(store))[0]
    const experiment = planExperiments(store, [hypothesis])[0]
    const differential = compareResearchResponses(
      { status: 403, body: '{"error":"forbidden"}' },
      { status: 200, body: '{"email":"victim@app.test","role":"owner"}' },
    )
    const candidate = candidateFromExperiment(experiment, differential)

    expect(differential.interesting).toBe(true)
    expect(differential.authorizationMismatch).toBe(true)
    expect(candidate.severity).toBe('high')
    expect(candidate.nextVerificationSteps.length).toBeGreaterThan(0)
  })
})
