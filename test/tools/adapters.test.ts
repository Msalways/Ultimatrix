import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ALL_ADAPTERS } from '../../src/tools/adapters'
import { bridgeToolResult } from '../../src/tools/adapters/bridge'
import type { AdapterFinding } from '../../src/tools/adapters/types'
import { resetStructuredLedger } from '../../src/tools/control-tools'

const { isToolAvailableMock, runBinaryMock } = vi.hoisted(() => ({
  isToolAvailableMock: vi.fn(async () => true),
  runBinaryMock: vi.fn(async () => ({ stdout: '', stderr: '', timedOut: false })),
}))

vi.mock('../../src/tools/adapters/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/adapters/common')>()
  return {
    ...actual,
    isToolAvailable: isToolAvailableMock,
    runBinary: runBinaryMock,
  }
})

// Inject fake binary output for parse tests.
const setStdout = (s: string) => {
  runBinaryMock.mockReturnValue({ stdout: s, stderr: '', timedOut: false } as any)
}

describe('external-tool adapters', () => {
  beforeEach(() => {
    isToolAvailableMock.mockReturnValue(true)
    runBinaryMock.mockReset()
    runBinaryMock.mockReturnValue({ stdout: '', stderr: '', timedOut: false })
  })

  it('every adapter is well-formed', () => {
    expect(ALL_ADAPTERS.length).toBe(9)
    for (const a of ALL_ADAPTERS) {
      expect(typeof a.id).toBe('string')
      expect(typeof a.description).toBe('string')
      expect(a.description.length).toBeGreaterThan(10)
      expect(typeof a.isAvailable).toBe('function')
      expect(typeof a.run).toBe('function')
    }
  })

  it('skips gracefully when the binary is not installed', async () => {
    isToolAvailableMock.mockReturnValue(false)
    for (const a of ALL_ADAPTERS) {
      const r = await a.run({ target: 'http://example.com', options: { token: 'a.b.c', source: '/tmp/x' } })
      expect(r.status, `adapter ${a.id} should skip when missing`).toBe('skip')
    }
  })

  it('nuclei parses JSONL findings', async () => {
    setStdout(JSON.stringify({ 'template-id': 'x', info: { severity: 'high' }, 'matched-at': 'https://example.com/a' }))
    const r = await ALL_ADAPTERS.find(a => a.id === 'nuclei')!.run({ target: 'https://example.com' })
    expect(r.findings.length).toBe(1)
    expect(r.findings[0].url).toBe('https://example.com/a')
    expect(r.findings[0].severity).toBe('high')
  })

  it('sqlmap parses injectable findings', async () => {
    setStdout('the parameter id is injectable\nType: boolean-based blind')
    const r = await ALL_ADAPTERS.find(a => a.id === 'sqlmap')!.run({ target: 'https://example.com/?id=1' })
    expect(r.findings.length).toBeGreaterThan(0)
    expect(r.findings[0].url).toBe('https://example.com/?id=1')
  })

  it('ffuf parses stdout status lines', async () => {
    setStdout('[Status: 200, Size: 123, Words: 5, Lines: 2, URL: https://example.com/admin]')
    const r = await ALL_ADAPTERS.find(a => a.id === 'ffuf')!.run({ target: 'https://example.com/FUZZ', options: { wordlist: '/tmp/wl' } })
    expect(r.findings.length).toBe(1)
    expect(r.findings[0].url).toBe('https://example.com/admin')
  })

  it('nmap parses open ports', async () => {
    setStdout('22/tcp open ssh OpenSSH 8.2')
    const r = await ALL_ADAPTERS.find(a => a.id === 'nmap')!.run({ target: 'example.com' })
    expect(r.findings.length).toBe(1)
    expect(r.findings[0].detail).toContain('22')
  })

  it('jwttool reports forged/JWT weakness', async () => {
    setStdout('[+] SUCCESSFULLY forged token!')
    const r = await ALL_ADAPTERS.find(a => a.id === 'jwttool')!.run({ target: 'eyJ.a.b', options: { token: 'eyJ.a.b' } })
    expect(r.findings.length).toBeGreaterThan(0)
    expect(r.findings[0].severity).toBe('high')
  })

  it('arjun reports hidden parameters', async () => {
    setStdout('Parameter(s) found: redirect,debug')
    const r = await ALL_ADAPTERS.find(a => a.id === 'arjun')!.run({ target: 'https://example.com/page' })
    expect(r.findings.length).toBe(1)
    expect(r.findings[0].detail).toContain('redirect')
  })

  it('corsy reports misconfiguration', async () => {
    setStdout('CORS Misconfiguration: reflect origin')
    const r = await ALL_ADAPTERS.find(a => a.id === 'corsy')!.run({ target: 'https://example.com' })
    expect(r.findings.length).toBeGreaterThan(0)
    expect(r.findings[0].severity).toBe('medium')
  })

  it('subfinder reports subdomains as URLs', async () => {
    setStdout('api.example.com\nlegacy.example.com')
    const r = await ALL_ADAPTERS.find(a => a.id === 'subfinder')!.run({ target: 'example.com' })
    expect(r.findings.length).toBe(2)
    expect(r.findings[0].url).toBe('https://api.example.com')
  })

  it('gitleaks reports leaked secrets', async () => {
    setStdout(JSON.stringify({ RuleID: 'aws-key', File: 'config.js', StartLine: 3 }))
    const r = await ALL_ADAPTERS.find(a => a.id === 'gitleaks')!.run({ target: '/tmp/repo', options: { source: '/tmp/repo' } })
    expect(r.findings.length).toBe(1)
    expect(r.findings[0].detail).toContain('aws-key')
  })
})

describe('adapter evidence bridge', () => {
  beforeEach(() => {
    resetStructuredLedger()
    vi.unstubAllGlobals()
  })

  const fakeAdapter = { id: 'test', description: '', isAvailable: async () => true, run: async () => ({}) as any }

  it('treats a finding without a URL as candidate (cannot confirm)', async () => {
    const result = { tool: 'test', target: 't', status: 'success', output: '', findings: [{ detail: 'no url', raw: 'x' }] as AdapterFinding[], duration: 0 }
    const report = await bridgeToolResult(fakeAdapter, result)
    expect(report.confirmed.length).toBe(0)
    expect(report.candidates.length).toBe(1)
  })

  it('confirms a finding whose URL is independently reachable', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 200, text: async () => 'ok' }))
    const result = { tool: 'test', target: 't', status: 'success', output: '', findings: [{ url: 'https://example.com/api', severity: 'high', detail: 'x', raw: 'x' }] as AdapterFinding[], duration: 0 }
    const report = await bridgeToolResult(fakeAdapter, result)
    expect(report.confirmed.length).toBe(1)
    expect(report.evidenceIds.length).toBe(1)
  })

  it('downgrades to candidate when the target cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('net fail') })
    const result = { tool: 'test', target: 't', status: 'success', output: '', findings: [{ url: 'https://example.com/api', severity: 'high', detail: 'x', raw: 'x' }] as AdapterFinding[], duration: 0 }
    const report = await bridgeToolResult(fakeAdapter, result)
    expect(report.confirmed.length).toBe(0)
    expect(report.candidates.length).toBe(1)
  })
})
