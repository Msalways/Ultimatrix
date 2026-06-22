import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readAppModelSection, writeAppModelSection } from '../../src/tools/app-model-tools'

describe('app-model-tools', () => {
  let tmpDir: string
  const origCwd = process.cwd()

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'app-model-'))
    process.chdir(tmpDir)
  })

  afterAll(() => {
    process.chdir(origCwd)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('readAppModelSection returns null for missing file', async () => {
    const result = await (readAppModelSection.execute as any)({ section: 'target' })
    expect(result.ok).toBe(true)
    expect(result.value).toBeNull()
  })

  it('writeAppModelSection writes and readAppModelSection reads back', async () => {
    const writeResult = await (writeAppModelSection.execute as any)({ section: 'target', data: { url: 'http://test.com' } })
    expect(writeResult.ok).toBe(true)
    expect(writeResult.value?.written).toBe(true)

    const readResult = await (readAppModelSection.execute as any)({ section: 'target' })
    expect(readResult.ok).toBe(true)
    expect(readResult.value).toEqual({ url: 'http://test.com' })
  })

  it('writeAppModelSection with append adds to arrays', async () => {
    await (writeAppModelSection.execute as any)({ section: 'endpoints', data: [{ path: '/api' }], append: true })
    await (writeAppModelSection.execute as any)({ section: 'endpoints', data: [{ path: '/login' }], append: true })
    const readResult = await (readAppModelSection.execute as any)({ section: 'endpoints' })
    expect(readResult.value).toHaveLength(2)
    expect(readResult.value[0].path).toBe('/api')
    expect(readResult.value[1].path).toBe('/login')
  })

  it('writeAppModelSection with append merges objects', async () => {
    await (writeAppModelSection.execute as any)({ section: 'meta', data: { version: 1, status: 'active' }, append: true })
    await (writeAppModelSection.execute as any)({ section: 'meta', data: { scanned: 100 }, append: true })
    const readResult = await (readAppModelSection.execute as any)({ section: 'meta' })
    expect(readResult.value.version).toBe(1)
    expect(readResult.value.status).toBe('active')
    expect(readResult.value.scanned).toBe(100)
  })

  it('writeAppModelSection reports itemCount', async () => {
    const result = await (writeAppModelSection.execute as any)({ section: 'items', data: [1, 2, 3] })
    expect(result.value?.itemCount).toBe(3)
  })
})
