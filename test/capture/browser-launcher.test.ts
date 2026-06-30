import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserLauncher } from '../../src/capture/browser-launcher'

// Mock playwright
vi.mock('playwright', () => {
  let pageCount = 0
  return {
    chromium: {
      launch: vi.fn().mockResolvedValue({
        newContext: vi.fn().mockResolvedValue({
          newPage: vi.fn().mockImplementation(() => {
            pageCount++
            return Promise.resolve({
              on: vi.fn(),
              close: vi.fn().mockResolvedValue(undefined),
              _id: pageCount,
            })
          }),
          close: vi.fn().mockResolvedValue(undefined),
          setDefaultTimeout: vi.fn(),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    },
  }
})

describe('BrowserLauncher', () => {
  let launcher: BrowserLauncher

  beforeEach(() => {
    launcher = new BrowserLauncher()
  })

  afterEach(async () => {
    await launcher.close()
  })

  it('should launch browser', async () => {
    const browser = await launcher.launch()
    expect(browser).toBeDefined()
  })

  it('should create new page with capture', async () => {
    await launcher.launch()
    const managed = await launcher.newPage()
    expect(managed.page).toBeDefined()
    expect(managed.capture).toBeDefined()
  })

  it('should close page', async () => {
    await launcher.launch()
    const { page } = await launcher.newPage()
    await launcher.closePage(page)
    // Should not throw
  })

  it('should close all resources', async () => {
    await launcher.launch()
    await launcher.newPage()
    await launcher.newPage()
    await launcher.close()
    expect(launcher.getBrowser()).toBeNull()
    expect(launcher.getContext()).toBeNull()
  })

  it('should get all captures', async () => {
    await launcher.launch()
    await launcher.newPage()
    await launcher.newPage()
    expect(launcher.getAllCaptures()).toHaveLength(2)
  })

  it('should export combined HAR', async () => {
    await launcher.launch()
    await launcher.newPage()
    const har = launcher.exportAllHar()
    const parsed = JSON.parse(har)
    expect(parsed.log.version).toBe('1.2')
  })
})
