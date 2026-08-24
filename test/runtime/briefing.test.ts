/**
 * Phase D — briefing builder (spec 04 D2 + spec 05 EV5).
 *
 * Deterministic prose from typed stores only: coverage, captured traffic,
 * evolution delta, draft-skill awareness. No LLM, no keyword logic.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCapturedRequestStore } from '../../src/capture/captured-request-store'

beforeEach(() => {
  getCapturedRequestStore().clear()
})

describe('buildBriefing', () => {
  it('renders state lines with stats backing', async () => {
    const wsMod = await import('../../src/workspace')
    const workspace = new wsMod.WorkspaceManager(mkdtempSync(join(tmpdir(), 'brief-')))
    workspace.useTargetStores('https://brief.example', null as any, null as any)

    const engCtx = await import('../../src/runtime/engagement-context')
    const services = {
      workspace,
      graph: null,
      oast: {} as any, decisions: {} as any, artifacts: {} as any, evidence: {} as any,
      usage: {} as any, forensicLog: {} as any, humanObserver: {} as any, reactionObserver: {} as any,
      dialogWatcher: {} as any, recorder: null, browserManager: {} as any, passiveObserver: {} as any,
      botHandler: {} as any, oastConfig: null, events: {} as any, httpSessions: {} as any,
      quota: {} as any, toolEvents: {} as any, providerLimiters: new Map(),
      findingState: {} as any, scopeConfig: null, externalTools: null, allowAny: false,
    }
    const captureMod = await import('../../src/capture/captured-request-store')
    captureMod.getCapturedRequestStore().record({ method: 'GET', url: 'https://brief.example/a' })

    const { buildBriefing } = await import('../../src/runtime/briefing')
    const briefing = engCtx.runWithEngagementServices(services as any, () => buildBriefing())

    expect(briefing.prose).toMatch(/endpoints/)
    expect(briefing.prose).toMatch(/1 captured request/)
    expect(briefing.stats.capturedRequests).toBe(1)
    expect(typeof briefing.stats.evolvedTechniques).toBe('number')
    expect(typeof briefing.stats.draftSkills).toBe('number')
  })

  it('shows evolution lines when techniques have outcomes', async () => {
    const engCtx = await import('../../src/runtime/engagement-context')
    const evolution = await import('../../src/intelligence/evolution')
    evolution.resetEvolution()
    evolution.recordTechniqueConfirmed('classicInjection')

    const services = { allowAny: false } as any
    const wsMod = await import('../../src/workspace')
    const workspace = new wsMod.WorkspaceManager(mkdtempSync(join(tmpdir(), 'brief2-')))
    workspace.useTargetStores('https://brief2.example', null as any, null as any)
    ;(services as any).workspace = workspace

    const { buildBriefing } = await import('../../src/runtime/briefing')
    const briefing = engCtx.runWithEngagementServices(services, () => buildBriefing())
    expect(briefing.prose).toMatch(/Evolution this session/)
    expect(briefing.stats.evolvedTechniques).toBeGreaterThan(0)
    evolution.resetEvolution()
  })
})
