import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { TestStorage } from '../../src/generation/test-storage'
import type { TestCase } from '../../src/generation/test-generator'

const testDir = resolve(tmpdir(), 'ultimatrix-test-storage')

const mockTests: TestCase[] = [
  {
    id: 'test-001',
    name: 'IDOR Test',
    description: 'Test for IDOR',
    severity: 'high',
    category: 'authorization',
    code: `import { test, expect } from '@playwright/test'\n\ntest('IDOR', async ({ page }) => {\n  const response = await page.request.get('/users/123')\n  expect(response.status()).toBe(200)\n})`,
    findingId: 'finding-001',
  },
  {
    id: 'test-002',
    name: 'XSS Test',
    description: 'Test for XSS',
    severity: 'medium',
    category: 'xss',
    code: `import { test, expect } from '@playwright/test'\n\ntest('XSS', async ({ page }) => {\n  await page.goto('/search?q=<script>alert(1)</script>')\n  const body = await page.textContent('body')\n  expect(body).not.toContain('<script>')\n})`,
    findingId: 'finding-002',
  },
]

beforeAll(async () => {
  await mkdir(testDir, { recursive: true })
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('TestStorage', () => {
  it('should save tests to directory', async () => {
    const storage = new TestStorage(testDir)
    await storage.save(mockTests)

    const files = await storage.list()
    expect(files).toHaveLength(2)
    expect(files).toContain('test-001.spec.ts')
    expect(files).toContain('test-002.spec.ts')
  })

  it('should load tests from directory', async () => {
    const storage = new TestStorage(testDir)
    const tests = await storage.load()
    expect(tests).toHaveLength(2)
    expect(tests[0].code).toContain('@playwright/test')
  })

  it('should list test files', async () => {
    const storage = new TestStorage(testDir)
    const files = await storage.list()
    expect(files.length).toBeGreaterThanOrEqual(2)
  })

  it('should check if test exists', async () => {
    const storage = new TestStorage(testDir)
    expect(await storage.exists('test-001')).toBe(true)
    expect(await storage.exists('nonexistent')).toBe(false)
  })

  it('should remove test', async () => {
    const storage = new TestStorage(testDir)
    await storage.save([mockTests[0]])
    expect(await storage.exists('test-001')).toBe(true)

    await storage.remove('test-001')
    expect(await storage.exists('test-001')).toBe(false)
  })

  it('should return empty for non-existent directory', async () => {
    const storage = new TestStorage(resolve(tmpdir(), 'nonexistent'))
    const tests = await storage.load()
    expect(tests).toHaveLength(0)
  })
})
