/**
 * Cross-engagement memory policy-gate tests — Slice 11.
 *
 * Proves recordEngagementSummary routes through the shared memory-policy gate:
 * anonymized summaries are recorded; any target-sensitive content (raw URLs,
 * hostnames, secrets) fails CLOSED with a MemoryPolicyError and nothing is
 * persisted.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CrossEngagementMemory, type EngagementSummary } from '../../src/intelligence/cross-engagement'
import { MemoryPolicyError } from '../../src/memory/policy'
import { getGlobalDecisionLedger } from '../../src/security/decision-ledger'

let dir: string
function tempMem(): CrossEngagementMemory {
  dir = mkdtempSync(join(tmpdir(), 'ultimatrix-cross-eng-'))
  return new CrossEngagementMemory({ path: join(dir, 'cross-engagement.json') })
}

function summary(overrides: Partial<EngagementSummary> = {}): EngagementSummary {
  return {
    targetOrigin: 'https://example.com',
    techniques: [
      { techniqueId: 'classicInjection', fired: true, endpointShape: { pathTokens: ['api', 'users', ':id'], method: 'GET', paramNames: ['id'] } },
      { techniqueId: 'idorSwapper', fired: false },
    ],
    findings: [
      { vulnType: 'sql-injection', techniqueId: 'classicInjection', confidence: 0.9, endpointShape: { pathTokens: ['api', 'users', ':id'], method: 'GET', paramNames: ['id'] } },
    ],
    failedPatterns: ['waf-block'],
    effectiveSequences: [['classicInjection', 'verifyChains']],
    ...overrides,
  }
}

beforeEach(() => {
  getGlobalDecisionLedger().clear()
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('recordEngagementSummary policy gate', () => {
  it('records an anonymized summary', async () => {
    const mem = tempMem()
    await mem.recordEngagementSummary(summary())
    expect(mem.getEngagementCount()).toBe(1)

    const priors = mem.getPriorPatterns()
    expect(priors.topTechniques.length).toBeGreaterThan(0)
    expect(priors.promptBlock).toContain('classicInjection')
  })

  it('never persists the target origin or hostnames', async () => {
    const mem = tempMem()
    await mem.recordEngagementSummary(summary())
    expect(existsSync(mem.getPath())).toBe(true)
    const raw = readFileSync(mem.getPath(), 'utf-8')
    expect(raw).not.toContain('example.com')
    expect(raw).not.toContain('https://')
  })

  it('fails CLOSED when a summary contains a raw URL', async () => {
    const mem = tempMem()
    await expect(
      mem.recordEngagementSummary(summary({ failedPatterns: ['see https://target.internal/api for evidence'] })),
    ).rejects.toThrow(MemoryPolicyError)
    expect(mem.getEngagementCount()).toBe(0)
    expect(existsSync(mem.getPath())).toBe(false)
  })

  it('fails CLOSED when a technique observation carries a secret-shaped value', async () => {
    const mem = tempMem()
    await expect(
      mem.recordEngagementSummary(
        summary({
          findings: [{ vulnType: 'sql-injection', techniqueId: 'classicInjection', confidence: 0.9, endpointShape: { pathTokens: ['x'], method: 'GET', paramNames: ['Bearer abcdefghijklmnop'] } }],
        }),
      ),
    ).rejects.toThrow(MemoryPolicyError)
    expect(mem.getEngagementCount()).toBe(0)
  })

  it('records the policy decision on the ledger for inspectability', async () => {
    const mem = tempMem()
    await mem.recordEngagementSummary(summary())
    await expect(mem.recordEngagementSummary(summary({ failedPatterns: ['https://leak.example/x'] }))).rejects.toThrow()

    const decisions = getGlobalDecisionLedger().listDecisions('memory.policy')
    expect(decisions.length).toBe(2)
    expect(decisions.some(d => d.reason.includes('blocked'))).toBe(true)
    expect(decisions.some(d => d.reason.includes('safe'))).toBe(true)
  })
})
