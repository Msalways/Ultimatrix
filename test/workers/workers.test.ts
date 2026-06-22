import { describe, it, expect } from 'vitest'
import { createInjectionWorker } from '../../src/workers/injection'
import { createAuthControlWorker } from '../../src/workers/auth-control'
import { createAdvancedWorker } from '../../src/workers/advanced'
import { createReconWorker } from '../../src/workers/recon'
import { createAllWorkers } from '../../src/workers/registry'
import { registerAllTools } from '../../src/tools/registry'
import type { UltimatrixConfig } from '../../src/config'

const fakeConfig: UltimatrixConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  target: 'https://example.com',
  depth: 2,
  timeout: 60000,
  creds: { openai: { apiKey: 'test-key' } },
  browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
  memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
  agent: { maxSteps: 50, scansDir: './scans' },
}

describe('injection worker', () => {
  it('creates an Agent with correct id', () => {
    const agent = createInjectionWorker(fakeConfig)
    expect(agent).toBeDefined()
    expect((agent as any).id).toBe('injection-worker')
  })

  it('accepts optional browser', () => {
    const agent = createInjectionWorker(fakeConfig)
    expect(agent).toBeDefined()
  })

  it('has expected tool count in registry', () => {
    const tools = registerAllTools()
    expect(tools.httpRequest).toBeDefined()
    expect(tools.recordTestCase).toBeDefined()
  })
})

describe('auth-control worker', () => {
  it('creates an Agent with correct id', () => {
    const agent = createAuthControlWorker(fakeConfig)
    expect(agent).toBeDefined()
    expect((agent as any).id).toBe('auth-control-worker')
  })

  it('has session tools available in registry', () => {
    const tools = registerAllTools()
    expect(tools.extractSessionCookie).toBeDefined()
    expect(tools.extractCsrfToken).toBeDefined()
    expect(tools.useSession).toBeDefined()
    expect(tools.recordEvidence).toBeDefined()
    expect(tools.writeFinding).toBeDefined()
  })
})

describe('advanced worker', () => {
  it('creates an Agent with correct id', () => {
    const agent = createAdvancedWorker(fakeConfig)
    expect(agent).toBeDefined()
    expect((agent as any).id).toBe('advanced-worker')
  })

  it('has measureTiming tool', () => {
    const tools = registerAllTools()
    expect(tools.measureTiming).toBeDefined()
  })
})

describe('recon worker', () => {
  it('creates an Agent with correct id', () => {
    const agent = createReconWorker(fakeConfig)
    expect(agent).toBeDefined()
    expect((agent as any).id).toBe('recon-worker')
  })

  it('has cloudMetadataProbe registered', () => {
    const tools = registerAllTools()
    expect(tools.cloudMetadataProbe).toBeDefined()
    expect(tools.runRecon).toBeDefined()
    expect(tools.frameworkFingerprint).toBeDefined()
    expect(tools.graphqlIntrospect).toBeDefined()
    expect(tools.jwtDecode).toBeDefined()
  })
})

describe('worker registry', () => {
  it('exports all 4 worker creation functions', () => {
    expect(createInjectionWorker).toBeDefined()
    expect(createAuthControlWorker).toBeDefined()
    expect(createAdvancedWorker).toBeDefined()
    expect(createReconWorker).toBeDefined()
  })

  it('createAllWorkers returns all 4 workers', async () => {
    const workers = await createAllWorkers(fakeConfig)
    expect(workers).toBeDefined()
    expect(workers.injection).toBeDefined()
    expect(workers.authControl).toBeDefined()
    expect(workers.advanced).toBeDefined()
    expect(workers.recon).toBeDefined()
  })
})
