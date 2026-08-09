import { describe, expect, it } from 'vitest'
import { getGlobalArtifactRegistry } from '../../src/security/artifacts'

describe('artifact registry lifecycle', () => {
  it('creates a screenshot artifact with redaction provenance', () => {
    const registry = getGlobalArtifactRegistry()
    const rec = registry.create('screenshot', {
      path: 'C:\\screens\\finding-eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig.png',
      initialStatus: 'redacted',
      provenance: [{ source: 'browser', ref: 'captureScreenshot' }],
    })

    expect(rec.kind).toBe('screenshot')
    expect(rec.status).toBe('redacted')
    expect(rec.redactedAt).toBeTruthy()
    expect(rec.path).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(rec.provenance.some(p => p.source === 'browser')).toBe(true)
    expect(rec.provenance.some(p => p.source === 'redaction')).toBe(true)
    expect(registry.get(rec.id)).toBe(rec)
  })

  it('threads workflowId through create', () => {
    const registry = getGlobalArtifactRegistry()
    registry.setWorkflowId('wf-engagement-7')

    const rec = registry.create('har', { provenance: [{ source: 'capture' }] })
    expect(rec.workflowId).toBe('wf-engagement-7')

    const explicit = registry.create('report', { workflowId: 'wf-other' })
    expect(explicit.workflowId).toBe('wf-other')
  })

  it('transitions status without losing provenance', () => {
    const registry = getGlobalArtifactRegistry()
    const rec = registry.create('finding', { provenance: [{ source: 'graph', ref: 'finding-node' }] })

    expect(rec.status).toBe('created')
    registry.markRedacted(rec.id)
    expect(registry.get(rec.id)!.status).toBe('redacted')
    expect(registry.get(rec.id)!.redactedAt).toBeTruthy()
    registry.markLinked(rec.id)
    expect(registry.get(rec.id)!.status).toBe('linked')
    registry.markReported(rec.id)
    expect(registry.get(rec.id)!.status).toBe('reported')
    registry.markDeleted(rec.id)
    expect(registry.get(rec.id)!.status).toBe('deleted')
    expect(registry.get(rec.id)!.provenance.length).toBe(1)
  })

  it('redacts metadata embedded in provenance detail', () => {
    const registry = getGlobalArtifactRegistry()
    const rec = registry.create('session', {
      provenance: [{ source: 'browser' }],
      metadata: { apiKey: 'sk-live-secret-abc', target: 'https://example.com' },
    })

    const detail = rec.provenance.find(p => p.source === 'metadata')!.detail
    expect(detail).not.toContain('sk-live-secret-abc')
  })

  it('lists by kind', () => {
    const registry = getGlobalArtifactRegistry()
    registry.create('screenshot', {})
    registry.create('screenshot', {})
    registry.create('report', {})

    expect(registry.list('screenshot').length).toBeGreaterThanOrEqual(2)
    expect(registry.list('report').length).toBeGreaterThanOrEqual(1)
    expect(registry.list('har').length).toBeGreaterThanOrEqual(0)
  })

  it('setStatus on unknown id returns undefined', () => {
    const registry = getGlobalArtifactRegistry()
    expect(registry.setStatus('nope', 'redacted')).toBeUndefined()
  })
})
