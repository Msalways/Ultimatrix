import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkflowStore, coerceWorkflow, createWorkflow, getWorkflowPath } from '../../src/workflow/store'
import { WORKFLOW_STATE_VERSION } from '../../src/workflow/types'
import type { ArtifactRecord } from '../../src/security/artifacts'
import type { SpiderRuntimeState } from '../../src/spider/runtime'
import type { UsageEntry } from '../../src/usage/tracker'
import type { EvidenceItem } from '../../src/intelligence/evidence-ledger'

const TARGET = 'https://workflow-test.example.com'

function makeSpider(overrides: Partial<SpiderRuntimeState> = {}): SpiderRuntimeState {
  return {
    workflowId: 'workflow-fixture',
    target: TARGET,
    frontier: [],
    visitedUrls: ['https://workflow-test.example.com/a', 'https://workflow-test.example.com/b'],
    discoveredForms: [],
    endpoints: [{ method: 'GET', url: 'https://workflow-test.example.com/a', params: [], scope: 'allowed' }],
    authStates: [],
    proposedOrigins: [],
    workflows: [],
    assets: [],
    stopReason: 'frontier_exhausted',
    startedAt: 1000,
    updatedAt: 2000,
    pagesSeen: 2,
    staleRounds: 0,
    ...overrides,
  }
}

function makeEvidence(id: string, timestamp: number, label = id): EvidenceItem {
  return { id, type: 'raw_response', data: '', label, timestamp }
}

function makeUsage(provider: string, model: string, input: number, output: number, timestamp: number): UsageEntry {
  return { provider, model, inputTokens: input, outputTokens: output, totalTokens: input + output, timestamp }
}

function makeArtifact(id: string, workflowId: string): ArtifactRecord {
  return {
    id,
    workflowId,
    kind: 'screenshot',
    status: 'created',
    path: `/tmp/${id}.png`,
    createdAt: new Date().toISOString(),
    provenance: [],
  }
}

describe('createWorkflow', () => {
  it('builds a fresh pending workflow with empty ref collections', () => {
    const wf = createWorkflow(TARGET)
    expect(wf.version).toBe(WORKFLOW_STATE_VERSION)
    expect(wf.target).toBe(TARGET)
    expect(wf.status).toBe('pending')
    expect(wf.workflowId).toMatch(/^workflow-/)
    expect(wf.modelUsage).toEqual([])
    expect(wf.activeWorkers).toEqual([])
    expect(wf.artifacts).toEqual([])
    expect(wf.evidenceRefs).toEqual([])
    expect(wf.spider).toBeUndefined()
  })

  it('honours an explicit workflowId + browserSessionId', () => {
    const wf = createWorkflow(TARGET, 'workflow-explicit', 'browser-7')
    expect(wf.workflowId).toBe('workflow-explicit')
    expect(wf.browserSessionId).toBe('browser-7')
  })
})

describe('coerceWorkflow', () => {
  it('rejects non-objects', () => {
    expect(coerceWorkflow(null, { target: TARGET })).toBeNull()
    expect(coerceWorkflow(42, { target: TARGET })).toBeNull()
    expect(coerceWorkflow('x', { target: TARGET })).toBeNull()
  })

  it('rejects an incompatible version (never silently accepts)', () => {
    expect(coerceWorkflow({ ...createWorkflow(TARGET), version: 99 }, { target: TARGET })).toBeNull()
  })

  it('rejects a missing or empty workflowId', () => {
    const wf = createWorkflow(TARGET) as Record<string, unknown>
    delete wf.workflowId
    expect(coerceWorkflow(wf, { target: TARGET })).toBeNull()
    expect(coerceWorkflow({ ...createWorkflow(TARGET), workflowId: '' }, { target: TARGET })).toBeNull()
  })

  it('rejects a target mismatch', () => {
    expect(coerceWorkflow(createWorkflow(TARGET), { target: 'https://other.example.com' })).toBeNull()
  })

  it('loads missing optional fields safely as empty/undefined', () => {
    const wf = createWorkflow(TARGET, 'workflow-coerce', 'browser-1')
    const asUnknown = { ...wf } as Record<string, unknown>
    delete asUnknown.spider
    delete asUnknown.modelUsage
    delete asUnknown.browserSessionId
    const coerced = coerceWorkflow(asUnknown, { target: TARGET })
    expect(coerced).not.toBeNull()
    expect(coerced!.workflowId).toBe('workflow-coerce')
    expect(coerced!.spider).toBeUndefined()
    expect(coerced!.modelUsage).toEqual([])
    expect(coerced!.browserSessionId).toBeUndefined()
  })

  it('normalises an unknown status to pending', () => {
    const wf = createWorkflow(TARGET, 'workflow-status')
    expect(coerceWorkflow({ ...wf, status: 'exploding' }, { target: TARGET })!.status).toBe('pending')
  })
})

