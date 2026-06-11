import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InteractionType } from './interaction'
import type { Interaction } from './interaction'

const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockReadFile = vi.fn()
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockAccess = vi.fn().mockRejectedValue(new Error('not found'))
const mockAppendFile = vi.fn().mockResolvedValue(undefined)
const mockExistsSync = vi.fn()

vi.mock('node:fs/promises', () => ({
  writeFile: (...args: any[]) => mockWriteFile(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
  access: (...args: any[]) => mockAccess(...args),
  appendFile: (...args: any[]) => mockAppendFile(...args),
}))

vi.mock('node:fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
}))

vi.mock('./codegen', () => ({
  streamToFile: vi.fn().mockResolvedValue(undefined),
  generateSpecCode: vi.fn(() => ''),
}))

vi.mock('./test-generator', () => ({
  generateTestCases: vi.fn(() => []),
}))

import { ActionRecorder, getGlobalRecorder, setGlobalRecorder, createRecorder } from './index'
import * as testGenerator from './test-generator'

describe('ActionRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
  })

  afterEach(() => {
    setGlobalRecorder(null)
  })

  it('constructor creates session with targetUrl', () => {
    const recorder = new ActionRecorder('http://test.com', 'my-session')
    const session = recorder.getSession()
    expect(session.targetUrl).toBe('http://test.com')
    expect(session.name).toBe('my-session')
    expect(session.interactions).toEqual([])
    expect(session.testCases).toEqual([])
    expect(session.id).toMatch(/^session-/)
  })

  it('constructor creates default session name when not provided', () => {
    const recorder = new ActionRecorder('http://test.com')
    const session = recorder.getSession()
    expect(session.name).toMatch(/^recording-/)
  })

  it('record adds interaction and returns id', () => {
    const recorder = new ActionRecorder('http://test.com')
    const id = recorder.record(InteractionType.GOTO, 'go to page', { url: 'http://page.com' })
    expect(id).toBeTruthy()
    expect(recorder.getInteractions()).toHaveLength(1)
    expect(recorder.getInteractions()[0].type).toBe(InteractionType.GOTO)
    expect(recorder.getInteractions()[0].url).toBe('http://page.com')
  })

  it('record stores interaction with all optional fields', () => {
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.FILL, 'fill email', {
      url: 'http://page.com',
      selector: '#email',
      value: 'a@b.com',
      naturalLanguage: 'type email',
      metadata: { source: 'test' },
    })
    const interaction = recorder.getInteractions()[0]
    expect(interaction.selector).toBe('#email')
    expect(interaction.value).toBe('a@b.com')
    expect(interaction.naturalLanguage).toBe('type email')
    expect(interaction.metadata?.source).toBe('test')
  })

  it('record propagates to test-generator and appends test cases', () => {
    vi.mocked(testGenerator.generateTestCases).mockReturnValueOnce([
      { id: 'tc-1', type: 'happy', name: 'test', description: '', interactions: [], assertions: [], tags: [] },
    ] as any)
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.CLICK, 'click btn', { selector: '#btn' })
    expect(recorder.getTestCases()).toHaveLength(1)
    expect(recorder.getTestCases()[0].id).toBe('tc-1')
  })

  it('query filters by type', () => {
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.GOTO, 'go')
    recorder.record(InteractionType.CLICK, 'click')
    recorder.record(InteractionType.FILL, 'fill')
    const clicks = recorder.query({ type: InteractionType.CLICK })
    expect(clicks).toHaveLength(1)
    expect(clicks[0].description).toBe('click')
  })

  it('query filters by url', () => {
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.GOTO, 'go', { url: 'http://example.com/page' })
    recorder.record(InteractionType.GOTO, 'go2', { url: 'http://other.com' })
    const result = recorder.query({ url: 'example' })
    expect(result).toHaveLength(1)
  })

  it('query filters by since timestamp', async () => {
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.GOTO, 'first')
    await new Promise(r => setTimeout(r, 5))
    const since = Date.now()
    await new Promise(r => setTimeout(r, 5))
    recorder.record(InteractionType.CLICK, 'second')
    const result = recorder.query({ since })
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('second')
  })

  it('query filters by parentId', () => {
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.CLICK, 'parent', { parentId: 'p1' })
    recorder.record(InteractionType.CLICK, 'orphan')
    const result = recorder.query({ parentId: 'p1' })
    expect(result).toHaveLength(1)
  })

  it('query limits results (returns last N)', () => {
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.GOTO, '#1')
    recorder.record(InteractionType.GOTO, '#2')
    recorder.record(InteractionType.GOTO, '#3')
    const result = recorder.query({ limit: 2 })
    expect(result).toHaveLength(2)
    expect(result[0].description).toBe('#2')
    expect(result[1].description).toBe('#3')
  })

  it('query with no filters returns all interactions', () => {
    const recorder = new ActionRecorder('http://test.com')
    recorder.record(InteractionType.GOTO, 'a')
    recorder.record(InteractionType.CLICK, 'b')
    expect(recorder.query()).toHaveLength(2)
  })

  it('save writes session to file', async () => {
    mockExistsSync.mockReturnValue(true)
    const recorder = new ActionRecorder('http://test.com', 'save-test')
    recorder.record(InteractionType.GOTO, 'go')
    await recorder.save()
    expect(mockWriteFile).toHaveBeenCalled()
    const callArgs = mockWriteFile.mock.calls[0]
    expect(callArgs[0]).toContain('save-test.json')
    expect(callArgs[2]).toBe('utf-8')
    const content = JSON.parse(callArgs[1])
    expect(content.targetUrl).toBe('http://test.com')
    expect(content.interactions).toHaveLength(1)
  })

  it('load returns null when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    const result = await ActionRecorder.load('nonexistent')
    expect(result).toBeNull()
  })

  it('load returns ActionRecorder when file exists', async () => {
    mockExistsSync.mockReturnValue(true)
    const sessionData = {
      id: 'session-loaded',
      name: 'loaded-session',
      targetUrl: 'http://loaded.com',
      startedAt: Date.now(),
      interactions: [{ id: 'i-1', type: 'goto', timestamp: Date.now(), sessionId: 's-1', description: 'loaded step' }],
      testCases: [],
    }
    mockReadFile.mockResolvedValue(JSON.stringify(sessionData))
    const recorder = await ActionRecorder.load('loaded-session')
    expect(recorder).not.toBeNull()
    expect(recorder!.getSession().targetUrl).toBe('http://loaded.com')
    expect(recorder!.getInteractions()).toHaveLength(1)
  })

  it('load returns null on corrupt JSON', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValue('not-json')
    const result = await ActionRecorder.load('corrupt')
    expect(result).toBeNull()
  })
})

describe('global recorder', () => {
  afterEach(() => {
    setGlobalRecorder(null)
  })

  it('getGlobalRecorder returns null initially', () => {
    setGlobalRecorder(null)
    expect(getGlobalRecorder()).toBeNull()
  })

  it('setGlobalRecorder stores and getGlobalRecorder retrieves', () => {
    const recorder = new ActionRecorder('http://test.com')
    setGlobalRecorder(recorder)
    expect(getGlobalRecorder()).toBe(recorder)
  })

  it('createRecorder creates and sets global', () => {
    const recorder = createRecorder('http://test.com', 'global-test')
    expect(getGlobalRecorder()).toBe(recorder)
    expect(getGlobalRecorder()!.getSession().targetUrl).toBe('http://test.com')
  })
})
