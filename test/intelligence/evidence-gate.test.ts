import { describe, it, expect, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { coreEvidenceLedger } from '../../src/core/evidence'
import type { FindingClaim } from '../../src/intelligence/evidence-ledger'

describe('EvidenceGate', () => {
  let gate: EvidenceGate

  beforeEach(() => {
    coreEvidenceLedger.clear()
    gate = new EvidenceGate()
  })

  it('records raw tool output to the text buffer', () => {
    gate.recordToolOutput('Status: 200\nBody: {"user":"admin"}')
    expect(gate.getBuffer()).toHaveLength(1)
    expect(gate.getBuffer()[0]).toContain('200')
  })

  it('verifies a claim backed by a structured observed record', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: '200',
      label: 'resp',
      observed: { method: 'GET', url: 'https://app.example.com/api/users', status: 200 },
    })
    const claim: FindingClaim = {
      type: 'idor',
      endpoint: 'https://app.example.com/api/users',
      method: 'GET',
      observed: { status: 200 },
    }
    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('rejects a claim with no supporting observed record', () => {
    const claim: FindingClaim = {
      type: 'sqli',
      endpoint: 'https://app.example.com/api/users',
      observed: { status: 500 },
    }
    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(false)
    expect(result.missing.length).toBeGreaterThan(0)
  })

  it('does NOT verify via substring of free text', () => {
    gate.recordToolOutput('Found SQL injection vulnerability on /api/users')
    const claim: FindingClaim = { type: 'sqli', endpoint: 'https://app.example.com/api/users' }
    expect(gate.verifyClaim(claim).verified).toBe(false)
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
    const claim: FindingClaim = { type: 'x', endpoint: 'https://x.com' }
    expect(gate.verifyClaim(claim).verified).toBe(false)
  })

  it('clears buffer', () => {
    gate.recordToolOutput('data1')
    gate.recordToolOutput('data2')
    gate.clear()
    expect(gate.getBuffer()).toHaveLength(0)
  })

  it('trims large text buffers', () => {
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
