import { describe, it, expect, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import type { FindingClaim, BodySignature } from '../../src/intelligence/evidence-ledger'

describe('Evidence Gate — Body Signature Verification', () => {
  let gate: EvidenceGate

  beforeEach(() => {
    gate = new EvidenceGate()
    gate.clear()
  })

  it('verifies a contains body signature against recorded response body', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: 'Error: sql syntax error near line 1',
      label: 'sqli-error-response',
      observed: {
        method: 'GET',
        url: 'https://target.com/page?id=1',
        status: 500,
        responseBody: 'Error: sql syntax error near line 1',
      },
    })

    const sig: BodySignature = { type: 'contains', pattern: 'sql syntax error' }
    const claim: FindingClaim = {
      type: 'sqli',
      endpoint: 'https://target.com/page',
      method: 'GET',
      observed: { status: 500, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.supporting.length).toBe(1)
  })

  it('rejects a contains body signature when pattern not in response', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: 'OK - no errors here',
      label: 'normal-response',
      observed: {
        method: 'GET',
        url: 'https://target.com/page?id=1',
        status: 200,
        responseBody: 'OK - no errors here',
      },
    })

    const sig: BodySignature = { type: 'contains', pattern: 'sql syntax error' }
    const claim: FindingClaim = {
      type: 'sqli',
      endpoint: 'https://target.com/page',
      method: 'GET',
      observed: { status: 200, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(false)
    expect(result.missing).toContain('bodySignature:contains:sql syntax error')
  })

  it('verifies a timing body signature against recorded responseTimeMs', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: '',
      label: 'delayed-response',
      observed: {
        method: 'GET',
        url: 'https://target.com/page?id=1;WAITFOR',
        status: 200,
        responseTimeMs: 5200,
        responseBody: '',
      },
    })

    const sig: BodySignature = { type: 'timing', pattern: 'delay', threshold: 5000 }
    const claim: FindingClaim = {
      type: 'sqli-time-based',
      endpoint: 'https://target.com/page',
      method: 'GET',
      observed: { status: 200, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
  })

  it('rejects timing body signature when response was fast', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: '',
      label: 'fast-response',
      observed: {
        method: 'GET',
        url: 'https://target.com/page?id=1',
        status: 200,
        responseTimeMs: 120,
        responseBody: '',
      },
    })

    const sig: BodySignature = { type: 'timing', pattern: 'delay', threshold: 5000 }
    const claim: FindingClaim = {
      type: 'sqli-time-based',
      endpoint: 'https://target.com/page',
      method: 'GET',
      observed: { status: 200, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(false)
    expect(result.missing.some(m => m.includes('timing'))).toBe(true)
  })

  it('verifies a not-contains body signature (negative assertion)', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: '{"status":"ok"}',
      label: 'api-response',
      observed: {
        method: 'POST',
        url: 'https://target.com/api/login',
        status: 200,
        responseBody: '{"status":"ok"}',
      },
    })

    const sig: BodySignature = { type: 'not-contains', pattern: 'error' }
    const claim: FindingClaim = {
      type: 'auth-bypass',
      endpoint: 'https://target.com/api/login',
      method: 'POST',
      observed: { status: 200, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
  })

  it('verifies a regex body signature', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: 'root:x:0:0:root:/root:/bin/bash',
      label: 'cmd-injection-response',
      observed: {
        method: 'GET',
        url: 'https://target.com/ping?host=;id',
        status: 200,
        responseBody: 'root:x:0:0:root:/root:/bin/bash',
      },
    })

    const sig: BodySignature = { type: 'regex', pattern: 'root:.*:0:0' }
    const claim: FindingClaim = {
      type: 'command-injection',
      endpoint: 'https://target.com/ping',
      method: 'GET',
      observed: { status: 200, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
  })

  it('verifies a status-differs body signature (status changed from baseline)', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: 'Forbidden',
      label: 'authz-denied',
      observed: {
        method: 'GET',
        url: 'https://target.com/admin',
        status: 403,
        responseBody: 'Forbidden',
      },
    })

    const sig: BodySignature = { type: 'status-differs', pattern: 'baseline', threshold: 200 }
    const claim: FindingClaim = {
      type: 'authz-bypass',
      endpoint: 'https://target.com/admin',
      method: 'GET',
      observed: { status: 403, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
  })

  it('rejects status-differs when status equals threshold (baseline)', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: 'OK',
      label: 'normal-response',
      observed: {
        method: 'GET',
        url: 'https://target.com/admin',
        status: 200,
        responseBody: 'OK',
      },
    })

    const sig: BodySignature = { type: 'status-differs', pattern: 'baseline', threshold: 200 }
    const claim: FindingClaim = {
      type: 'authz-bypass',
      endpoint: 'https://target.com/admin',
      method: 'GET',
      observed: { status: 200, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(false)
  })

  it('claim without body signature passes if endpoint+method+status match', () => {
    gate.recordObserved({
      type: 'raw_response',
      data: 'some data',
      label: 'test-response',
      observed: {
        method: 'GET',
        url: 'https://target.com/page?id=1',
        status: 200,
        responseBody: 'some data',
      },
    })

    const claim: FindingClaim = {
      type: 'info-disclosure',
      endpoint: 'https://target.com/page',
      method: 'GET',
      observed: { status: 200 },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
  })

  it('multiple evidence items — only one needs to fully support the claim', () => {
    // First item: wrong endpoint
    gate.recordObserved({
      type: 'raw_response',
      data: 'wrong',
      label: 'wrong-endpoint',
      observed: {
        method: 'GET',
        url: 'https://target.com/other?id=1',
        status: 200,
        responseBody: 'wrong',
      },
    })

    // Second item: correct endpoint + body signature match
    gate.recordObserved({
      type: 'raw_response',
      data: 'SQL syntax error',
      label: 'correct-endpoint',
      observed: {
        method: 'GET',
        url: 'https://target.com/page?id=1',
        status: 500,
        responseBody: 'SQL syntax error',
      },
    })

    const sig: BodySignature = { type: 'contains', pattern: 'sql syntax error' }
    const claim: FindingClaim = {
      type: 'sqli',
      endpoint: 'https://target.com/page',
      method: 'GET',
      observed: { status: 500, bodySignature: sig },
    }

    const result = gate.verifyClaim(claim)
    expect(result.verified).toBe(true)
    expect(result.supporting.length).toBe(1)
  })
})
