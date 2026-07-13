import { describe, it, expect } from 'vitest'
import { checkModelCapability, MIN_CONTEXT_FOR_COMPLEX } from '../../src/models/capability'
import type { UltimatrixConfig } from '../../src/config'

function baseConfig(extra: Partial<UltimatrixConfig> = {}): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    ...extra,
  } as UltimatrixConfig
}

describe('checkModelCapability (A8)', () => {
  it('warns (not refuse) on sub-16K model for complex goal by default', () => {
    const cfg = baseConfig({
      modelCapabilities: { 'groq/llama3-8b-8192': { contextWindow: 8192, maxOutputTokens: 4096, strengths: [], supportsStreaming: true, supportsStructuredOutput: false } },
    })
    const r = checkModelCapability(cfg, 'llama3-8b-8192', { complex: true })
    expect(r.warned).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.reason).toContain('8192')
  })

  it('refuses when requireCapableModel is set', () => {
    const cfg = baseConfig({
      requireCapableModel: true,
      modelCapabilities: { 'groq/llama3-8b-8192': { contextWindow: 8192, maxOutputTokens: 4096, strengths: [], supportsStreaming: true, supportsStructuredOutput: false } },
    })
    const r = checkModelCapability(cfg, 'llama3-8b-8192', { complex: true, require: true })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('too small')
  })

  it('passes for a large-context model', () => {
    const cfg = baseConfig({
      model: 'big-model',
      modelCapabilities: { 'big-model': { contextWindow: 128000, maxOutputTokens: 8192, strengths: [], supportsStreaming: true, supportsStructuredOutput: true } },
    })
    const r = checkModelCapability(cfg, 'big-model', { complex: true, require: true })
    expect(r.ok).toBe(true)
    expect(r.warned).toBe(false)
  })

  it('does not warn for non-complex goals', () => {
    const cfg = baseConfig({
      modelCapabilities: { 'groq/llama3-8b-8192': { contextWindow: 8192, maxOutputTokens: 4096, strengths: [], supportsStreaming: true, supportsStructuredOutput: false } },
    })
    const r = checkModelCapability(cfg, 'llama3-8b-8192', { complex: false })
    expect(r.warned).toBe(false)
    expect(r.ok).toBe(true)
  })

  it('passes through when no capabilities are configured', () => {
    const r = checkModelCapability(baseConfig(), 'llama3-8b-8192', { complex: true })
    expect(r.ok).toBe(true)
    expect(r.warned).toBe(false)
  })

  it('exposes a sane minimum threshold', () => {
    expect(MIN_CONTEXT_FOR_COMPLEX).toBe(16000)
  })
})
