import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureDir, loadWorkingMemory, saveWorkingMemory, addEndpointTest, addFinding, isAlreadyTested, loadThreadsIndex, saveThreadsIndex, createThread, switchThread, updateTarget } from '../../src/memory/store'

describe('memory/store', () => {
  const threadId = 'test-thread-1'
  let tmpDir: string
  const origCwd = process.cwd()

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'memory-store-'))
    process.chdir(tmpDir)
    await ensureDir()
  })

  afterAll(() => {
    process.chdir(origCwd)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loadWorkingMemory returns default state for new thread', async () => {
    const state = await loadWorkingMemory('nonexistent-thread')
    expect(state.target).toBeUndefined()
    expect(state.endpointsTested).toEqual([])
    expect(state.findings).toEqual([])
    expect(state.dedupSet).toEqual([])
  })

  it('save and load round-trips correctly', async () => {
    const state = {
      target: { url: 'http://test.com', status: 'exploring' as const, startedAt: Date.now() },
      endpointsTested: [],
      findings: [],
      dedupSet: [],
      currentPhase: 'observing' as const,
    }
    await saveWorkingMemory(threadId, state)
    const loaded = await loadWorkingMemory(threadId)
    expect(loaded.target?.url).toBe('http://test.com')
    expect(loaded.target?.status).toBe('exploring')
    expect(loaded.currentPhase).toBe('observing')
  })

  it('addEndpointTest adds to dedupSet and endpointsTested', async () => {
    await addEndpointTest(threadId, { url: '/api', technique: 'xss', result: 'not-vulnerable' })
    const state = await loadWorkingMemory(threadId)
    expect(state.endpointsTested).toHaveLength(1)
    expect(state.dedupSet).toContain('xss::/api::*')
  })

  it('addEndpointTest deduplicates by technique/endpoint/param', async () => {
    await addEndpointTest(threadId, { url: '/api', technique: 'xss', param: 'q', result: 'not-vulnerable' })
    await addEndpointTest(threadId, { url: '/api', technique: 'xss', param: 'q', result: 'vulnerable' })
    const state = await loadWorkingMemory(threadId)
    expect(state.endpointsTested).toHaveLength(1)
  })

  it('addEndpointTest allows different param for same endpoint', async () => {
    await addEndpointTest(threadId, { url: '/api', technique: 'xss', param: 'q', result: 'not-vulnerable' })
    await addEndpointTest(threadId, { url: '/api', technique: 'xss', param: 'id', result: 'vulnerable' })
    const state = await loadWorkingMemory(threadId)
    expect(state.endpointsTested).toHaveLength(2)
  })

  it('addFinding stores finding with timestamp', async () => {
    await addFinding(threadId, { id: 'F-001', type: 'xss', endpoint: '/search', severity: 'high', confidence: 0.85, confirmed: false })
    const state = await loadWorkingMemory(threadId)
    expect(state.findings).toHaveLength(1)
    expect(state.findings[0].id).toBe('F-001')
    expect(state.findings[0].discoveredAt).toBeGreaterThan(0)
  })

  it('isAlreadyTested returns true for tested (technique, endpoint)', async () => {
    await addEndpointTest(threadId, { url: '/login', technique: 'sqli', result: 'not-vulnerable' })
    expect(await isAlreadyTested(threadId, 'sqli', '/login')).toBe(true)
    expect(await isAlreadyTested(threadId, 'sqli', '/login', 'user')).toBe(false)
  })

  it('isAlreadyTested returns false for untested combo', async () => {
    expect(await isAlreadyTested(threadId, 'xss', '/unknown')).toBe(false)
  })

  it('loadThreadsIndex creates default index on first call', async () => {
    const index = await loadThreadsIndex()
    expect(index.activeThreadId).toBe('default')
    expect(index.threads).toHaveLength(1)
    expect(index.threads[0].id).toBe('default')
  })

  it('createThread adds a new thread and sets it active', async () => {
    const meta = await createThread('Test Thread', 'http://target.com')
    expect(meta.label).toBe('Test Thread')
    expect(meta.targetUrl).toBe('http://target.com')
    expect(meta.id).toMatch(/^thread_\d+_/)

    const index = await loadThreadsIndex()
    expect(index.activeThreadId).toBe(meta.id)
    expect(index.threads).toHaveLength(2)
  })

  it('switchThread switches active thread', async () => {
    const meta = await createThread('Thread B')
    const result = await switchThread('default')
    expect(result).toBe(true)
    const index = await loadThreadsIndex()
    expect(index.activeThreadId).toBe('default')
  })

  it('switchThread returns false for nonexistent thread', async () => {
    const result = await switchThread('nonexistent')
    expect(result).toBe(false)
  })

  it('updateTarget updates thread and working memory', async () => {
    await updateTarget('default', 'http://updated.com')
    const state = await loadWorkingMemory('default')
    expect(state.target?.url).toBe('http://updated.com')
    expect(state.target?.status).toBe('exploring')

    const index = await loadThreadsIndex()
    const thread = index.threads.find(t => t.id === 'default')
    expect(thread?.targetUrl).toBe('http://updated.com')
  })
})
