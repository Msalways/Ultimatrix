import { describe, it, expect } from 'vitest'
import {
  EvidenceLedger,
  verifyFindingClaim,
  type EvidenceItem,
  type FindingClaim,
} from '../../src/intelligence/evidence-ledger'

function item(partial: Partial<EvidenceItem> & Pick<EvidenceItem, 'type' | 'data' | 'label'>): EvidenceItem {
  return {
    id: partial.id ?? `ev_${Math.random()}`,
    timestamp: partial.timestamp ?? Date.now(),
    type: partial.type,
    data: partial.data,
    label: partial.label,
    ...(partial.observed ? { observed: partial.observed } : {}),
    ...(partial.session ? { session: partial.session } : {}),
  }
}

describe('verifyFindingClaim — structural (no substring)', () => {
  it('verifies when a single evidence item supports the full claim', () => {
    const items = [
      item({
        type: 'raw_response',
        data: 'HTTP/1.1 200',
        label: 'resp',
        observed: { method: 'GET', url: 'https://app.example.com/api/users', status: 200 },
      }),
    ]
    const claim: FindingClaim = {
      type: 'idor',
      endpoint: 'https://app.example.com/api/users',
      method: 'GET',
      observed: { status: 200 },
    }
    const r = verifyFindingClaim(claim, items)
    expect(r.verified).toBe(true)
    expect(r.missing).toHaveLength(0)
    expect(r.supporting).toHaveLength(1)
  })

  it('rejects when asserted status is absent from all evidence', () => {
    const items = [
      item({
        type: 'raw_response',
        data: '200',
        label: 'resp',
        observed: { method: 'GET', url: 'https://app.example.com/api/users', status: 200 },
      }),
    ]
    const claim: FindingClaim = {
      type: 'idor',
      endpoint: 'https://app.example.com/api/users',
      observed: { status: 403 },
    }
    const r = verifyFindingClaim(claim, items)
    expect(r.verified).toBe(false)
    expect(r.missing).toContain('status:403')
  })

  it('rejects when endpoint never appears in any observed.url', () => {
    const items = [
      item({
        type: 'raw_response',
        data: '200',
        label: 'resp',
        observed: { url: 'https://other.com/x', status: 200 },
      }),
    ]
    const claim: FindingClaim = { type: 'xss', endpoint: 'https://app.example.com/a' }
    const r = verifyFindingClaim(claim, items)
    expect(r.verified).toBe(false)
    expect(r.missing).toContain('endpoint:https://app.example.com/a')
  })

  it('does NOT fall back to substring scanning of item.data for endpoint', () => {
    // Endpoint only appears inside free-text data; with no observed.url it must fail.
    const items = [
      item({ type: 'text', data: 'visited https://app.example.com/api/users and got 200', label: 'note' }),
    ]
    const claim: FindingClaim = { type: 'idor', endpoint: 'https://app.example.com/api/users' }
    const r = verifyFindingClaim(claim, items)
    expect(r.verified).toBe(false)
    expect(r.missing).toContain('endpoint:https://app.example.com/api/users')
  })

  it('matches endpoint by normalized URL (trailing slash / case-insensitive host)', () => {
    const items = [
      item({
        type: 'raw_response',
        data: 'x',
        label: 'r',
        observed: { url: 'https://APP.EXAMPLE.com/api/users/' },
      }),
    ]
    const claim: FindingClaim = { type: 'x', endpoint: 'https://app.example.com/api/users' }
    expect(verifyFindingClaim(claim, items).verified).toBe(true)
  })

  it('tolerates claims that assert no method/status (only endpoint required)', () => {
    const items = [
      item({ type: 'raw_response', data: 'x', label: 'r', observed: { url: 'https://app.example.com/p' } }),
    ]
    const claim: FindingClaim = { type: 'xss', endpoint: 'https://app.example.com/p' }
    expect(verifyFindingClaim(claim, items).verified).toBe(true)
  })

  it('requires co-occurrence: endpoint present but method mismatch is not supporting', () => {
    const items = [
      item({
        type: 'raw_response',
        data: 'x',
        label: 'r',
        observed: { method: 'GET', url: 'https://app.example.com/p', status: 200 },
      }),
    ]
    const claim: FindingClaim = {
      type: 'x',
      endpoint: 'https://app.example.com/p',
      method: 'POST',
      observed: { status: 200 },
    }
    const r = verifyFindingClaim(claim, items)
    expect(r.verified).toBe(false)
    expect(r.missing).toContain('method:POST')
  })
})

describe('EvidenceLedger', () => {
  it('records and verifies through the ledger', () => {
    const ledger = new EvidenceLedger()
    ledger.record({
      type: 'raw_response',
      data: '200',
      label: 'resp',
      observed: { method: 'POST', url: 'https://app.example.com/login', status: 302 },
    })
    const ok = ledger.verify({
      type: 'auth-bypass',
      endpoint: 'https://app.example.com/login',
      method: 'POST',
      observed: { status: 302 },
    })
    expect(ok.verified).toBe(true)

    const bad = ledger.verify({ type: 'x', endpoint: 'https://nope.com' })
    expect(bad.verified).toBe(false)
  })

  it('clears', () => {
    const ledger = new EvidenceLedger()
    ledger.record({ type: 'text', data: 'd', label: 'l' })
    ledger.clear()
    expect(ledger.all()).toHaveLength(0)
  })
})
