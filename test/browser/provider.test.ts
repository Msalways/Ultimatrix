import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isBrowserProviderName, resolveBrowserProvider, type BrowserProviderName } from '../../src/browser/provider'
import type { UltimatrixConfig } from '../../src/config'
import { createWorkflow, coerceWorkflow, WorkflowStore } from '../../src/workflow/store'

function config(provider: BrowserProviderName = 'stagehand'): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    target: 'https://example.com',
    depth: 2,
    timeout: 60000,
    creds: { groq: { apiKey: 'gsk_xxx' } },
    browser: { provider, headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0, sessionScope: 'workflow' },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
  } as UltimatrixConfig
}

describe('BrowserProviderName', () => {
  it('accepts only the closed typed union', () => {
    expect(isBrowserProviderName('stagehand')).toBe(true)
    expect(isBrowserProviderName('camofox')).toBe(true)
    expect(isBrowserProviderName('firefox')).toBe(false)
    expect(isBrowserProviderName(undefined)).toBe(false)
  })
})

describe('resolveBrowserProvider', () => {
  it('resolves the default stagehand provider', () => {
    const provider = resolveBrowserProvider(config('stagehand'))
    expect(provider.name).toBe('stagehand')
  })

  it('defaults to stagehand when no provider is configured', () => {
    const cfg = config('stagehand')
    ;(cfg.browser as { provider?: string }).provider = undefined
    const provider = resolveBrowserProvider(cfg)
    expect(provider.name).toBe('stagehand')
  })

  it('fails clearly for a planned-but-unimplemented provider (camofox)', () => {
    expect(() => resolveBrowserProvider(config('camofox'))).toThrow(/planned but not yet implemented/)
  })

  it('fails clearly for an unknown provider', () => {
    const cfg = config('stagehand')
    ;(cfg.browser as { provider?: string }).provider = 'firefox' as never
    expect(() => resolveBrowserProvider(cfg)).toThrow(/Unsupported browser provider/)
  })
})

describe('WorkflowState browserProvider (Slice 05)', () => {
  it('createWorkflow records the provider', () => {
    const wf = createWorkflow('https://example.com', 'wf-provider', undefined, 'stagehand')
    expect(wf.browserProvider).toBe('stagehand')
    const wf2 = createWorkflow('https://example.com')
    expect(wf2.browserProvider).toBeUndefined()
  })

  it('coerceWorkflow round-trips a valid provider and drops invalid values', () => {
    const wf = createWorkflow('https://example.com', 'wf-provider', undefined, 'stagehand')
    expect(coerceWorkflow({ ...wf }, { target: 'https://example.com' })!.browserProvider).toBe('stagehand')

    const bogus = { ...wf, browserProvider: 'firefox' } as Record<string, unknown>
    expect(coerceWorkflow(bogus, { target: 'https://example.com' })!.browserProvider).toBeUndefined()
  })

  it('setBrowserProvider mutator records the fixed provider', () => {
    const store = new (WorkflowStore as any)(null, createWorkflow('https://example.com', 'wf-mutator')) as WorkflowStore
    expect(store.state.browserProvider).toBeUndefined()
    store.setBrowserProvider('stagehand')
    expect(store.state.browserProvider).toBe('stagehand')
  })
})

describe('WorkflowStore resume provider mismatch (Slice 05)', () => {
  it('rejects resuming a workflow created with a different provider', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultimatrix-provider-'))
    try {
      const path = join(dir, 'workflow.json')
      const first = await WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'stagehand' })
      await first.save()

      await expect(
        WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'camofox' }),
      ).rejects.toThrow(/one workflow maps to one browser provider/i)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('resumes fine when the provider matches or the persisted workflow has no provider', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ultimatrix-provider2-'))
    try {
      const path = join(dir, 'workflow.json')
      const first = await WorkflowStore.loadOrCreate(path, { target: 'https://example.com' })
      await first.save()

      const resumed = await WorkflowStore.loadOrCreate(path, { target: 'https://example.com', browserProvider: 'stagehand' })
      expect(resumed.state.workflowId).toBe(first.state.workflowId)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
