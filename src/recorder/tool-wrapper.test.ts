import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  wrapToolWithRecorder,
  wrapMastraTool,
  wrapAllMastraTools,
  wrapAllBrowserTools,
} from './tool-wrapper'
import { InteractionType } from './interaction'

const mockRecord = vi.fn()

vi.mock('./index', () => ({
  ActionRecorder: vi.fn().mockImplementation(() => ({
    record: mockRecord,
  })),
}))

describe('tool-wrapper', () => {
  beforeEach(() => {
    mockRecord.mockClear()
  })

  describe('wrapToolWithRecorder', () => {
    it('calls underlying function and returns result', async () => {
      const fn = vi.fn().mockResolvedValue('result')
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('browser_goto', fn, recorder)

      expect(wrapped.id).toBe('browser_goto')
      expect(wrapped.description).toContain('[REC]')
      const result = await wrapped.execute({ url: 'http://example.com' })
      expect(result).toBe('result')
      expect(fn).toHaveBeenCalledWith({ url: 'http://example.com' })
    })

    it('records GOTO interaction for browser_goto', async () => {
      const fn = vi.fn().mockResolvedValue(null)
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('browser_goto', fn, recorder)

      await wrapped.execute({ url: 'http://target.com/page' })
      expect(mockRecord).toHaveBeenCalledWith(
        InteractionType.GOTO,
        'Navigate to http://target.com/page',
        { url: 'http://target.com/page' }
      )
    })

    it('records CLICK interaction for browser_click', async () => {
      const fn = vi.fn().mockResolvedValue(null)
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('browser_click', fn, recorder)

      await wrapped.execute({ selector: '#submit-btn' })
      expect(mockRecord).toHaveBeenCalledWith(
        InteractionType.CLICK,
        'Click #submit-btn',
        { selector: '#submit-btn' }
      )
    })

    it('records FILL interaction for browser_type', async () => {
      const fn = vi.fn().mockResolvedValue(null)
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('browser_type', fn, recorder)

      await wrapped.execute({ selector: '#email', value: 'test@test.com' })
      expect(mockRecord).toHaveBeenCalledWith(
        InteractionType.FILL,
        'Fill #email with "test@test.com"',
        { selector: '#email', value: 'test@test.com' }
      )
    })

    it('records SNAPSHOT for browser_snapshot', async () => {
      const fn = vi.fn().mockResolvedValue(null)
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('browser_snapshot', fn, recorder)

      await wrapped.execute()
      expect(mockRecord).toHaveBeenCalledWith(InteractionType.SNAPSHOT, 'Page snapshot captured')
    })

    it('records ACT for stagehandAct', async () => {
      const fn = vi.fn().mockResolvedValue(null)
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('stagehandAct', fn, recorder)

      await wrapped.execute({ instruction: 'click the login button' })
      expect(mockRecord).toHaveBeenCalledWith(
        InteractionType.ACT,
        expect.stringContaining('click the login button'),
        { naturalLanguage: 'click the login button' }
      )
    })

    it('records EXTRACT for stagehandExtract', async () => {
      const fn = vi.fn().mockResolvedValue(null)
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('stagehandExtract', fn, recorder)

      await wrapped.execute({ instruction: 'get all links' })
      expect(mockRecord).toHaveBeenCalledWith(
        InteractionType.EXTRACT,
        expect.stringContaining('get all links')
      )
    })

    it('propagates error from underlying function', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'))
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('browser_click', fn, recorder)

      await expect(wrapped.execute({ selector: '#btn' })).rejects.toThrow('fail')
      expect(mockRecord).toHaveBeenCalled()
    })

    it('records custom interactionType for unknown tool id', async () => {
      const fn = vi.fn().mockResolvedValue('ok')
      const recorder = { record: mockRecord } as any
      const wrapped = wrapToolWithRecorder('custom_tool', fn, recorder, InteractionType.ACT)

      await wrapped.execute({ data: 1 })
      expect(mockRecord).toHaveBeenCalledWith(InteractionType.ACT, expect.any(String), expect.any(Object))
    })
  })

  describe('wrapMastraTool', () => {
    it('wraps execute and calls recordForTool', async () => {
      const recorder = { record: mockRecord } as any
      const origExecute = vi.fn().mockResolvedValue('result')
      const tool = { id: 'test_mastra', execute: origExecute }
      const wrapped = wrapMastraTool(tool, recorder, InteractionType.ACT)

      const result = await wrapped.execute({ input: 'val' })
      expect(result).toBe('result')
      expect(origExecute).toHaveBeenCalledWith({ input: 'val' }, undefined)
    })

    it('preserves other tool properties', () => {
      const recorder = { record: mockRecord } as any
      const tool = { id: 'my_tool', name: 'MyTool', description: 'does stuff', execute: vi.fn() }
      const wrapped = wrapMastraTool(tool, recorder)

      expect(wrapped.name).toBe('MyTool')
      expect(wrapped.description).toBe('does stuff')
    })

    it('handles tool without original execute', async () => {
      const recorder = { record: mockRecord } as any
      const tool = { id: 'noop' }
      const wrapped = wrapMastraTool(tool, recorder)

      const result = await wrapped.execute({})
      expect(result).toBeUndefined()
    })
  })

  describe('wrapAllMastraTools', () => {
    it('wraps all tools in a record', () => {
      const recorder = { record: mockRecord } as any
      const tools = {
        toolA: { id: 'toolA', execute: vi.fn() },
        toolB: { id: 'toolB', execute: vi.fn() },
      }
      const wrapped = wrapAllMastraTools(tools, recorder)

      expect(Object.keys(wrapped)).toEqual(['toolA', 'toolB'])
      expect(wrapped.toolA.execute).toBeDefined()
      expect(wrapped.toolB.execute).toBeDefined()
    })

    it('handles empty record', () => {
      const recorder = { record: mockRecord } as any
      const wrapped = wrapAllMastraTools({}, recorder)
      expect(wrapped).toEqual({})
    })
  })

  describe('wrapAllBrowserTools', () => {
    it('wraps all browser tool functions', () => {
      const recorder = { record: mockRecord } as any
      const fns = {
        browser_goto: vi.fn(),
        browser_click: vi.fn(),
        browser_type: vi.fn(),
      }
      const wrapped = wrapAllBrowserTools(fns, recorder)

      expect(Object.keys(wrapped)).toEqual(['browser_goto', 'browser_click', 'browser_type'])
      expect(wrapped.browser_goto.id).toBe('browser_goto')
      expect(wrapped.browser_click.id).toBe('browser_click')
      expect(wrapped.browser_type.id).toBe('browser_type')
    })

    it('handles empty tool map', () => {
      const recorder = { record: mockRecord } as any
      const wrapped = wrapAllBrowserTools({}, recorder)
      expect(wrapped).toEqual({})
    })
  })
})
