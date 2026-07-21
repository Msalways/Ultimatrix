import { describe, it, expect, vi } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

import { detectMarkerLeak } from '../../src/tools/marker-oracle'

const exec = (args: any) => (detectMarkerLeak as any).execute(args)

describe('detectMarkerLeak', () => {
  it('detects a victim marker leaked in the attacker body', async () => {
    const res = await exec({ victimMarker: 'SSN-999-22-1111', attackerResponseBody: '{"user":"bob","ssn":"SSN-999-22-1111"}' })
    expect(res.leaked).toBe(true)
    expect(res.where).toBe('body')
    expect(res.snippet).toContain('SSN-999-22-1111')
  })

  it('reports no leak when marker absent', async () => {
    const res = await exec({ victimMarker: 'SECRET-A', attackerResponseBody: '{"data":"nothing here"}' })
    expect(res.leaked).toBe(false)
    expect(res.where).toBe('none')
  })

  it('detects leak in a response header', async () => {
    const res = await exec({ victimMarker: 'tok-xyz', attackerResponseBody: '{}', attackerResponseHeaders: { 'x-user-token': 'tok-xyz' } })
    expect(res.leaked).toBe(true)
    expect(res.where).toBe('header')
    expect(res.headerName).toBe('x-user-token')
  })

  it('is case-insensitive by default', async () => {
    const res = await exec({ victimMarker: 'AdminUser', attackerResponseBody: 'welcome adminuser' })
    expect(res.leaked).toBe(true)
  })

  it('honors caseSensitive flag', async () => {
    const res = await exec({ victimMarker: 'AdminUser', attackerResponseBody: 'welcome adminuser', caseSensitive: true })
    expect(res.leaked).toBe(false)
  })

  it('rejects empty marker', async () => {
    const res = await exec({ victimMarker: '', attackerResponseBody: 'x' })
    expect(res.ok).toBe(false)
    expect(res.leaked).toBe(false)
  })
})
