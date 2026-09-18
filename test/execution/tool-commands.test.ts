import { describe, it, expect } from 'vitest'
import type { SandboxCommand } from '../../src/execution/types'
import { TOOL_COMMANDS } from '../../src/execution/sandbox-adapter'

describe('TOOL_COMMANDS', () => {
  const fakeOpts = { target: 'https://example.com' }

  it('builds nuclei command', () => {
    const cmd = TOOL_COMMANDS.nuclei(fakeOpts)
    expect(cmd.toolId).toBe('nuclei')
    expect(cmd.args).toContain('nuclei')
    expect(cmd.args).toContain('-target')
    expect(cmd.args).toContain('https://example.com')
  })

  it('builds sqlmap command', () => {
    const cmd = TOOL_COMMANDS.sqlmap(fakeOpts)
    expect(cmd.toolId).toBe('sqlmap')
    expect(cmd.args).toContain('-u')
    expect(cmd.args).toContain('https://example.com')
  })

  it('builds ffuf command', () => {
    const cmd = TOOL_COMMANDS.ffuf(fakeOpts)
    expect(cmd.toolId).toBe('ffuf')
    expect(cmd.args).toContain('ffuf')
    expect(cmd.args.some(a => a.includes('FUZZ'))).toBe(true)
  })

  it('builds nmap command', () => {
    const cmd = TOOL_COMMANDS.nmap(fakeOpts)
    expect(cmd.toolId).toBe('nmap')
    expect(cmd.args).toContain('-sV')
    expect(cmd.args).toContain('https://example.com')
  })

  it('builds gobuster command', () => {
    const cmd = TOOL_COMMANDS.gobuster(fakeOpts)
    expect(cmd.toolId).toBe('gobuster')
    expect(cmd.args).toContain('dir')
  })

  it('builds nikto command', () => {
    const cmd = TOOL_COMMANDS.nikto(fakeOpts)
    expect(cmd.toolId).toBe('nikto')
    expect(cmd.args).toContain('-h')
  })

  it('builds hydra command', () => {
    const cmd = TOOL_COMMANDS.hydra(fakeOpts)
    expect(cmd.toolId).toBe('hydra')
    expect(cmd.args).toContain('ssh')
  })

  it('builds masscan command', () => {
    const cmd = TOOL_COMMANDS.masscan(fakeOpts)
    expect(cmd.toolId).toBe('masscan')
    expect(cmd.args).toContain('-p0-65535')
  })

  it('builds subfinder command', () => {
    const cmd = TOOL_COMMANDS.subfinder(fakeOpts)
    expect(cmd.toolId).toBe('subfinder')
    expect(cmd.args).toContain('-d')
  })

  it('builds httpx command', () => {
    const cmd = TOOL_COMMANDS.httpx(fakeOpts)
    expect(cmd.toolId).toBe('httpx')
    expect(cmd.args).toContain('httpx')
  })

  it('all commands have valid args arrays', () => {
    for (const [toolId, builder] of Object.entries(TOOL_COMMANDS)) {
      const cmd = builder(fakeOpts)
      expect(cmd.args).toBeInstanceOf(Array)
      expect(cmd.args.length).toBeGreaterThan(0)
      expect(cmd.toolId).toBe(toolId)
    }
  })
})
