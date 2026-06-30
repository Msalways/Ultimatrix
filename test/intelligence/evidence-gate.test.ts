import { describe, it, expect, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'

describe('EvidenceGate', () => {
  let gate: EvidenceGate

  beforeEach(() => {
    gate = new EvidenceGate()
  })

  it('records tool output', () => {
    gate.recordToolOutput('Status: 200\nBody: {"user":"admin"}')
    expect(gate.getBuffer()).toHaveLength(1)
    expect(gate.getBuffer()[0]).toContain('200')
  })

  it('verifies claim that exists in buffer', () => {
    gate.recordToolOutput('HTTP/1.1 200 OK. User admin found with token abc123. Response complete.')
    const result = gate.verifyClaim('User admin found with token abc123')
    expect(result.verified).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('rejects claim not in buffer', () => {
    gate.recordToolOutput('Status: 200\nBody: {"user":"admin"}')
    const result = gate.verifyClaim('Found SQL injection vulnerability on /api/users')
    expect(result.verified).toBe(false)
    expect(result.missing.length).toBeGreaterThan(0)
  })

  it('extracts flags from text', () => {
    const flags = gate.extractFlags('Found flag{abc123_def} and CTF{xyz789}')
    expect(flags).toContain('flag{abc123_def}')
    expect(flags).toContain('CTF{xyz789}')
    expect(flags).toHaveLength(2)
  })

  it('deduplicates flags', () => {
    const flags = gate.extractFlags('flag{abc} same flag{abc} different flag{xyz}')
    expect(flags).toHaveLength(2)
  })

  it('returns empty for no flags', () => {
    expect(gate.extractFlags('no flags here')).toHaveLength(0)
  })

  it('accepts completion when goal does not require flag', () => {
    const result = gate.verifyCompletion('Find XSS vulnerabilities')
    expect(result.grounded).toBe(true)
  })

  it('rejects completion when goal wants flag but none found', () => {
    const result = gate.verifyCompletion('Find the flag on the target')
    expect(result.grounded).toBe(false)
    expect(result.reason).toContain('flag')
  })

  it('accepts completion when flag found in real output', () => {
    gate.recordToolOutput('Response body: flag{test_flag_123}')
    const result = gate.verifyCompletion('Find the flag on the target')
    expect(result.grounded).toBe(true)
    expect(result.flagsFound).toContain('flag{test_flag_123}')
  })

  it('handles empty buffer', () => {
    expect(gate.getBuffer()).toHaveLength(0)
    const result = gate.verifyClaim('anything')
    expect(result.verified).toBe(false)
  })

  it('clears buffer', () => {
    gate.recordToolOutput('data1')
    gate.recordToolOutput('data2')
    gate.clear()
    expect(gate.getBuffer()).toHaveLength(0)
  })

  it('trims large buffers', () => {
    for (let i = 0; i < 500; i++) {
      gate.recordToolOutput(`output ${i}`)
    }
    expect(gate.getBuffer().length).toBeLessThanOrEqual(400)
  })

  it('returns truncated buffer summary', () => {
    gate.recordToolOutput('a'.repeat(10000))
    const summary = gate.getBufferSummary(100)
    expect(summary.length).toBeLessThanOrEqual(100)
  })
})
