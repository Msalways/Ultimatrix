import { describe, it, expect, beforeEach } from 'vitest'
import { ModelSelector } from '../../src/models/selector'
import { complexityToTier, proposalToWorkerConfig } from '../../src/council/types'
import { resetAllProviderLimiters } from '../../src/models/limiter-factory'
import { resetGlobalQuotaTracker } from '../../src/models/quota-tracker'
import type { UltimatrixConfig } from '../../src/config'

function makeConfig(): UltimatrixConfig {
  return {
    provider: 'nvidia',
    model: 'nvidia/nemotron-3-super-120b',
    depth: 2,
    timeout: 60000,
    creds: { nvidia: { apiKey: 'nv_x' } },
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    budgetPolicy: { enforcement: 'soft', scope: 'session', resetOn: 'never', allocation: { brain: 0.3, workers: 0.6, spider: 0.1 }, maxModelCallsPerTask: 15, trackTokens: false },
    modelTiers: {
      fast: { provider: 'nvidia', model: 'nvidia/nemotron-nano-9b-v2' },
      balanced: { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b' },
      powerful: { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
    },
  }
}

describe('C2: tier-map consistency — council add-on vs dynamic worker engine', () => {
  beforeEach(() => {
    resetAllProviderLimiters()
    resetGlobalQuotaTracker()
  })

  const complexities = ['low', 'medium', 'high', 'critical'] as const

  for (const c of complexities) {
    it(`complexity '${c}': council complexityToTier matches dynamic engine routing tier`, () => {
      const config = makeConfig()
      const selector = new ModelSelector({}, config.budgetPolicy!, config)
      const sel = selector.selectForTask(
        { skillId: 'recon', taskDescription: 'probe', complexity: c },
        'worker',
      )
      // Council add-on's translation must agree with the dynamic worker engine's
      // own COMPLEXITY_TIER_MAP used when council triggers a worker on demand.
      expect(sel.tier).toBe(complexityToTier(c))
    })
  }

  it('C4: proposalToWorkerConfig derives tier rigidly from complexity (no skill-meaning scan)', () => {
    for (const c of complexities) {
      const wc = proposalToWorkerConfig({
        action: 'do',
        skillId: 'injection',
        complexity: c,
        impact: 'high',
        reasoning: '',
        evidenceRequired: [],
      })
      expect(wc.tier).toBe(complexityToTier(c))
    }
  })

})