describe('WorkflowStore', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ultimatrix-workflow-'))
  })

  afterAll(async () => {
    // best-effort; leave dirs if removal fails
    await import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true })).catch(() => {})
  })

  it('loadOrCreate persists a fresh workflow and reloads the same id', async () => {
    const path = join(dir, 'fresh', 'workflow.json')
    const store = await WorkflowStore.loadOrCreate(path, { target: TARGET })
    expect(store.state.status).toBe('pending')
    expect(store.state.workflowId).toMatch(/^workflow-/)

    const reloaded = await WorkflowStore.loadOrCreate(path, { target: TARGET })
    expect(reloaded.state.workflowId).toBe(store.state.workflowId)
    expect(reloaded.state.target).toBe(TARGET)
  })

  it('recovers from a corrupt snapshot by creating a fresh workflow', async () => {
    const path = join(dir, 'corrupt', 'workflow.json')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(dir, 'corrupt'), { recursive: true }))
    await writeFile(path, '{ not json', 'utf8')
    const store = await WorkflowStore.loadOrCreate(path, { target: TARGET })
    expect(store.state.workflowId).toMatch(/^workflow-/)
    expect(store.state.target).toBe(TARGET)
  })

  it('loadOrCreate resumes a persisted workflow with spider + refs intact', async () => {
    const path = join(dir, 'resume', 'workflow.json')
    const first = await WorkflowStore.loadOrCreate(path, { target: TARGET, workflowId: 'workflow-resume' })
    first.attachSpider(makeSpider())
    first.recordEvidence({ id: 'ev-1', kind: 'raw_response', label: 'login', recordedAt: 500 })
    await first.save()

    const resumed = await WorkflowStore.loadOrCreate(path, { target: TARGET })
    expect(resumed.state.workflowId).toBe('workflow-resume')
    expect(resumed.state.spider?.visitedUrls).toEqual(['https://workflow-test.example.com/a', 'https://workflow-test.example.com/b'])
    expect(resumed.state.evidenceRefs).toEqual([{ id: 'ev-1', kind: 'raw_response', label: 'login', recordedAt: 500 }])
  })

  it('persists the on-disk JSON as a versioned snapshot', async () => {
    const path = join(dir, 'disk', 'workflow.json')
    const store = await WorkflowStore.loadOrCreate(path, { target: TARGET, workflowId: 'workflow-disk' })
    store.setBrowserSessionId('browser-9')
    await store.save()
    const raw = JSON.parse(await readFile(path, 'utf8'))
    expect(raw.version).toBe(WORKFLOW_STATE_VERSION)
    expect(raw.workflowId).toBe('workflow-disk')
    expect(raw.browserSessionId).toBe('browser-9')
  })
})

