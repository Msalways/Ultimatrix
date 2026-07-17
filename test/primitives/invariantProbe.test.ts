import { describe, it, expect } from 'vitest'
import { invariantProbe } from '../../src/primitives/invariantProbe'
import type { TechniqueContext } from '../../src/primitives/framework'

describe('invariantProbe: relation-seeded path', () => {
  it('generates baseline + relation-seeded mutation steps when relationSeed is set', async () => {
    const ctx: TechniqueContext = {
      target: 'https://x.com/users/99/orders',
      endpoint: { url: 'https://x.com/users/99/orders', method: 'POST' },
      sessionHeaders: { authorization: 'Bearer t' },
      relationSeed: {
        relationType: 'REINGESTS',
        sourceValue: '42',
        sinkParam: 'id',
        sourceKind: 'response-field',
      },
    }

    const steps = await invariantProbe.generate(ctx)

    // Baseline present + at least one seeded mutation.
    expect(steps.some((s) => s.id === 'invariant-baseline')).toBe(true)
    const seeded = steps.filter((s) => s.id.startsWith('invariant-seed-'))
    expect(seeded.length).toBeGreaterThan(0)

    // At least one seeded mutation targets the sink param directly.
    expect(seeded.some((s) => s.request.url.includes('id='))).toBe(true)
  })

  it('still produces baseline+mutated steps when no relationSeed is given', async () => {
    const ctx: TechniqueContext = {
      target: 'https://x.com/api/ping',
      endpoint: { url: 'https://x.com/api/ping', method: 'GET' },
    }
    const steps = await invariantProbe.generate(ctx)
    expect(steps.map((s) => s.id)).toEqual(['invariant-baseline', 'invariant-mutated'])
  })
})
