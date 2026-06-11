import { describe, it, expect } from 'vitest'
import { createInjectionWorker } from './injection'
import { createAuthControlWorker } from './auth-control'
import { createAdvancedWorker } from './advanced'
import { createReconWorker } from './recon'
import { createAllWorkers } from './registry'
import { registerAllTools } from '../tools/registry'

const fakeModel = { id: 'test-model', provider: 'openai' } as any

describe('injection worker', () => {
  it('creates an Agent with correct id', () => {
    const agent = createInjectionWorker(fakeModel)
    expect(agent).toBeDefined()
    expect((agent as any).id).toBe('injection-worker')
  })

  it('accepts optional recorder and wraps tools', () => {
    const fakeRecorder = { record: () => {} } as any
    const agent = createInjectionWorker(fakeModel, undefined, undefined, fakeRecorder)
    expect(agent).toBeDefined()
  })

  it('has expected tool count in registry', () => {
    const tools = registerAllTools()
    expect(tools.httpRequest).toBeDefined()
    expect(tools.injectInContext).toBeDefined()
    expect(tools.stagehandAct).toBeDefined()
  })
})

describe('auth-control worker', () => {
  it('creates an Agent with correct id', () => {
    const agent = createAuthControlWorker(fakeModel)
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
    const agent = createAdvancedWorker(fakeModel)
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
    const agent = createReconWorker(fakeModel)
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
  it('createAllWorkers returns all 4 workers', async () => {
    const workers = await createAllWorkers(fakeModel)
    expect(workers).toBeDefined()
    expect(workers.injection).toBeDefined()
    expect(workers.authControl).toBeDefined()
    expect(workers.advanced).toBeDefined()
    expect(workers.recon).toBeDefined()
  })
})
