import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/safety/scope-guard', () => ({
  isUrlInScope: () => ({ allowed: true }),
}))

vi.mock('../../src/tools/http-tools', () => ({
  httpRequest: {
    execute: vi.fn(),
  },
}))

vi.mock('../../src/browser/manager', () => ({
  captureScreenshot: vi.fn().mockResolvedValue(null),
  getActiveBrowser: () => ({ providerName: 'camofox' }),
}))

vi.mock('../../src/browser/dialog-inject', () => ({
  wrapStagehandTools: () => ({
    stagehand_navigate: {
      execute: vi.fn().mockResolvedValue({
        success: true,
        browserAction: { evidenceIds: ['browser-evidence-1'] },
      }),
    },
  }),
}))

vi.mock('../../src/core/evidence', () => ({
  coreEvidenceLedger: {
    record: vi.fn(),
    all: () => [{
      id: 'browser-evidence-1',
      type: 'browser_effect',
      data: 'effect',
      label: 'effect',
      timestamp: Date.now(),
      observed: { browserEffects: { 'state:ready': 'reproduced' } },
    }],
  },
}))

import { httpRequest } from '../../src/tools/http-tools'
import { replayExploitProof } from '../../src/tools/control-tools'
import type { ExploitProofNode } from '../../src/graph/schema'

function proof(overrides: Partial<ExploitProofNode['properties']> = {}): ExploitProofNode {
  return {
    id: 'proof-1',
    type: 'ExploitProof' as any,
    label: 'proof',
    properties: {
      findingId: 'idor:https://target.test/object:*',
      title: 'proof',
      method: 'POST',
      url: 'https://target.test/object/2',
      headers: { cookie: 'sid=actor-a' },
      body: 'id=2',
      expectedVulnerableResponse: 'victim-record',
      reproSteps: [],
      replayable: true,
      status: 'proposed',
      ...overrides,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('exploit proof replay', () => {
  it('replays structured proof material through the scoped HTTP tool', async () => {
    ;(httpRequest.execute as any).mockResolvedValue({
      ok: true,
      value: { status: 200, body: '{"record":"victim-record"}' },
    })

    const result = await replayExploitProof(proof())

    expect(result).toMatchObject({ ok: true, replayed: true, status: 200 })
    expect(httpRequest.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://target.test/object/2',
        headers: { cookie: 'sid=actor-a' },
        body: 'id=2',
      }),
      expect.anything(),
    )
  })

  it('does not claim a replay when the proof has no deterministic oracle', async () => {
    ;(httpRequest.execute as any).mockClear()
    const result = await replayExploitProof(proof({ expectedVulnerableResponse: undefined }))

    expect(result).toMatchObject({ ok: false, replayed: false })
    expect(httpRequest.execute).not.toHaveBeenCalled()
  })

  it('replays a typed browser proof and checks the recorded browser effect', async () => {
    const result = await replayExploitProof(proof({
      transport: 'browser',
      browserSteps: [{ toolId: 'stagehand_navigate', input: { url: 'https://target.test/object/2' } }],
      browserEffectKey: 'state:ready',
      browserEffectValue: 'reproduced',
      expectedVulnerableResponse: undefined,
    }))

    expect(result).toMatchObject({ ok: true, replayed: true })
  })

  it('does not turn a transport/policy failure into a disproven result', async () => {
    ;(httpRequest.execute as any).mockResolvedValue({ ok: false, error: 'rate limit' })
    const result = await replayExploitProof(proof())

    expect(result).toMatchObject({ ok: false, replayed: false })
  })
})