describe('WorkflowStore mutators', () => {
  /** Build a bare store with a backdated createdAt so updatedAt churn is observable. */
  function bareStore(id: string): WorkflowStore {
    const state = createWorkflow(TARGET, id)
    state.createdAt = '2000-01-01T00:00:00.000Z'
    state.updatedAt = '2000-01-01T00:00:00.000Z'
    return new (WorkflowStore as any)(null, state) as WorkflowStore
  }

  it('attachSpider embeds the crawl state and marks the workflow running', () => {
    const store = bareStore('workflow-m')
    store.attachSpider(makeSpider())
    expect(store.state.status).toBe('running')
    expect(store.state.spider?.pagesSeen).toBe(2)
  })

  it('setStatus / setBrowserSessionId / setDecisionLedgerId update typed fields', () => {
    const store = bareStore('workflow-m2')
    store.setStatus('completed')
    store.setBrowserSessionId('browser-1')
    store.setDecisionLedgerId('ledger-1')
    expect(store.state.status).toBe('completed')
    expect(store.state.browserSessionId).toBe('browser-1')
    expect(store.state.decisionLedgerId).toBe('ledger-1')
    expect(store.state.updatedAt).not.toBe(store.state.createdAt)
  })

  it('recordWorker upserts by workerId', () => {
    const store = bareStore('workflow-w')
    store.recordWorker({ workerId: 'w1', skillId: 'recon', task: 'scan', status: 'queued' })
    store.recordWorker({ workerId: 'w1', skillId: 'recon', task: 'scan', status: 'running', modelId: 'llama' })
    expect(store.state.activeWorkers).toHaveLength(1)
    expect(store.state.activeWorkers[0]).toMatchObject({ workerId: 'w1', status: 'running', modelId: 'llama' })
    store.recordWorker({ workerId: 'w2', skillId: 'injection', task: 'fuzz', status: 'completed' })
    expect(store.state.activeWorkers).toHaveLength(2)
  })

  it('recordArtifact only records artifacts of this workflow and dedupes by id', () => {
    const store = new (WorkflowStore as any)(null, createWorkflow(TARGET, 'workflow-a')) as WorkflowStore
    store.recordArtifact(makeArtifact('a1', 'workflow-a'))
    store.recordArtifact(makeArtifact('a1', 'workflow-a'))
    store.recordArtifact(makeArtifact('a2', 'workflow-OTHER'))
    expect(store.state.artifacts).toHaveLength(1)
    expect(store.state.artifacts[0]).toMatchObject({ id: 'a1', kind: 'screenshot' })
  })

  it('recordEvidence dedupes by id and never carries raw data', () => {
    const store = new (WorkflowStore as any)(null, createWorkflow(TARGET, 'workflow-e')) as WorkflowStore
    store.recordEvidence({ id: 'ev-1', kind: 'text', recordedAt: 1 })
    store.recordEvidence({ id: 'ev-1', kind: 'text', recordedAt: 2 })
    store.recordEvidence({ id: 'ev-2', kind: 'screenshot', label: 'shot', recordedAt: 3 })
    expect(store.state.evidenceRefs).toHaveLength(2)
    expect(store.state.evidenceRefs.every((r) => !('data' in r))).toBe(true)
  })
})

describe('WorkflowStore sync helpers', () => {
  it('syncModelUsage aggregates per provider/model within the lifetime window', () => {
    const store = new (WorkflowStore as any)(null, createWorkflow(TARGET, 'workflow-u')) as WorkflowStore
    const base = 1000000
    store.syncModelUsage(
      [
        makeUsage('groq', 'llama3-8b', 100, 50, base),
        makeUsage('groq', 'llama3-8b', 200, 25, base + 1),
        makeUsage('openai', 'gpt-4o', 1000, 500, base + 2),
      ],
      base,
    )
    expect(store.state.modelUsage).toHaveLength(2)
    const groq = store.state.modelUsage.find((m) => m.provider === 'groq')
    expect(groq).toMatchObject({ model: 'llama3-8b', inputTokens: 300, outputTokens: 75, totalTokens: 375, calls: 2 })
  })

  it('syncModelUsage drops entries recorded before the workflow lifetime', () => {
    const store = new (WorkflowStore as any)(null, createWorkflow(TARGET, 'workflow-u2')) as WorkflowStore
    store.syncModelUsage(
      [makeUsage('groq', 'llama3-8b', 10, 10, 1), makeUsage('groq', 'llama3-8b', 20, 20, 2)],
      2,
    )
    expect(store.state.modelUsage).toHaveLength(1)
    expect(store.state.modelUsage[0].totalTokens).toBe(40)
  })

  it('syncEvidence folds session evidence into compact refs and replaces the collection', () => {
    const store = new (WorkflowStore as any)(null, createWorkflow(TARGET, 'workflow-e2')) as WorkflowStore
    store.recordEvidence({ id: 'stale', kind: 'text', recordedAt: 1 })
    store.syncEvidence(
      [makeEvidence('ev-new', 5, 'login ok'), makeEvidence('ev-old', 1, 'before lifetime')],
      2,
    )
    expect(store.state.evidenceRefs).toHaveLength(1)
    expect(store.state.evidenceRefs[0]).toMatchObject({ id: 'ev-new', kind: 'raw_response', label: 'login ok', recordedAt: 5 })
  })
})

describe('getWorkflowPath', () => {
  it('points at a per-target workflow.json inside the target directory', () => {
    const path = getWorkflowPath('https://host.example/path')
    expect(path.endsWith('workflow.json')).toBe(true)
    expect(path.toLowerCase()).not.toContain('unsafe')
  })
})
