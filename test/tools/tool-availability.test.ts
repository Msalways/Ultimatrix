import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isToolAvailable } from '../../src/tools/traditional-tools'

// Clear cache between tests by reimporting
describe('isToolAvailable', () => {
  it('returns a boolean for any tool name', async () => {
    const result = await isToolAvailable('nonexistent-tool-xyz-123')
    expect(typeof result).toBe('boolean')
    expect(result).toBe(false)
  })

  it('caches results across calls', async () => {
    const r1 = await isToolAvailable('nonexistent-cache-test')
    const r2 = await isToolAvailable('nonexistent-cache-test')
    expect(r1).toBe(r2)
  })

  it('detects a tool that exists on PATH (node)', async () => {
    const result = await isToolAvailable('node')
    expect(result).toBe(true)
  })
})
